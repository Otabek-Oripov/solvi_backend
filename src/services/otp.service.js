const pool = require('../config/db');
const { hashToken } = require('../utils/hash');
const { sendEmail } = require('./email.service');

const OTP_EXPIRES_MINUTES = parseInt(process.env.OTP_EXPIRES_MINUTES || '10', 10);
const OTP_RESEND_COOLDOWN_SECONDS = 60;

function httpError(message, status) {
    const err = new Error(message);
    err.status = status;
    return err;
}

// 100000-999999 — har doim aynan 6 xonali, yetakchi nol muammosi yo'q
function generateCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
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

    await sendEmail({
        to: email,
        subject: 'Solvi — tasdiqlash kodi',
        html: emailHtml(code),
    });
}

// ---------- Kodni tekshirish ----------
async function verifyOtp({ email, code, purpose }) {
    const { rows } = await pool.query(
        `SELECT id, code_hash, expires_at, used FROM otp_codes
         WHERE phone_or_email = $1 AND purpose = $2
         ORDER BY created_at DESC LIMIT 1`,
        [email, purpose]
    );
    const row = rows[0];

    if (!row) throw httpError('Tasdiqlash kodi topilmadi. Yangi kod so\'rang.', 400);
    if (row.used) throw httpError('Bu kod allaqachon ishlatilgan', 400);
    if (new Date(row.expires_at) < new Date()) throw httpError('Kod muddati o\'tgan. Yangi kod so\'rang.', 400);
    if (row.code_hash !== hashToken(code)) throw httpError('Kod noto\'g\'ri', 400);

    await pool.query('UPDATE otp_codes SET used = true WHERE id = $1', [row.id]);
}

module.exports = { sendOtp, verifyOtp };
