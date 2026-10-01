const crypto = require('crypto');
const pool = require('../config/db');
const { hashToken } = require('../utils/hash');
const { httpError } = require('../utils/http');
const { sendEmail } = require('./email.service');

const OTP_EXPIRES_MINUTES = parseInt(process.env.OTP_EXPIRES_MINUTES || '10', 10);
const OTP_RESEND_COOLDOWN_SECONDS = 60;
// 6 xonali kod — 1 000 000 variant. Urinishlar cheklanmasa, kodni shunchaki
// ketma-ket sinab topish mumkin; shu sondan keyin kod yaroqsiz bo'ladi.
const OTP_MAX_ATTEMPTS = 5;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// 100000-999999 — har doim aynan 6 xonali, yetakchi nol muammosi yo'q.
// crypto.randomInt — Math.random'dan farqli, oldindan aytib bo'lmaydi.
function generateCode() {
    return String(crypto.randomInt(100000, 1000000));
}

function emailHtml(code) {
    return `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2>Solvi — tasdiqlash kodi</h2>
            <p>Ro'yxatdan o'tishni yakunlash uchun quyidagi kodni ilovaga kiriting:</p>
            <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px;">${code}</p>
            <p>Kod ${OTP_EXPIRES_MINUTES} daqiqa amal qiladi. Agar bu so'rovni siz yubormagan bo'lsangiz, xabarni e'tiborsiz qoldiring.</p>
        </div>
    `;
}

// ---------- Kod generatsiya qilib email'ga yuborish ----------
async function sendOtp({ email, purpose, userId }) {
    // Email bombardimon qilinmasligi uchun: oxirgi kod 60 soniya ichida
    // yuborilgan bo'lsa, yangisini yubormaymiz.
    const recent = await pool.query(
        `SELECT created_at FROM otp_codes
         WHERE phone_or_email = $1 AND purpose = $2
         ORDER BY created_at DESC LIMIT 1`,
        [email, purpose]
    );
    if (recent.rows[0]) {
        const secondsAgo = (Date.now() - new Date(recent.rows[0].created_at).getTime()) / 1000;
        if (secondsAgo < OTP_RESEND_COOLDOWN_SECONDS) {
            throw httpError(
                `Yangi kod so'rashdan oldin ${Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - secondsAgo)} soniya kuting`,
                429
            );
        }
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000);

    await pool.query(
        `INSERT INTO otp_codes (user_id, phone_or_email, code_hash, purpose, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId || null, email, hashToken(code), purpose, expiresAt]
    );

    // Lokal ishlab chiqishda email xizmati sozlanmagan bo'lishi mumkin
    // (masalan Resend'ning sinov manzili faqat hisob egasiga yuboradi) —
    // shuning uchun kod server konsoliga ham chiqariladi va email yuborilmasa
    // ham jarayon to'xtamaydi. Production'da kod HECH QACHON loglanmaydi.
    if (!IS_PRODUCTION) {
        console.log(`[DEV] Tasdiqlash kodi (${email}): ${code}`);
    }

    try {
        await sendEmail({
            to: email,
            subject: 'Solvi — tasdiqlash kodi',
            html: emailHtml(code),
        });
    } catch (err) {
        if (IS_PRODUCTION) throw err;
        console.warn('[DEV] Email yuborilmadi, kod yuqorida konsolda:', err.message);
    }
}

// ---------- Kodni tekshirish ----------
async function verifyOtp({ email, code, purpose }) {
    const { rows } = await pool.query(
        `SELECT id, code_hash, expires_at, used, attempts FROM otp_codes
         WHERE phone_or_email = $1 AND purpose = $2
         ORDER BY created_at DESC LIMIT 1`,
        [email, purpose]
    );
    const row = rows[0];

    if (!row) throw httpError('Tasdiqlash kodi topilmadi. Yangi kod so\'rang.', 400);
    if (row.used) throw httpError('Bu kod allaqachon ishlatilgan', 400);
    if (new Date(row.expires_at) < new Date()) throw httpError('Kod muddati o\'tgan. Yangi kod so\'rang.', 400);
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
        throw httpError('Juda ko\'p noto\'g\'ri urinish. Yangi kod so\'rang.', 429);
    }

    const expected = Buffer.from(row.code_hash);
    const actual = Buffer.from(hashToken(String(code)));
    const matches = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

    if (!matches) {
        await pool.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
        throw httpError('Kod noto\'g\'ri', 400);
    }

    // `used = false` sharti — bitta kod bir vaqtda kelgan ikki so'rovda
    // ikki marta ishlatilmasligi uchun.
    const marked = await pool.query(
        'UPDATE otp_codes SET used = true WHERE id = $1 AND used = false RETURNING id',
        [row.id]
    );
    if (!marked.rows[0]) throw httpError('Bu kod allaqachon ishlatilgan', 400);
}

module.exports = { sendOtp, verifyOtp };
