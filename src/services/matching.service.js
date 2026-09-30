const pool = require('../config/db');
const { getOrCreateDirectConversation } = require('./messaging.service');

function httpError(message, status) {
    const err = new Error(message);
    err.status = status;
    return err;
}

// Swipe kartasi uchun kerakli maydonlar — profil edit'da kiritiladigan
// kengaytirilgan maydonlarning deyarli barchasi (users.service.js dagi
// PUBLIC_USER_FIELDS bilan mos), password/email kabi maxfiy narsalar yo'q.
const CANDIDATE_FIELDS = `
    u.id, u.username, u.full_name, u.avatar_url, u.bio, u.birth_date, u.gender,
    u.location_city, u.location_country, u.work, u.school,
    u.height_cm, u.weight_kg, u.goal, u.star_sign, u.exercise,
    u.education_level, u.marital_status, u.has_kids, u.drinking, u.smoking,
    u.pets, u.religion, u.core_values, u.interests, u.languages_known
`;

// ---------- Filtr (Search filters) asosida SQL WHERE qismini quradi ----------
function buildFilterClause(filters, params) {
    let clause = '';

    const addEquals = (column, value) => {
        if (value == null || value === '') return;
        params.push(value);
        clause += ` AND u.${column} = $${params.length}`;
    };
    const addIn = (column, values) => {
        if (!Array.isArray(values) || values.length === 0) return;
        params.push(values);
        clause += ` AND u.${column} = ANY($${params.length})`;
    };
    const addOverlap = (column, values) => {
        if (!Array.isArray(values) || values.length === 0) return;
        params.push(values);
        clause += ` AND u.${column} && $${params.length}`;
    };
    const addRange = (column, min, max) => {
        if (min != null && !Number.isNaN(min)) {
            params.push(min);
            clause += ` AND u.${column} >= $${params.length}`;
        }
        if (max != null && !Number.isNaN(max)) {
            params.push(max);
            clause += ` AND u.${column} <= $${params.length}`;
        }
    };

    addEquals('gender', filters.gender);

    // Yosh oralig'i — birth_date bo'yicha teskari hisoblanadi (katta yosh =
    // kichikroq/eskiroq sana).
    if (filters.maxAge != null && !Number.isNaN(filters.maxAge)) {
        const minBirthDate = new Date();
        minBirthDate.setFullYear(minBirthDate.getFullYear() - filters.maxAge - 1);
        params.push(minBirthDate.toISOString().slice(0, 10));
        clause += ` AND u.birth_date >= $${params.length}`;
    }
    if (filters.minAge != null && !Number.isNaN(filters.minAge)) {
        const maxBirthDate = new Date();
        maxBirthDate.setFullYear(maxBirthDate.getFullYear() - filters.minAge);
        params.push(maxBirthDate.toISOString().slice(0, 10));
        clause += ` AND u.birth_date <= $${params.length}`;
    }

    if (filters.locationCity) {
        params.push(`%${filters.locationCity}%`);
        clause += ` AND u.location_city ILIKE $${params.length}`;
    }

    addRange('height_cm', filters.minHeight, filters.maxHeight);
    addRange('weight_kg', filters.minWeight, filters.maxWeight);

    addIn('goal', filters.goals);
    addIn('education_level', filters.educationLevels);
    addIn('marital_status', filters.maritalStatuses);
    addIn('has_kids', filters.hasKids);
    addIn('drinking', filters.drinking);
    addIn('smoking', filters.smoking);
    addIn('pets', filters.pets);
    addIn('religion', filters.religion);
    addIn('core_values', filters.coreValues);
    addIn('star_sign', filters.starSigns);
    addIn('exercise', filters.exercise);
    addOverlap('languages_known', filters.languages);
    addOverlap('interests', filters.interests);

    return clause;
}

// ---------- Navbatdagi swipe kartalari ----------
// O'zi va allaqachon swipe qilingan (like/pass) foydalanuvchilar chiqarib
// tashlanadi — bir marta "pass" qilingan odam qayta ko'rsatilmaydi.
// `filters` — "Search filters" ekranidan kelgan ixtiyoriy qidiruv shartlari.
async function getCandidates(userId, { limit, filters = {} } = {}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
    const params = [userId];
    const filterClause = buildFilterClause(filters, params);
    params.push(safeLimit);

    const { rows } = await pool.query(
        `SELECT ${CANDIDATE_FIELDS}
         FROM users u
         WHERE u.id <> $1
           AND u.is_active = true
           AND NOT EXISTS (SELECT 1 FROM swipes s WHERE s.swiper_id = $1 AND s.target_id = u.id)
           ${filterClause}
         ORDER BY u.created_at DESC
         LIMIT $${params.length}`,
        params
    );
    if (rows.length === 0) return rows;

    const ids = rows.map((r) => r.id);
    const photos = await pool.query(
        'SELECT user_id, url FROM user_photos WHERE user_id = ANY($1::uuid[]) ORDER BY position ASC',
        [ids]
    );
    const photosByUser = new Map();
    for (const p of photos.rows) {
        if (!photosByUser.has(p.user_id)) photosByUser.set(p.user_id, []);
        photosByUser.get(p.user_id).push(p.url);
    }
    return rows.map((r) => ({ ...r, photos: photosByUser.get(r.id) || [] }));
}

// ---------- Swipe qilish (like/pass) ----------
// Ikki tomon ham bir-birini "like" qilgan bo'lsa — match yaratiladi va
// ular orasida (mavjud bo'lmasa) suhbat ochiladi.
async function swipe(userId, targetId, action) {
    if (!targetId) throw httpError('targetId kerak', 400);
    if (userId === targetId) throw httpError('O\'zingizni swipe qila olmaysiz', 400);
    if (!['like', 'pass'].includes(action)) throw httpError('action \'like\' yoki \'pass\' bo\'lishi kerak', 400);

    const target = await pool.query('SELECT id FROM users WHERE id = $1 AND is_active = true', [targetId]);
    if (!target.rows[0]) throw httpError('Foydalanuvchi topilmadi', 404);

    await pool.query(
        `INSERT INTO swipes (swiper_id, target_id, action)
         VALUES ($1, $2, $3)
         ON CONFLICT (swiper_id, target_id) DO UPDATE SET action = EXCLUDED.action, created_at = NOW()`,
        [userId, targetId, action]
    );

    if (action !== 'like') return { matched: false };

    const mutual = await pool.query(
        `SELECT 1 FROM swipes WHERE swiper_id = $1 AND target_id = $2 AND action = 'like'`,
        [targetId, userId]
    );
    if (!mutual.rows[0]) return { matched: false };

    const userAId = userId < targetId ? userId : targetId;
    const userBId = userId < targetId ? targetId : userId;

    const existing = await pool.query(
        'SELECT id, conversation_id FROM matches WHERE user_a_id = $1 AND user_b_id = $2',
        [userAId, userBId]
    );

    let matchRow;
    if (existing.rows[0]) {
        matchRow = existing.rows[0];
    } else {
        const conversation = await getOrCreateDirectConversation(userId, targetId);
        const { rows } = await pool.query(
            `INSERT INTO matches (user_a_id, user_b_id, conversation_id)
             VALUES ($1, $2, $3) RETURNING id, conversation_id`,
            [userAId, userBId, conversation.conversation_id]
        );
        matchRow = rows[0];
    }

    const otherUser = await pool.query(
        'SELECT id, username, full_name, avatar_url FROM users WHERE id = $1',
        [targetId]
    );

    return {
        matched: true,
        matchId: matchRow.id,
        conversationId: matchRow.conversation_id,
        user: otherUser.rows[0],
    };
}

// ---------- Mavjud matchlar ro'yxati ----------
async function getMatches(userId) {
    const { rows } = await pool.query(
        `SELECT m.id AS match_id, m.matched_at, m.conversation_id,
                u.id, u.username, u.full_name, u.avatar_url
         FROM matches m
         JOIN users u ON u.id = CASE WHEN m.user_a_id = $1 THEN m.user_b_id ELSE m.user_a_id END
         WHERE m.user_a_id = $1 OR m.user_b_id = $1
         ORDER BY m.matched_at DESC`,
        [userId]
    );
    return rows;
}

// ---------- "Sevimlilar" — o'zim "like" qilgan foydalanuvchilar ----------
// Match bo'lgan-bo'lmaganidan qat'iy nazar, faqat MEN like qilganlar
// (Profil sahifasidagi "Sevimlilar" bo'limi, follow tugmalari bilan).
async function getLikedUsers(userId) {
    const { rows } = await pool.query(
        `SELECT u.id, u.username, u.full_name, u.avatar_url, u.status, s.created_at,
                EXISTS(
                    SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = u.id
                ) AS is_following
         FROM swipes s
         JOIN users u ON u.id = s.target_id
         WHERE s.swiper_id = $1 AND s.action = 'like' AND u.is_active = true
         ORDER BY s.created_at DESC`,
        [userId]
    );
    return rows;
}

module.exports = { getCandidates, swipe, getMatches, getLikedUsers };
