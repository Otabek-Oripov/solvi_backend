const { normalizeMediaUrl } = require('./externalMedia');
const { httpError } = require('./http');

// Reels muharriri tahrirlari — ilova post bilan birga "edit" (JSON) qilib
// yuboradi. Video fayl qayta kodlanmaydi: filtr, kesish, tezlik, ovoz
// balandligi, fon va matn/stikerlar ko'rsatish paytida qo'llanadi (story
// ustidagi matnlar kabi). Bazaga ixtiyoriy JSON emas — faqat ma'lum
// maydonlar, ruxsat etilgan oraliqda yoziladi.
const MAX_EDIT_JSON_LENGTH = 24 * 1024;
const MAX_OVERLAYS = 20;
const MAX_TEXT_LENGTH = 200;
const MAX_VIDEO_MS = 10 * 60 * 1000;
const MIN_CLIP_MS = 500;
const SPEEDS = [0.3, 0.5, 1, 1.5, 2, 3];
const TEXT_STYLES = ['plain', 'filled', 'soft'];
const FONTS = ['classic', 'serif', 'typewriter', 'strong', 'script', 'casual', 'neon'];
const FITS = ['cover', 'contain'];
const BACKGROUNDS = ['blur', 'color', 'gradient'];
const MAX_GRADIENT_INDEX = 31;

function num(value, min, max, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

function color(value, fallback) {
    return Math.trunc(num(value, 0, 0xffffffff, fallback));
}

function oneOf(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
}

// Matn, emoji yoki stiker (rasm/GIF/animatsion emoji havolasi). x/y — 9:16
// maydonga nisbatan markaz (0..1), shuning uchun har qanday ekranda bir xil
// joyda chiqadi.
function sanitizeOverlay(o) {
    if (!o || typeof o !== 'object' || !['text', 'emoji', 'sticker'].includes(o.type)) {
        throw httpError('edit.overlays noto\'g\'ri', 400);
    }
    const base = {
        type: o.type,
        x: num(o.x, 0, 1, 0.5),
        y: num(o.y, 0, 1, 0.5),
        scale: num(o.scale, 0.2, 8, 1),
        rotation: num(o.rotation, -4 * Math.PI, 4 * Math.PI, 0),
    };
    if (o.type === 'sticker') {
        // Faqat ruxsat etilgan manbalar (o'z serverimiz, KLIPY/GIPHY, Google
        // animatsion emoji) — aks holda ko'ruvchi qurilmasi istalgan saytga
        // so'rov yuborardi.
        const url = normalizeMediaUrl(o.url);
        if (!url) throw httpError('Bu stikerni qo\'shib bo\'lmaydi', 400);
        return { ...base, url };
    }
    const text = String(o.text ?? '').trim().slice(0, MAX_TEXT_LENGTH);
    if (!text) throw httpError('Bo\'sh matn qo\'shib bo\'lmaydi', 400);
    if (o.type === 'emoji') return { ...base, text };
    return {
        ...base,
        text,
        color: color(o.color, 0xffffffff),
        style: oneOf(o.style, TEXT_STYLES, 'plain'),
        font: oneOf(o.font, FONTS, 'classic'),
    };
}

// raw — multipart satri (JSON) yoki obyekt; bo'sh bo'lsa null (tahrirsiz).
function sanitizeReelEdit(raw) {
    if (raw === undefined || raw === null || raw === '') return null;
    let edit = raw;
    if (typeof raw === 'string') {
        if (raw.length > MAX_EDIT_JSON_LENGTH) throw httpError('Tahrirlar juda katta', 400);
        try {
            edit = JSON.parse(raw);
        } catch {
            throw httpError('edit noto\'g\'ri', 400);
        }
    }
    if (!edit || typeof edit !== 'object' || Array.isArray(edit)) {
        throw httpError('edit noto\'g\'ri', 400);
    }

    const trimStartMs = Math.round(num(edit.trimStartMs, 0, MAX_VIDEO_MS, 0));
    const trimEndMs = edit.trimEndMs === null || edit.trimEndMs === undefined
        ? null
        : Math.round(num(edit.trimEndMs, 0, MAX_VIDEO_MS, 0));
    if (trimEndMs !== null && trimEndMs < trimStartMs + MIN_CLIP_MS) {
        throw httpError('Video juda qisqa kesilgan', 400);
    }

    const overlays = edit.overlays ?? [];
    if (!Array.isArray(overlays)) throw httpError('edit.overlays noto\'g\'ri', 400);
    if (overlays.length > MAX_OVERLAYS) {
        throw httpError(`Ko'pi bilan ${MAX_OVERLAYS} ta matn/stiker`, 400);
    }

    const speed = Number(edit.speed);
    const musicTitle = typeof edit.musicTitle === 'string' ? edit.musicTitle.trim().slice(0, 80) : '';
    return {
        // Filtr nomi — ilovadagi ro'yxatdan (noma'lumi ilovada "Normal" bo'ladi)
        filter: typeof edit.filter === 'string' && /^[a-z0-9_]{1,24}$/.test(edit.filter) ? edit.filter : 'none',
        filterStrength: num(edit.filterStrength, 0, 1, 1),
        brightness: num(edit.brightness, -1, 1, 0),
        contrast: num(edit.contrast, -1, 1, 0),
        saturation: num(edit.saturation, -1, 1, 0),
        warmth: num(edit.warmth, -1, 1, 0),
        fade: num(edit.fade, 0, 1, 0),
        vignette: num(edit.vignette, 0, 1, 0),
        trimStartMs,
        trimEndMs,
        speed: SPEEDS.includes(speed) ? speed : 1,
        originalVolume: num(edit.originalVolume, 0, 1, 1),
        musicVolume: num(edit.musicVolume, 0, 1, 1),
        musicStartMs: Math.round(num(edit.musicStartMs, 0, 60 * 60 * 1000, 0)),
        musicTitle: musicTitle || null,
        fit: oneOf(edit.fit, FITS, 'cover'),
        background: oneOf(edit.background, BACKGROUNDS, 'blur'),
        backgroundColor: color(edit.backgroundColor, 0xff000000),
        gradient: Math.trunc(num(edit.gradient, 0, MAX_GRADIENT_INDEX, 0)),
        overlays: overlays.map(sanitizeOverlay),
    };
}

module.exports = { sanitizeReelEdit, MAX_OVERLAYS };
