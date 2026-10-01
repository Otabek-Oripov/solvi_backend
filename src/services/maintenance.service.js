const pool = require('../config/db');

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 soat

// "online" holati faqat xotiradagi socket ulanishlariga asoslanadi. Server
// kutilmaganda to'xtasa (crash, kill), disconnect hodisasi ishlamaydi va
// foydalanuvchilar bazada abadiy "online" bo'lib qoladi — shuning uchun
// har ishga tushganda hammasi "offline"ga qaytariladi (haqiqatan onlayn
// bo'lganlar socket qayta ulanishi bilan yana "online" bo'ladi).
async function resetPresence() {
    await pool.query(`UPDATE users SET status = 'offline' WHERE status <> 'offline'`);
}

// refresh_tokens — har token yangilanishida (har 15 daqiqada, har qurilma
// uchun) yangi qator qo'shiladi; otp_codes — har kod so'rovida. Ularni hech
// kim o'chirmasa, jadvallar cheksiz o'sadi.
//  - muddati o'tgan refresh tokenlar endi hech narsaga yaramaydi;
//  - bekor qilingan (rotation qilingan) tokenlar o'g'irlikni aniqlash uchun
//    7 kun saqlanadi, undan eskisi o'chiriladi;
//  - muddati o'tgan tasdiqlash kodlari bir kundan keyin o'chiriladi.
async function purgeExpiredRows() {
    const tokens = await pool.query(
        `DELETE FROM refresh_tokens
         WHERE expires_at < NOW()
            OR (revoked = true AND created_at < NOW() - INTERVAL '7 days')`
    );
    const otps = await pool.query(
        `DELETE FROM otp_codes WHERE expires_at < NOW() - INTERVAL '1 day'`
    );
    if (tokens.rowCount || otps.rowCount) {
        console.log(`Tozalash: ${tokens.rowCount} ta refresh token, ${otps.rowCount} ta OTP kodi o'chirildi`);
    }
}

function startMaintenance() {
    const run = () => purgeExpiredRows().catch((err) => console.error('Tozalashda xato:', err.message));
    run();
    // unref — bu taymer serverni yopilishdan ushlab turmasin
    setInterval(run, CLEANUP_INTERVAL_MS).unref();
}

module.exports = { resetPresence, purgeExpiredRows, startMaintenance };
