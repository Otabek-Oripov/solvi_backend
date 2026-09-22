const pool = require('../config/db');

// Flutter'ga qaytariladigan xavfsiz ustunlar (password_hash hech qachon emas).
const PUBLIC_USER_FIELDS = `
    id, email, username, full_name, avatar_url, bio, birth_date, gender,
    is_verified, status, created_at,
    goal, work, school, location_country, location_city,
    height_cm, weight_kg, star_sign, exercise,
    education_level, marital_status, has_kids, drinking, smoking,
    pets, religion, core_values, interests, languages_known
`;

// PATCH /users/me orqali kelishi mumkin bo'lgan oddiy (skalyar) maydonlar —
// column nomi so'rov kalitiga to'g'ridan-to'g'ri mos.
const SIMPLE_FIELDS = [
    'fullName:full_name', 'bio:bio', 'gender:gender', 'avatarUrl:avatar_url',
    'goal:goal', 'work:work', 'school:school',
    'locationCountry:location_country', 'locationCity:location_city',
    'heightCm:height_cm', 'weightKg:weight_kg',
    'starSign:star_sign', 'exercise:exercise',
    'educationLevel:education_level', 'maritalStatus:marital_status', 'hasKids:has_kids',
    'drinking:drinking', 'smoking:smoking', 'pets:pets', 'religion:religion',
    'coreValues:core_values',
].map((s) => s.split(':'));

const MAX_PHOTOS = 9;

function httpError(message, status) {
    const err = new Error(message);
    err.status = status;
    return err;
}

// ---------- Followers/following/posts soni + (agar viewer berilsa) kuzatish holati ----------
async function attachExtras(user, viewerId) {
    const counts = await pool.query(
        `SELECT
            (SELECT COUNT(*) FROM follows WHERE following_id = $1) AS followers_count,
            (SELECT COUNT(*) FROM follows WHERE follower_id = $1) AS following_count,
            (SELECT COUNT(*) FROM posts WHERE user_id = $1) AS posts_count`,
        [user.id]
    );

    let isFollowing = false;
    if (viewerId && viewerId !== user.id) {
        const f = await pool.query(
            'SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2',
            [viewerId, user.id]
        );
        isFollowing = f.rows.length > 0;
    }

    return {
        ...user,
        followers_count: parseInt(counts.rows[0].followers_count, 10),
        following_count: parseInt(counts.rows[0].following_count, 10),
        posts_count: parseInt(counts.rows[0].posts_count, 10),
        is_following: isFollowing,
    };
}

// ---------- Profilni ID bo'yicha olish (o'zi yoki boshqa foydalanuvchi) ----------
// viewerId — so'rovni yuborayotgan (token orqali autentifikatsiya qilingan)
// foydalanuvchi; is_following shu asosda hisoblanadi.
async function getProfile(userId, viewerId) {
    const { rows } = await pool.query(
        `SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE id = $1 AND is_active = true`,
        [userId]
    );
    if (!rows[0]) throw httpError('Foydalanuvchi topilmadi', 404);

    const photos = await pool.query(
        'SELECT id, url, position FROM user_photos WHERE user_id = $1 ORDER BY position ASC',
        [userId]
    );
    return attachExtras({ ...rows[0], photos: photos.rows }, viewerId);
}

// ---------- O'z profilini tahrirlash ----------
// Faqat kelgan (undefined bo'lmagan) maydonlar yangilanadi.
async function updateProfile(userId, body) {
    const fields = [];
    const values = [];
    let i = 1;

    // username o'zgarayotgan bo'lsa — bandligini tekshiramiz
    if (body.username !== undefined) {
        const dup = await pool.query(
            'SELECT id FROM users WHERE username = $1 AND id <> $2',
            [body.username, userId]
        );
        if (dup.rows.length > 0) throw httpError('Bu username band', 409);
        fields.push(`username = $${i++}`);
        values.push(body.username);
    }

    for (const [key, column] of SIMPLE_FIELDS) {
        if (body[key] !== undefined) {
            fields.push(`${column} = $${i++}`);
            values.push(body[key] === '' ? null : body[key]);
        }
    }

    // Massiv maydonlar (interests, languages_known) — array sifatida yuboriladi
    if (body.interests !== undefined) {
        fields.push(`interests = $${i++}`);
        values.push(Array.isArray(body.interests) ? body.interests : []);
    }
    if (body.languagesKnown !== undefined) {
        fields.push(`languages_known = $${i++}`);
        values.push(Array.isArray(body.languagesKnown) ? body.languagesKnown : []);
    }

    if (fields.length === 0) {
        // Hech narsa o'zgarmadi — joriy profilni qaytaramiz
        return getProfile(userId);
    }

    values.push(userId);
    try {
        const { rows } = await pool.query(
            `UPDATE users SET ${fields.join(', ')} WHERE id = $${i}
             RETURNING ${PUBLIC_USER_FIELDS}`,
            values
        );
        if (!rows[0]) throw httpError('Foydalanuvchi topilmadi', 404);

        const photos = await pool.query(
            'SELECT id, url, position FROM user_photos WHERE user_id = $1 ORDER BY position ASC',
            [userId]
        );
        return attachExtras({ ...rows[0], photos: photos.rows }, userId);
    } catch (err) {
        if (err.code === '23505') throw httpError('Bu username band', 409);
        throw err;
    }
}

// ---------- Rasmlar ----------
async function listPhotos(userId) {
    const { rows } = await pool.query(
        'SELECT id, url, position FROM user_photos WHERE user_id = $1 ORDER BY position ASC',
        [userId]
    );
    return rows;
}

// Alohida avatar tayinlanmagan bo'lsa — birinchi profil rasmi avatar
// sifatida ishlatiladi (feed, follow ro'yxati, reels va h.k. — barcha
// joylarda `avatar_url` shu asosda to'g'ri ko'rinadi, alohida fallback
// yozish shart bo'lmaydi).
async function addPhoto(userId, url) {
    const count = await pool.query('SELECT COUNT(*) FROM user_photos WHERE user_id = $1', [userId]);
    if (parseInt(count.rows[0].count, 10) >= MAX_PHOTOS) {
        throw httpError(`Ko'pi bilan ${MAX_PHOTOS} ta rasm yuklash mumkin`, 409);
    }

    const maxPos = await pool.query(
        'SELECT COALESCE(MAX(position), -1) AS max_pos FROM user_photos WHERE user_id = $1',
        [userId]
    );
    const nextPos = maxPos.rows[0].max_pos + 1;

    const { rows } = await pool.query(
        `INSERT INTO user_photos (user_id, url, position) VALUES ($1, $2, $3)
         RETURNING id, url, position`,
        [userId, url, nextPos]
    );

    await pool.query(
        'UPDATE users SET avatar_url = $1 WHERE id = $2 AND avatar_url IS NULL',
        [url, userId]
    );

    return rows[0];
}

async function deletePhoto(userId, photoId) {
    const deleted = await pool.query(
        'DELETE FROM user_photos WHERE id = $1 AND user_id = $2 RETURNING id, url',
        [photoId, userId]
    );
    if (!deleted.rows[0]) throw httpError('Rasm topilmadi', 404);

    // O'chirilgan rasm avatar sifatida ishlatilayotgan bo'lsa — qolgan eng
    // birinchi rasmga (yoki hech narsa qolmasa NULL'ga) almashtiramiz.
    const user = await pool.query('SELECT avatar_url FROM users WHERE id = $1', [userId]);
    if (user.rows[0]?.avatar_url === deleted.rows[0].url) {
        const next = await pool.query(
            'SELECT url FROM user_photos WHERE user_id = $1 ORDER BY position ASC LIMIT 1',
            [userId]
        );
        await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [
            next.rows[0]?.url || null,
            userId,
        ]);
    }
}

async function reorderPhotos(userId, orderedIds) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (let pos = 0; pos < orderedIds.length; pos++) {
            await client.query(
                'UPDATE user_photos SET position = $1 WHERE id = $2 AND user_id = $3',
                [pos, orderedIds[pos], userId]
            );
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
    return listPhotos(userId);
}

// ---------- Follow / Unfollow ----------
async function followUser(followerId, targetId) {
    if (followerId === targetId) {
        throw httpError('O\'zingizni kuzatib bo\'lmaydi', 400);
    }

    const target = await pool.query(
        'SELECT id FROM users WHERE id = $1 AND is_active = true',
        [targetId]
    );
    if (!target.rows[0]) throw httpError('Foydalanuvchi topilmadi', 404);

    try {
        await pool.query(
            'INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)',
            [followerId, targetId]
        );
    } catch (err) {
        if (err.code === '23505') throw httpError('Siz allaqachon kuzatyapsiz', 409);
        throw err;
    }

    return getProfile(targetId, followerId);
}

async function unfollowUser(followerId, targetId) {
    const { rows } = await pool.query(
        'DELETE FROM follows WHERE follower_id = $1 AND following_id = $2 RETURNING id',
        [followerId, targetId]
    );
    if (!rows[0]) throw httpError('Siz bu foydalanuvchini kuzatmayapsiz', 404);

    return getProfile(targetId, followerId);
}

// Ro'yxatlarda (barcha/following/followers) ishlatiladigan qisqa profil —
// to'liq PUBLIC_USER_FIELDS shart emas, faqat kartochka uchun kerakli maydonlar.
const LIST_USER_FIELDS = 'u.id, u.username, u.full_name, u.avatar_url, u.status';

// ---------- Barcha foydalanuvchilar (qidiruv bilan) ----------
async function listUsers({ search, limit, cursor, viewerId }) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 60);
    const params = [viewerId];
    let where = 'WHERE u.id <> $1 AND u.is_active = true';

    if (search) {
        params.push(`%${search}%`);
        where += ` AND (u.username ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`;
    }
    if (cursor) {
        params.push(cursor);
        where += ` AND u.created_at < $${params.length}`;
    }
    params.push(safeLimit);

    const { rows } = await pool.query(
        `SELECT ${LIST_USER_FIELDS}, u.created_at,
                EXISTS(
                    SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = u.id
                ) AS is_following
         FROM users u
         ${where}
         ORDER BY is_following DESC, u.created_at DESC
         LIMIT $${params.length}`,
        params
    );
    return rows;
}

// ---------- userId kuzatayotgan foydalanuvchilar ro'yxati ----------
async function listFollowing(userId, { limit, cursor, viewerId }) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 60);
    const params = [viewerId, userId];
    let where = 'WHERE f.follower_id = $2';
    if (cursor) {
        params.push(cursor);
        where += ` AND f.created_at < $${params.length}`;
    }
    params.push(safeLimit);

    const { rows } = await pool.query(
        `SELECT ${LIST_USER_FIELDS}, f.created_at,
                EXISTS(
                    SELECT 1 FROM follows f2 WHERE f2.follower_id = $1 AND f2.following_id = u.id
                ) AS is_following
         FROM follows f
         JOIN users u ON u.id = f.following_id
         ${where}
         ORDER BY f.created_at DESC
         LIMIT $${params.length}`,
        params
    );
    return rows;
}

// ---------- userId'ni kuzatayotganlar ro'yxati ----------
// is_following — VIEWER shu qatordagi foydalanuvchini kuzatayaptimi (ya'ni
// "followback" qilinganmi) — Flutter shu asosda "Follow"/"Message" ko'rsatadi.
async function listFollowers(userId, { limit, cursor, viewerId }) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 60);
    const params = [viewerId, userId];
    let where = 'WHERE f.following_id = $2';
    if (cursor) {
        params.push(cursor);
        where += ` AND f.created_at < $${params.length}`;
    }
    params.push(safeLimit);

    const { rows } = await pool.query(
        `SELECT ${LIST_USER_FIELDS}, f.created_at,
                EXISTS(
                    SELECT 1 FROM follows f2 WHERE f2.follower_id = $1 AND f2.following_id = u.id
                ) AS is_following
         FROM follows f
         JOIN users u ON u.id = f.follower_id
         ${where}
         ORDER BY f.created_at DESC
         LIMIT $${params.length}`,
        params
    );
    return rows;
}

module.exports = {
    getProfile,
    updateProfile,
    listPhotos,
    addPhoto,
    deletePhoto,
    reorderPhotos,
    followUser,
    unfollowUser,
    listUsers,
    listFollowing,
    listFollowers,
    MAX_PHOTOS,
};
