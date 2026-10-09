const fs = require('fs');
const path = require('path');
const { UPLOAD_DIR } = require('../middlewares/upload.middleware');

// Chatga GIF/stiker sifatida "tayyor havola" bilan yuboriladigan rasmlar
// faqat shu manbalardan qabul qilinadi. Aks holda istalgan saytdagi rasmni
// (masalan suhbatdoshning IP manzilini bilib olish uchun "kuzatuv
// pikseli"ni) chatga qo'yish mumkin bo'lardi — rasm qabul qiluvchining
// qurilmasida avtomatik yuklanadi.
//  - giphy.com / klipy.com — GIF va stiker qidiruvi (stickers.service);
//  - fonts.gstatic.com — Google'ning animatsion emoji'lari (Noto Animated
//    Emoji, CC BY 4.0) — ilovadagi "Animatsion emoji" to'plamlari.
const ALLOWED_HOST_SUFFIXES = ['giphy.com', 'klipy.com', 'klipy.co', 'fonts.gstatic.com'];

// Qidiruv proxy'si javobidagi media hostlari (provayder CDN'i boshqa domenda
// bo'lsa ham, o'zimiz bergan natijani yuborish ishlashi uchun).
const learnedHosts = new Set();

const OWN_UPLOAD_RE = /^https?:\/\/[^/]+(\/uploads\/[0-9a-f-]{36}\.[a-z0-9]+)$/i;
const RELATIVE_UPLOAD_RE = /^\/uploads\/[0-9a-f-]{36}\.[a-z0-9]+$/i;

function rememberMediaHost(url) {
    try {
        const { protocol, hostname } = new URL(url);
        if (protocol === 'https:') learnedHosts.add(hostname.toLowerCase());
    } catch (_) {
        // noto'g'ri havola — e'tiborsiz
    }
}

function hostAllowed(hostname) {
    const host = hostname.toLowerCase();
    if (learnedHosts.has(host)) return true;
    return ALLOWED_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

// Bazaga yoziladigan qiymatni qaytaradi yoki null (havola qabul qilinmaydi).
// O'z serverimizdagi fayl (klient uni to'liq URL ko'rinishida yuboradi) —
// NISBIY yo'lga aylantiriladi: server manzili o'zgarganda ham ishlashi va
// fayl ishlatilayotganini (o'chirishdan oldin) aniq tekshirish uchun.
function normalizeMediaUrl(raw) {
    if (typeof raw !== 'string') return null;
    const url = raw.trim();
    const own = url.match(OWN_UPLOAD_RE);
    const relative = own ? own[1] : (RELATIVE_UPLOAD_RE.test(url) ? url : null);
    if (relative) {
        return fs.existsSync(path.join(UPLOAD_DIR, path.basename(relative))) ? relative : null;
    }
    let parsed;
    try {
        parsed = new URL(url);
    } catch (_) {
        return null;
    }
    if (parsed.protocol !== 'https:') return null;
    return hostAllowed(parsed.hostname) ? url : null;
}

// Yuklangan fayl haqiqatan ham e'lon qilingan turdagi rasmmi — mimetype'ni
// klient o'zi yozadi, shuning uchun faylning boshidagi "sehrli" baytlar
// tekshiriladi (stiker/GIF boshqa foydalanuvchilarga ko'rsatiladi).
function hasImageSignature(filePath, mimetype) {
    const header = Buffer.alloc(12);
    let fd;
    try {
        fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, header, 0, 12, 0);
    } catch (_) {
        return false;
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
    switch (mimetype) {
        case 'image/png':
            return header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        case 'image/gif':
            return header.subarray(0, 4).toString('ascii') === 'GIF8';
        case 'image/webp':
            return header.subarray(0, 4).toString('ascii') === 'RIFF'
                && header.subarray(8, 12).toString('ascii') === 'WEBP';
        default:
            return false;
    }
}

module.exports = { normalizeMediaUrl, rememberMediaHost, hasImageSignature };
