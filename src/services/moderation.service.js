// Kontent moderatsiyasi: post va story'ga yuklangan rasm/video Solvi
// qoidalariga zid bo'lsa (18+ / jinsiy, terroristik yoki zo'ravon mazmun),
// joylanmaydi — 422 CONTENT_REJECTED.
//
// Ikki qatlam:
//   1) 18+ / jinsiy — bepul lokal model (onnx-community/nsfw_image_detection-ONNX,
//      ViT asosida, Falconsai), transformers.js bilan serverning o'zida ishlaydi.
//      Birinchi ishga tushishda (~90 MB) yuklab olinib .models/ ga saqlanadi.
//   2) Terror (IS bayrog'i va h.k.), qon/o'lik, zo'ravonlik — Sightengine API
//      (bepul tarif: oyiga 2000, kuniga 500 operatsiya). .env'da
//      SIGHTENGINE_API_USER va SIGHTENGINE_API_SECRET bo'lsa yoqiladi.
//      Bunday kontent uchun ishonchli bepul lokal model yo'q (sinab ko'rilganlari
//      mushuk rasmini ham "zo'ravon" deb belgilardi).
//
// Videodan bir necha kadr (ffmpeg-static) olinib, har biri tekshiriladi.
// Model yoki tashqi API ishlamay qolsa — post bloklanmaydi (faqat loglanadi):
// moderatsiya xatosi butun yuklashni buzmasin.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { httpError } = require('../utils/http');

const NSFW_MODEL = 'onnx-community/nsfw_image_detection-ONNX';
const MODEL_DIR = path.join(__dirname, '..', '..', '.models');

function config() {
    return {
        enabled: process.env.MODERATION_ENABLED !== 'false',
        nsfwThreshold: Number(process.env.MODERATION_NSFW_THRESHOLD) || 0.85,
        sightengineUser: process.env.SIGHTENGINE_API_USER || '',
        sightengineSecret: process.env.SIGHTENGINE_API_SECRET || '',
        // Bepul kvotani tejash uchun videodan Sightengine'ga ketadigan kadrlar soni
        sightengineFrames: Number(process.env.SIGHTENGINE_VIDEO_FRAMES) || 3,
    };
}

const MESSAGES = {
    sexual: {
        photo: "Bu rasm 18+ (jinsiy) mazmunga ega — Solvi qoidalariga to'g'ri kelmaydi",
        video: "Bu video 18+ (jinsiy) mazmunga ega — Solvi qoidalariga to'g'ri kelmaydi",
    },
    terror: {
        photo: "Bu rasm terroristik yoki ekstremistik mazmunga ega — Solvi qoidalariga to'g'ri kelmaydi",
        video: "Bu video terroristik yoki ekstremistik mazmunga ega — Solvi qoidalariga to'g'ri kelmaydi",
    },
    violence: {
        photo: "Bu rasm zo'ravonlik yoki qonli mazmunga ega — Solvi qoidalariga to'g'ri kelmaydi",
        video: "Bu video zo'ravonlik yoki qonli mazmunga ega — Solvi qoidalariga to'g'ri kelmaydi",
    },
};

// ---------- lokal NSFW modeli

let classifierPromise = null;

function loadClassifier() {
    if (!classifierPromise) {
        classifierPromise = (async () => {
            const { pipeline, env } = require('@huggingface/transformers');
            env.cacheDir = MODEL_DIR;
            return pipeline('image-classification', NSFW_MODEL, { dtype: 'q8' });
        })().catch((err) => {
            classifierPromise = null;
            throw err;
        });
    }
    return classifierPromise;
}

// Server ishga tushganda modelni oldindan yuklab qo'yish (birinchi
// foydalanuvchi kutib qolmasin).
function warmUp() {
    if (!config().enabled) return;
    loadClassifier()
        .then(() => console.log('Moderatsiya: NSFW modeli tayyor'))
        .catch((err) => console.error('Moderatsiya: NSFW modelini yuklab bo\'lmadi:', err.message));
}

// Bir vaqtda bitta tahlil — kam xotirali serverda CPU/RAM toshib ketmasin.
let queue = Promise.resolve();
function serialized(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
}

// 0..1 — rasm 18+ bo'lish ehtimoli.
async function nsfwScore(imagePath) {
    const classify = await loadClassifier();
    const out = await serialized(() => classify(imagePath, { top_k: 2 }));
    return out.find((o) => o.label === 'nsfw')?.score ?? 0;
}

// ---------- videodan kadrlar

function run(file, args) {
    return new Promise((resolve) => {
        execFile(file, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
            resolve({ err, stdout, stderr: String(stderr || '') });
        });
    });
}

async function videoDurationSec(videoPath) {
    // ffmpeg -i (chiqish fayli yo'q) xato bilan tugaydi, lekin stderr'da Duration bor.
    const { stderr } = await run(ffmpegPath, ['-hide_banner', '-i', videoPath]);
    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

// Videoning butun uzunligi bo'ylab teng taqsimlangan kadrlar (4..24 ta,
// har ~5 soniyada bittadan).
async function extractFrames(videoPath, dir) {
    const duration = await videoDurationSec(videoPath);
    const count = duration ? Math.min(24, Math.max(4, Math.ceil(duration / 5))) : 4;
    const times = duration
        ? Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * duration)
        : [0, 1, 2, 3];
    const frames = [];
    for (const [i, t] of times.entries()) {
        const out = path.join(dir, `f${i}.jpg`);
        await run(ffmpegPath, [
            '-hide_banner', '-loglevel', 'error', '-y',
            '-ss', t.toFixed(2), '-i', videoPath,
            '-frames:v', '1', '-vf', 'scale=448:-2', '-q:v', '3', out,
        ]);
        if (fs.existsSync(out)) frames.push(out);
    }
    return frames;
}

// ---------- Sightengine (terror / zo'ravonlik / qon)

// Javobdan qoidabuzarlik turi (yoki null).
function sightengineVerdict(result) {
    const offensive = result.offensive || {};
    if ((offensive.terrorist ?? 0) >= 0.7 || (offensive.nazi ?? 0) >= 0.85 || (offensive.supremacist ?? 0) >= 0.85) {
        return 'terror';
    }
    if ((result.gore?.prob ?? 0) >= 0.8) return 'violence';
    const violence = result.violence?.classes || {};
    // Sport kurashlari (boks va h.k.) — ruxsat.
    if ((violence.physical_violence ?? 0) >= 0.85 || (violence.firearm_threat ?? 0) >= 0.85) return 'violence';
    return null;
}

async function sightengineCheck(imagePath, cfg) {
    const form = new FormData();
    form.append('media', await fs.openAsBlob(imagePath), path.basename(imagePath));
    form.append('models', 'offensive-2.0,gore-2.0,violence');
    form.append('api_user', cfg.sightengineUser);
    form.append('api_secret', cfg.sightengineSecret);
    const res = await fetch('https://api.sightengine.com/1.0/check.json', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(20000),
    });
    const json = await res.json();
    if (json.status !== 'success') throw new Error(json.error?.message || `HTTP ${res.status}`);
    return sightengineVerdict(json);
}

function pickEvenly(items, n) {
    if (items.length <= n) return items;
    return Array.from({ length: n }, (_, i) => items[Math.floor(((i + 0.5) / n) * items.length)]);
}

// ---------- asosiy tekshiruv

// Bitta media (rasm yoki video) uchun qoidabuzarlik turi yoki null.
async function inspect(media, cfg, tmpRoot) {
    let images = [media.path];
    if (media.video) {
        const dir = fs.mkdtempSync(path.join(tmpRoot, 'v-'));
        images = await extractFrames(media.path, dir);
        if (images.length === 0) return null;
    }

    try {
        const scores = [];
        for (const image of images) scores.push(await nsfwScore(image));
        const flagged = scores.filter((s) => s >= cfg.nsfwThreshold).length;
        // Videoda bitta tasodifiy kadr yetmaydi — kamida 2 tasi (yoki juda aniq bittasi).
        const needed = media.video ? Math.min(2, images.length) : 1;
        if (flagged >= needed || Math.max(...scores) >= 0.97) return 'sexual';
    } catch (err) {
        console.error('Moderatsiya (NSFW) ishlamadi:', err.message);
    }

    if (cfg.sightengineUser && cfg.sightengineSecret) {
        for (const image of pickEvenly(images, media.video ? cfg.sightengineFrames : 1)) {
            try {
                const verdict = await sightengineCheck(image, cfg);
                if (verdict) return verdict;
            } catch (err) {
                console.error('Moderatsiya (Sightengine) ishlamadi:', err.message);
                break;
            }
        }
    }
    return null;
}

// items: [{ path, video?: boolean }] — yuklangan fayllar. Qoidabuzarlik
// topilsa 422 CONTENT_REJECTED (reason: sexual | terror | violence).
async function assertMediaAllowed(items) {
    const cfg = config();
    if (!cfg.enabled || items.length === 0) return;
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'solvi-mod-'));
    try {
        for (const media of items) {
            const reason = await inspect(media, cfg, tmpRoot);
            if (reason) {
                const err = httpError(MESSAGES[reason][media.video ? 'video' : 'photo'], 422, 'CONTENT_REJECTED');
                err.reason = reason;
                throw err;
            }
        }
    } finally {
        fs.rm(tmpRoot, { recursive: true, force: true }, () => {});
    }
}

module.exports = { assertMediaAllowed, warmUp, sightengineVerdict };
