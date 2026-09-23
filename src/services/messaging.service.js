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

// Xabarni to'liq shaklda qayta o'qish — reply-to preview bilan birga.
// Yaratish/tahrirlash/pin/forward kabi barcha amallar shu shaklni qaytaradi,
// shunda client har doim bir xil JSON tuzilmasini oladi.
const MESSAGE_SELECT_SQL = `
    SELECT m.id, m.conversation_id, m.sender_id, m.content, m.media_url, m.type, m.status,
           m.is_pinned, m.edited_at, m.deleted_for_everyone, m.is_forwarded, m.forwarded_from_username,
           m.reply_to_id,
           rt.content AS reply_to_content, rt.type AS reply_to_type,
           rt.sender_username AS reply_to_sender_username, rt.deleted_for_everyone AS reply_to_deleted,
           m.created_at
    FROM messages m
    LEFT JOIN LATERAL (
        SELECT rm.content, rm.type, rm.deleted_for_everyone, ru.username AS sender_username
        FROM messages rm JOIN users ru ON ru.id = rm.sender_id
        WHERE rm.id = m.reply_to_id
    ) rt ON true
`;

async function fetchMessageById(id) {
    const { rows } = await pool.query(`${MESSAGE_SELECT_SQL} WHERE m.id = $1`, [id]);
    return rows[0];
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
// "O'zim uchun o'chirilgan" xabarlar bu foydalanuvchiga umuman ko'rsatilmaydi.
async function listMessages(conversationId, userId, { limit, cursor } = {}) {
    if (!(await isParticipant(conversationId, userId))) {
        throw httpError('Bu suhbatga kirish huquqingiz yo\'q', 403);
    }
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 60);
    const params = [conversationId, userId];
    let where = `WHERE m.conversation_id = $1
        AND NOT EXISTS (SELECT 1 FROM message_deletions md WHERE md.message_id = m.id AND md.user_id = $2)`;
    if (cursor) {
        params.push(cursor);
        where += ` AND m.created_at < $${params.length}`;
    }
    params.push(safeLimit);

    const { rows } = await pool.query(
        `${MESSAGE_SELECT_SQL}
         ${where}
         ORDER BY m.created_at DESC
         LIMIT $${params.length}`,
        params
    );
    return rows;
}

// ---------- Yangi xabar yuborish ----------
// mediaUrl berilsa — rasm/video xabari (content ixtiyoriy, izoh sifatida);
// berilmasa — oddiy matnli xabar (content majburiy). replyToId berilsa —
// shu suhbatdagi mavjud xabarga javob sifatida bog'lanadi.
async function sendMessage(conversationId, senderId, content, { mediaUrl, type, replyToId } = {}) {
    if (!(await isParticipant(conversationId, senderId))) {
        throw httpError('Bu suhbatga kirish huquqingiz yo\'q', 403);
    }
    const trimmed = (content || '').trim();
    if (!mediaUrl && !trimmed) throw httpError('Xabar bo\'sh bo\'lmasin', 400);
    if (trimmed.length > 2000) throw httpError('Xabar juda uzun', 400);

    if (replyToId) {
        const replyCheck = await pool.query(
            'SELECT 1 FROM messages WHERE id = $1 AND conversation_id = $2',
            [replyToId, conversationId]
        );
        if (!replyCheck.rows[0]) throw httpError('Javob berilayotgan xabar topilmadi', 404);
    }

    const { rows } = await pool.query(
        `INSERT INTO messages (conversation_id, sender_id, content, media_url, type, status, reply_to_id)
         VALUES ($1, $2, $3, $4, $5, 'sent', $6)
         RETURNING id`,
        [conversationId, senderId, trimmed, mediaUrl || null, type || 'text', replyToId || null]
    );
    return fetchMessageById(rows[0].id);
}

// ---------- Xabarni tahrirlash ----------
// Faqat yuboruvchining o'zi, faqat matnli (media bo'lmagan) va hali
// o'chirilmagan xabarlarni tahrirlashi mumkin.
async function editMessage(messageId, userId, newContent) {
    const trimmed = (newContent || '').trim();
    if (!trimmed) throw httpError('Xabar bo\'sh bo\'lmasin', 400);
    if (trimmed.length > 2000) throw httpError('Xabar juda uzun', 400);

    const { rows } = await pool.query(
        `UPDATE messages SET content = $1, edited_at = NOW()
         WHERE id = $2 AND sender_id = $3 AND type = 'text' AND deleted_for_everyone = false
         RETURNING id`,
        [trimmed, messageId, userId]
    );
    if (!rows[0]) throw httpError('Xabarni tahrirlab bo\'lmaydi', 404);
    return fetchMessageById(messageId);
}

// ---------- "O'zim uchun o'chirish" ----------
// Xabarning o'zi o'zgarmaydi — faqat shu foydalanuvchining ro'yxatidan
// yashiriladi (boshqa ishtirokchi hali ham ko'radi).
async function deleteForMe(messageId, userId) {
    const { rows } = await pool.query(
        `SELECT m.conversation_id FROM messages m
         JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = $2
         WHERE m.id = $1`,
        [messageId, userId]
    );
    if (!rows[0]) throw httpError('Xabar topilmadi', 404);
    await pool.query(
        'INSERT INTO message_deletions (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [messageId, userId]
    );
    return { conversationId: rows[0].conversation_id };
}

// ---------- "Hamma uchun o'chirish" ----------
// Faqat yuboruvchi. Matn/media tozalanadi, deleted_for_everyone belgilanadi
// — client bu bayroq bo'yicha "Xabar o'chirildi" placeholder ko'rsatadi.
async function deleteForEveryone(messageId, userId) {
    const { rows } = await pool.query(
        `UPDATE messages SET content = '', media_url = NULL, deleted_for_everyone = true
         WHERE id = $1 AND sender_id = $2
         RETURNING id`,
        [messageId, userId]
    );
    if (!rows[0]) throw httpError('Xabarni o\'chirib bo\'lmaydi', 404);
    return fetchMessageById(messageId);
}

// ---------- Pin / Unpin ----------
// Ikkala ishtirokchi ham pin/unpin qila oladi (WhatsApp'dagi kabi).
async function setPinned(messageId, userId, pinned) {
    const { rows } = await pool.query(
        `SELECT m.conversation_id FROM messages m
         JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = $2
         WHERE m.id = $1`,
        [messageId, userId]
    );
    if (!rows[0]) throw httpError('Xabar topilmadi', 404);
    await pool.query('UPDATE messages SET is_pinned = $1 WHERE id = $2', [pinned, messageId]);
    return fetchMessageById(messageId);
}

// ---------- Suhbatdagi joriy pin qilingan xabar (eng so'nggisi) ----------
async function getPinnedMessage(conversationId, userId) {
    if (!(await isParticipant(conversationId, userId))) {
        throw httpError('Bu suhbatga kirish huquqingiz yo\'q', 403);
    }
    const { rows } = await pool.query(
        `${MESSAGE_SELECT_SQL} WHERE m.conversation_id = $1 AND m.is_pinned = true
         ORDER BY m.created_at DESC LIMIT 1`,
        [conversationId]
    );
    return rows[0] || null;
}

// ---------- Xabarni boshqa suhbatga forward qilish ----------
// V1: faqat allaqachon mavjud suhbatlarga (yuboruvchi ham manba, ham
// maqsad suhbatning ishtirokchisi bo'lishi shart).
async function forwardMessage(messageId, targetConversationId, userId) {
    const src = await pool.query(
        `SELECT m.content, m.media_url, m.type, u.username AS sender_username
         FROM messages m
         JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = $2
         JOIN users u ON u.id = m.sender_id
         WHERE m.id = $1 AND m.deleted_for_everyone = false`,
        [messageId, userId]
    );
    if (!src.rows[0]) throw httpError('Xabar topilmadi', 404);
    if (!(await isParticipant(targetConversationId, userId))) {
        throw httpError('Bu suhbatga kirish huquqingiz yo\'q', 403);
    }
    const source = src.rows[0];
    const { rows } = await pool.query(
        `INSERT INTO messages (conversation_id, sender_id, content, media_url, type, status, is_forwarded, forwarded_from_username)
         VALUES ($1, $2, $3, $4, $5, 'sent', true, $6)
         RETURNING id`,
        [targetConversationId, userId, source.content, source.media_url, source.type, source.sender_username]
    );
    return fetchMessageById(rows[0].id);
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
    editMessage,
    deleteForMe,
    deleteForEveryone,
    setPinned,
    getPinnedMessage,
    forwardMessage,
    markConversationRead,
};
