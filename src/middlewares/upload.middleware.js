const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

// MUHIM: bu — lokal disk orqali vaqtinchalik yechim. Production'da
// Cloudflare R2/S3'ga pre-signed URL orqali yuklash tavsiya etiladi
// (SRS 5-bo'lim) — trafik ko'payganda shu faylni almashtiring.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
        cb(null, `${crypto.randomUUID()}${ext}`);
    },
});

function fileFilter(req, file, cb) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
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
        const allowed = ['video/mp4', 'video/quicktime', 'video/webm'];
        if (!allowed.includes(file.mimetype)) {
            return cb(Object.assign(new Error('Faqat MP4, MOV yoki WEBM video yuklash mumkin'), { status: 400 }));
        }
    } else if (file.fieldname === 'thumbnail' || file.fieldname === 'photos') {
        const allowed = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowed.includes(file.mimetype)) {
            return cb(Object.assign(new Error('Rasm JPEG, PNG yoki WEBP bo\'lishi kerak'), { status: 400 }));
        }
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

module.exports = { uploadPhoto, uploadPost, UPLOAD_DIR };