const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

// MUHIM: bu — lokal disk orqali vaqtinchalik yechim. Production'da
// Cloudflare R2/S3'ga pre-signed URL orqali yuklash tavsiya etiladi
// (SRS 5-bo'lim) — trafik ko'payganda shu faylni almashtiring.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const IMAGE_TYPES = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
};
const VIDEO_TYPES = {
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
    'video/webm': '.webm',
};
// Ovozli xabar — "record" paketi odatda AAC/M4A formatida yozadi;
// ba'zi qurilma/brauzerlar boshqa mime turlarini yuborishi mumkin,
// shuning uchun keng ro'yxat.
const AUDIO_TYPES = {
    'audio/mp4': '.m4a',
    'audio/m4a': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/aac': '.aac',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/webm': '.webm',
    'audio/ogg': '.ogg',
};
const ALL_TYPES = { ...IMAGE_TYPES, ...VIDEO_TYPES, ...AUDIO_TYPES };

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    // Kengaytma klient yuborgan fayl nomidan EMAS, ruxsat etilgan mimetype
    // ro'yxatidan olinadi — aks holda "rasm" deb .html/.js fayl yuklab,
    // uni /uploads orqali shu domendan tarqatish mumkin bo'lardi.
    filename: (req, file, cb) => {
        cb(null, `${crypto.randomUUID()}${ALL_TYPES[file.mimetype] || '.bin'}`);
    },
});

function fileFilter(req, file, cb) {
    if (!IMAGE_TYPES[file.mimetype]) {
        return cb(Object.assign(new Error('Faqat JPEG, PNG yoki WEBP rasm yuklash mumkin'), { status: 400 }));
    }
    cb(null, true);
}

const uploadPhoto = multer({
    storage,
    fileFilter,
    limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
});

function postFileFilter(req, file, cb) {
    if (file.fieldname === 'video') {
        if (!VIDEO_TYPES[file.mimetype]) {
            return cb(Object.assign(new Error('Faqat MP4, MOV yoki WEBM video yuklash mumkin'), { status: 400 }));
        }
    } else if (!IMAGE_TYPES[file.mimetype]) {
        return cb(Object.assign(new Error('Rasm JPEG, PNG yoki WEBP bo\'lishi kerak'), { status: 400 }));
    }
    cb(null, true);
}

// Post yaratish: yoki bitta video (+ ixtiyoriy muqova), yoki bir nechta rasm
// ("photos" — Instagram uslubidagi carousel, ko'pi bilan 10 tasi).
const uploadPost = multer({
    storage,
    fileFilter: postFileFilter,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB — video uchun
}).fields([
    { name: 'video', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 },
    { name: 'photos', maxCount: 10 },
]);

function chatMediaFileFilter(req, file, cb) {
    if (!ALL_TYPES[file.mimetype]) {
        return cb(Object.assign(new Error('Faqat rasm, video yoki ovozli xabar yuklash mumkin'), { status: 400 }));
    }
    cb(null, true);
}

// Chatda bitta xabarga bitta rasm yoki video biriktiriladi (field nomi "media").
const uploadChatMedia = multer({
    storage,
    fileFilter: chatMediaFileFilter,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB — video uchun
}).single('media');

function storyFileFilter(req, file, cb) {
    if (file.fieldname === 'media') {
        if (!IMAGE_TYPES[file.mimetype] && !VIDEO_TYPES[file.mimetype]) {
            return cb(Object.assign(new Error('Story uchun faqat rasm yoki video yuklash mumkin'), { status: 400 }));
        }
    } else if (!IMAGE_TYPES[file.mimetype]) {
        return cb(Object.assign(new Error('Muqova JPEG, PNG yoki WEBP bo\'lishi kerak'), { status: 400 }));
    }
    cb(null, true);
}

// Story: bitta rasm yoki video ("media") + videoning ixtiyoriy muqovasi
// ("thumbnail" — chatdagi story javobi kartochkasi uchun).
const uploadStory = multer({
    storage,
    fileFilter: storyFileFilter,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB — video uchun
}).fields([
    { name: 'media', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 },
]);

// Bazaga to'liq URL emas, shu NISBIY yo'l yoziladi. Host (IP/domen)
// o'zgarganda eski yozuvlar buzilmaydi — klient o'zining base URL'ini
// oldiga qo'shib oladi.
function publicPath(filename) {
    return `/uploads/${filename}`;
}

// Fayl multer orqali validatsiyadan OLDIN diskka yoziladi. So'rov xato bilan
// tugasa (validatsiya, ruxsat yo'q, DB xatosi) — o'sha fayl(lar) hech qayerga
// bog'lanmay qolib ketmasligi uchun javob yuborilgach o'chiriladi.
// Yuklash middleware'idan OLDIN ulanadi.
function cleanupUploadsOnError(req, res, next) {
    res.on('finish', () => {
        if (res.statusCode < 400) return;
        const files = [];
        if (req.file) files.push(req.file);
        if (Array.isArray(req.files)) files.push(...req.files);
        else if (req.files) files.push(...Object.values(req.files).flat());
        for (const file of files) fs.unlink(file.path, () => {});
    });
    next();
}

// Yozuv o'chirilganda unga tegishli faylni ham diskdan olib tashlash.
// Faqat o'zimizning /uploads ichidagi fayllarga tegadi (tashqi havolalar —
// Giphy, Google avatar va h.k. — e'tiborsiz qoldiriladi).
function removeUploadedFile(url) {
    if (typeof url !== 'string' || !url.startsWith('/uploads/')) return;
    fs.unlink(path.join(UPLOAD_DIR, path.basename(url)), () => {});
}

module.exports = {
    uploadPhoto,
    uploadPost,
    uploadChatMedia,
    uploadStory,
    publicPath,
    cleanupUploadsOnError,
    removeUploadedFile,
    UPLOAD_DIR,
};
