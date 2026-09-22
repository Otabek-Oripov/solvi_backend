const pool = require('../config/db');

function httpError(message, status) {
    const err = new Error(message);
    err.status = status;
    return err;
}

// Suhbat ishtirokchilarining id'lari — real-time xabarni ularning shaxsiy
// socket xonalariga yuborish uchun (chat ro'yxati ekranida ham yangilanishi
// kerak, u yerda suhbat xonasiga qo'shilmagan bo'ladi).
async function listParticipantIds(conversationId) {
    const { rows } = await pool.query(
        'SELECT user_id FROM conversation_participants WHERE conversation_id = $1',
        [conversationId]
    );
    return rows.map((r) => r.user_id);
}

async function isParticipant(conversationId, userId) {
    const { rows } = await pool.query(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2',
        [conversationId, userId]
    );
    return rows.length > 0;
}

// ---------- 1:1 suhbatni topish yoki yaratish ----------
// V1: faqat ikki kishilik (is_group = false) suhbatlar. Ikkala foydalanuvchi
// orasida allaqachon suhbat bo'lsa — o'shani qaytaradi, bo'lmasa yangi yaratadi.
async function getOrCreateDirectConversation(userId, otherUserId) {
    if (userId === otherUserId) {
        throw httpError('O\'zingiz bilan suhbat boshlab bo\'lmaydi', 400);
    }

    const otherUser = await pool.query(
        'SELECT id FROM users WHERE id = $1 AND is_active = true',
        [otherUserId]
    );
    if (!otherUser.rows[0]) throw httpError('Foydalanuvchi topilmadi', 404);

    const existing = await pool.query(
        `SELECT c.id
         FROM conversations c
         JOIN conversation_participants p1 ON p1.conversation_id = c.id AND p1.user_id = $1
         JOIN conversation_participants p2 ON p2.conversation_id = c.id AND p2.user_id = $2
         WHERE c.is_group = false
         LIMIT 1`,
        [userId, otherUserId]
    );
    if (existing.rows[0]) return getConversationSummary(existing.rows[0].id, userId);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            'INSERT INTO conversations (is_group) VALUES (false) RETURNING id'
        );
        const conversationId = rows[0].id;
        await client.query(
            `INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
            [conversationId, userId, otherUserId]
        );
        await client.query('COMMIT');
        return getConversationSummary(conversationId, userId);
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

// ---------- Bitta suhbat haqida qisqacha ma'lumot (ro'yxat elementi shakli) ----------
async function getConversationSummary(conversationId, viewerId) {
    const { rows } = await pool.query(
        `SELECT c.id AS conversation_id,
                ou.id AS other_user_id, ou.username, ou.avatar_url, ou.status,
                lm.content AS last_message_content, lm.type AS last_message_type,
                lm.created_at AS last_message_at, lm.sender_id AS last_message_sender_id,
                COALESCE(uc.unread_count, 0)::int AS unread_count
         FROM conversations c
         JOIN conversation_participants op ON op.conversation_id = c.id AND op.user_id <> $2
         JOIN users ou ON ou.id = op.user_id
         LEFT JOIN LATERAL (
             SELECT content, type, created_at, sender_id
             FROM messages m WHERE m.conversation_id = c.id
             ORDER BY m.created_at DESC LIMIT 1
         ) lm ON true
         LEFT JOIN LATERAL (
             SELECT COUNT(*) AS unread_count FROM messages m2
             WHERE m2.conversation_id = c.id AND m2.sender_id <> $2 AND m2.status <> 'read'
         ) uc ON true
         WHERE c.id = $1`,
        [conversationId, viewerId]
    );
    return rows[0];
}

// ---------- Foydalanuvchining barcha suhbatlari ro'yxati ----------
// Eng so'nggi xabar vaqti bo'yicha kamayish tartibida (xabar bo'lmasa —
// suhbat yaratilgan vaqti bo'yicha). V1'da suhbatlar soni kam bo'lishi
// kutilgani uchun cursor pagination o'rniga oddiy limit ishlatiladi.
async function listConversations(userId, { limit } = {}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);

    const { rows } = await pool.query(
        `SELECT c.id AS conversation_id,
                ou.id AS other_user_id, ou.username, ou.avatar_url, ou.status,
                lm.content AS last_message_content, lm.type AS last_message_type,
                lm.created_at AS last_message_at, lm.sender_id AS last_message_sender_id,
                COALESCE(uc.unread_count, 0)::int AS unread_count
         FROM conversation_participants cp
         JOIN conversations c ON c.id = cp.conversation_id
         JOIN conversation_participants op ON op.conversation_id = c.id AND op.user_id <> cp.user_id
         JOIN users ou ON ou.id = op.user_id
         LEFT JOIN LATERAL (
             SELECT content, type, created_at, sender_id
             FROM messages m WHERE m.conversation_id = c.id
             ORDER BY m.created_at DESC LIMIT 1
         ) lm ON true
         LEFT JOIN LATERAL (
             SELECT COUNT(*) AS unread_count FROM messages m2
             WHERE m2.conversation_id = c.id AND m2.sender_id <> cp.user_id AND m2.status <> 'read'
         ) uc ON true
         WHERE cp.user_id = $1
         ORDER BY COALESCE(lm.created_at, c.created_at) DESC
         LIMIT $2`,
        [userId, safeLimit]
    );
    return rows;
}

// ---------- Suhbat xabarlari tarixi (sahifalash: cursor = oxirgi olingan xabarning created_at'i) ----------
async function listMessages(conversationId, userId, { limit, cursor } = {}) {
    if (!(await isParticipant(conversationId, userId))) {
        throw httpError('Bu suhbatga kirish huquqingiz yo\'q', 403);
    }
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 60);
    const params = [conversationId];
    let where = 'WHERE m.conversation_id = $1';
    if (cursor) {
        params.push(cursor);
        where += ` AND m.created_at < $${params.length}`;
    }
    params.push(safeLimit);

    const { rows } = await pool.query(
        `SELECT m.id, m.conversation_id, m.sender_id, m.content, m.media_url, m.type, m.status, m.created_at
         FROM messages m
         ${where}
         ORDER BY m.created_at DESC
         LIMIT $${params.length}`,
        params
    );
    return rows;
}

// ---------- Yangi xabar yuborish ----------
async function sendMessage(conversationId, senderId, content) {
    if (!(await isParticipant(conversationId, senderId))) {
        throw httpError('Bu suhbatga kirish huquqingiz yo\'q', 403);
    }
    const trimmed = (content || '').trim();
    if (!trimmed) throw httpError('Xabar bo\'sh bo\'lmasin', 400);
    if (trimmed.length > 2000) throw httpError('Xabar juda uzun', 400);

    const { rows } = await pool.query(
        `INSERT INTO messages (conversation_id, sender_id, content, type, status)
         VALUES ($1, $2, $3, 'text', 'sent')
         RETURNING id, conversation_id, sender_id, content, media_url, type, status, created_at`,
        [conversationId, senderId, trimmed]
    );
    return rows[0];
}

// ---------- Suhbatni "o'qildi" deb belgilash ----------
// Faqat boshqa ishtirokchidan kelgan va hali o'qilmagan xabarlar yangilanadi.
// Qaytgan id'lar Socket.io orqali yuboruvchiga "o'qildi" belgisini
// yangilash uchun jo'natiladi.
async function markConversationRead(conversationId, userId) {
    if (!(await isParticipant(conversationId, userId))) {
        throw httpError('Bu suhbatga kirish huquqingiz yo\'q', 403);
    }
    const { rows } = await pool.query(
        `UPDATE messages SET status = 'read'
         WHERE conversation_id = $1 AND sender_id <> $2 AND status <> 'read'
         RETURNING id`,
        [conversationId, userId]
    );
    return rows.map((r) => r.id);
}

module.exports = {
    listParticipantIds,
    isParticipant,
    getOrCreateDirectConversation,
    getConversationSummary,
    listConversations,
    listMessages,
    sendMessage,
    markConversationRead,
};
