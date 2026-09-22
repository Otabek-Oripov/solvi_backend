const pool = require('../config/db');
const { hashPassword, comparePassword, hashToken, generateRandomToken } = require('../utils/hash');
const { generateAccessToken } = require('../utils/jwt');
const otpService = require('./otp.service');

const REFRESH_EXPIRES_DAYS = parseInt(process.env.JWT_REFRESH_EXPIRES_DAYS || '30', 10);
const MIN_AGE = parseInt(process.env.MIN_AGE || '18', 10);

// Flutter'ga qaytariladigan xavfsiz ustunlar (password_hash hech qachon emas!)
const PUBLIC_USER_FIELDS =
    'id, email, username, full_name, avatar_url, bio, birth_date, gender, is_verified, status, created_at';

function httpError(message, status) {
    const err = new Error(message);
    err.status = status;
    return err;
}

function normalizeEmail(email) {
    return email ? String(email).trim().toLowerCase() : null;
}

function calcAge(birthDate) {
    const b = new Date(birthDate);
    if (Number.isNaN(b.getTime())) return null;

    const now = new Date();
    let age = now.getUTCFullYear() - b.getUTCFullYear();
    const monthDiff = now.getUTCMonth() - b.getUTCMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < b.getUTCDate())) age--;
    return age;
}

// OAuth orqali kirgan user uchun bo'sh username topamiz
async function generateUniqueUsername(client, base) {
    const clean = (String(base || 'user').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20) || 'user')
        .padEnd(3, '0');

    for (let i = 0; i < 10; i++) {
        const candidate = i === 0 ? clean : clean + Math.floor(1000 + Math.random() * 9000);
        const { rows } = await client.query('SELECT 1 FROM users WHERE username = $1', [candidate]);
        if (rows.length === 0) return candidate;
    }
    return clean + Date.now().toString().slice(-6);
}

// ---------- Yordamchi: bir userga access + refresh token juftligini yaratish ----------
async function issueTokens(userId, deviceInfo, db = pool) {
    const accessToken = generateAccessToken(userId);
    const refreshToken = generateRandomToken();

    const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000);

    await db.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, device_info, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [userId, hashToken(refreshToken), deviceInfo || null, expiresAt]
    );

    return { accessToken, refreshToken };
}

// ---------- Email/parol orqali ro'yxatdan o'tish ----------
async function registerWithEmail({ email, password, username, fullName, birthDate }) {
    const mail = normalizeEmail(email);

    // SRS 6-bo'lim: random chat + dating bor, shuning uchun 18+ majburiy
    const age = calcAge(birthDate);
    if (age === null) throw httpError('Tug\'ilgan sana noto\'g\'ri', 400);
    if (age < MIN_AGE) {
        throw httpError('Ilovadan foydalanish uchun kamida ' + MIN_AGE + ' yosh bo\'lishi kerak', 403);
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const dup = await client.query(
            'SELECT email, username FROM users WHERE email = $1 OR username = $2',
            [mail, username]
        );
        if (dup.rows.length > 0) {
            const message = dup.rows.some((r) => r.email === mail)
                ? 'Bu email allaqachon ro\'yxatdan o\'tgan'
                : 'Bu username band';
            throw httpError(message, 409);
        }

        const passwordHash = await hashPassword(password);

        const userResult = await client.query(
            `INSERT INTO users (email, password_hash, username, full_name, birth_date)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING ${PUBLIC_USER_FIELDS}`,
            [mail, passwordHash, username, fullName || null, birthDate]
        );
        const user = userResult.rows[0];

        await client.query(
            `INSERT INTO auth_providers (user_id, provider, provider_user_id, email_at_provider)
             VALUES ($1, 'email', $2, $3)`,
            [user.id, mail, mail]
        );

        await client.query('COMMIT');
        return user;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (err.code === '23505') throw httpError('Bu email yoki username band', 409);
        throw err;
    } finally {
        client.release();
    }
}

// ---------- Email/parol orqali kirish ----------
async function loginWithEmail({ email, password, deviceInfo }) {
    const mail = normalizeEmail(email);

    const result = await pool.query(
        'SELECT id, password_hash, is_active, is_verified FROM users WHERE email = $1',
        [mail]
    );
    const user = result.rows[0];

    // Email topilmasa ham bcrypt chaqiramiz: javob vaqtiga qarab
    // "bu email bazada bormi" degan xulosa chiqarib bo'lmasligi uchun.
    const hash = (user && user.password_hash)
        || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const isMatch = await comparePassword(password, hash);

    if (!user || !user.password_hash || !isMatch) {
        throw httpError('Email yoki parol noto\'g\'ri', 401);
    }
    if (!user.is_active) throw httpError('Hisob bloklangan', 403);
    if (!user.is_verified) {
        throw httpError('Email tasdiqlanmagan. Avval emailingizga yuborilgan kodni tasdiqlang.', 403);
    }

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    return issueTokens(user.id, deviceInfo);
}

// ---------- Google/Facebook uchun umumiy: topish / bog'lash / yaratish ----------
// provider: 'google' | 'facebook'
// providerUserId: Google'ning "sub" yoki Facebook'ning "id" qiymati
async function findOrCreateOAuthUser({ provider, providerUserId, email, fullName, avatarUrl, deviceInfo }) {
    const mail = normalizeEmail(email);
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1) Shu provider + providerUserId bo'yicha avval bog'langan userni qidiramiz
        const existingProvider = await client.query(
            'SELECT user_id FROM auth_providers WHERE provider = $1 AND provider_user_id = $2',
            [provider, providerUserId]
        );

        let userId = existingProvider.rows[0] && existingProvider.rows[0].user_id;

        // 2) Bog'lanmagan, lekin shu email bilan boshqa usulda ro'yxatdan o'tganmi?
        if (!userId && mail) {
            const existingUser = await client.query('SELECT id FROM users WHERE email = $1', [mail]);
            if (existingUser.rows.length > 0) {
                // Mavjud hisobga yangi kirish usulini bog'laymiz (account linking)
                userId = existingUser.rows[0].id;
                await client.query(
                    `INSERT INTO auth_providers (user_id, provider, provider_user_id, email_at_provider)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (provider, provider_user_id) DO NOTHING`,
                    [userId, provider, providerUserId, mail]
                );
            }
        }

        // 3) Hech narsa topilmadi — mutlaqo yangi user yaratamiz
        if (!userId) {
            const username = await generateUniqueUsername(
                client,
                mail ? mail.split('@')[0] : provider + '_' + providerUserId
            );

            const newUser = await client.query(
                `INSERT INTO users (email, username, full_name, avatar_url, is_verified)
                 VALUES ($1, $2, $3, $4, true) RETURNING id`,
                [mail, username, fullName || null, avatarUrl || null]
            );
            userId = newUser.rows[0].id;

            await client.query(
                `INSERT INTO auth_providers (user_id, provider, provider_user_id, email_at_provider)
                 VALUES ($1, $2, $3, $4)`,
                [userId, provider, providerUserId, mail]
            );
        }

        const active = await client.query('SELECT is_active FROM users WHERE id = $1', [userId]);
        if (!active.rows[0].is_active) throw httpError('Hisob bloklangan', 403);

        await client.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);

        const tokens = await issueTokens(userId, deviceInfo, client);
        await client.query('COMMIT');
        return tokens;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

// ---------- Access tokenni yangilash (ROTATION bilan) ----------
async function refreshAccessToken(refreshToken, deviceInfo) {
    const tokenHash = hashToken(refreshToken);
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { rows } = await client.query(
            `SELECT id, user_id, expires_at, revoked, replaced_by_hash
             FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
            [tokenHash]
        );
        const row = rows[0];

        if (!row) {
            await client.query('ROLLBACK');
            throw httpError('Refresh token yaroqsiz', 401);
        }

        if (row.revoked) {
            // replaced_by_hash bo'sh bo'lsa — token oddiy logout bilan yopilgan.
            // Bu xavf emas, shuning uchun boshqa qurilmalarga tegmaymiz.
            if (!row.replaced_by_hash) {
                await client.query('ROLLBACK');
                throw httpError('Refresh token yaroqsiz. Qaytadan kiring.', 401);
            }

            // Rotation qilingan token QAYTA ishlatildi — o'g'irlangan deb hisoblaymiz
            // va shu foydalanuvchining BARCHA sessiyalarini yopamiz.
            await client.query('UPDATE refresh_tokens SET revoked = true WHERE user_id = $1', [row.user_id]);
            await client.query('COMMIT');
            throw httpError('Sessiya xavfsizlik sababli bekor qilindi. Qaytadan kiring.', 401);
        }

        if (new Date(row.expires_at) < new Date()) {
            await client.query('ROLLBACK');
            throw httpError('Refresh token muddati o\'tgan', 401);
        }

        const newRefreshToken = generateRandomToken();
        const newHash = hashToken(newRefreshToken);
        const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_DAYS * 24 * 60 * 60 * 1000);

        await client.query(
            `INSERT INTO refresh_tokens (user_id, token_hash, device_info, expires_at)
             VALUES ($1, $2, $3, $4)`,
            [row.user_id, newHash, deviceInfo || null, expiresAt]
        );
        await client.query(
            'UPDATE refresh_tokens SET revoked = true, replaced_by_hash = $2 WHERE id = $1',
            [row.id, newHash]
        );

        await client.query('COMMIT');

        return { accessToken: generateAccessToken(row.user_id), refreshToken: newRefreshToken };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

// ---------- Chiqish (refresh tokenni bekor qilish) ----------
async function revokeRefreshToken(refreshToken) {
    await pool.query(
        'UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1',
        [hashToken(refreshToken)]
    );
}

// ---------- Barcha qurilmalardan chiqish ----------
async function revokeAllForUser(userId) {
    await pool.query(
        'UPDATE refresh_tokens SET revoked = true WHERE user_id = $1 AND revoked = false',
        [userId]
    );
}

// ---------- Email tasdiqlash kodini tekshirish (ro'yxatdan o'tishni yakunlaydi) ----------
async function verifyEmailCode({ email, code, deviceInfo }) {
    const mail = normalizeEmail(email);

    await otpService.verifyOtp({ email: mail, code, purpose: 'register' });

    const { rows } = await pool.query(
        'UPDATE users SET is_verified = true WHERE email = $1 RETURNING id, is_active',
        [mail]
    );
    const user = rows[0];
    if (!user) throw httpError('Foydalanuvchi topilmadi', 404);
    if (!user.is_active) throw httpError('Hisob bloklangan', 403);

    // Tasdiqlangach darhol login qilingan hisoblanadi
    return issueTokens(user.id, deviceInfo);
}

// ---------- Tasdiqlash kodini qayta yuborish ----------
async function resendVerificationCode(email) {
    const mail = normalizeEmail(email);

    const { rows } = await pool.query('SELECT id, is_verified FROM users WHERE email = $1', [mail]);
    const user = rows[0];
    if (!user) throw httpError('Bu email bilan ro\'yxatdan o\'tilmagan', 404);
    if (user.is_verified) throw httpError('Bu email allaqachon tasdiqlangan', 400);

    await otpService.sendOtp({ email: mail, purpose: 'register', userId: user.id });
}

module.exports = {
    registerWithEmail,
    loginWithEmail,
    findOrCreateOAuthUser,
    refreshAccessToken,
    revokeRefreshToken,
    revokeAllForUser,
    verifyEmailCode,
    resendVerificationCode,
};
