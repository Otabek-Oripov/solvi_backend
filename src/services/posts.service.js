const pool = require('../config/db');
const { getOrCreateDirectConversation, sendMessage } = require('./messaging.service');

function httpError(message, status) {
    const err = new Error(message);
    err.status = status;
    return err;
}

const POST_FIELDS = `
    id, user_id, media_url, media_type, caption, thumbnail_url, duration,
    views_count, likes_count, comments_count, created_at
`;

// ---------- Yangi post yaratish ----------
// mediaItems: [{ mediaUrl, mediaType, thumbnailUrl?, duration? }, ...] — kamida 1 ta.
// posts.media_url/media_type/thumbnail_url/duration ustunlariga BIRINCHI element
// nusxa sifatida yoziladi (tezkor ko'rsatish uchun), barcha elementlar esa
// post_media jadvaliga (carousel uchun) yoziladi.
async function createPost(userId, { mediaItems, caption }) {
    if (!Array.isArray(mediaItems) || mediaItems.length === 0) {
        throw httpError('Kamida bitta video yoki rasm kerak', 400);
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const first = mediaItems[0];
        const { rows } = await client.query(
            `INSERT INTO posts (user_id, media_url, media_type, caption, thumbnail_url, duration)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING ${POST_FIELDS}`,
            [
                userId,
                first.mediaUrl,
                first.mediaType,
                caption || null,
                first.thumbnailUrl || null,
                first.duration || null,
            ]
        );
        const post = rows[0];

        for (let i = 0; i < mediaItems.length; i++) {
            const item = mediaItems[i];
            await client.query(
                `INSERT INTO post_media (post_id, media_url, media_type, thumbnail_url, duration, position)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [post.id, item.mediaUrl, item.mediaType, item.thumbnailUrl || null, item.duration || null, i]
            );
        }

        await client.query('COMMIT');
        return { ...post, media: mediaItems.map((m, i) => ({ url: m.mediaUrl, mediaType: m.mediaType, position: i })) };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

// Post lenta, profil, repostlar, saqlanganlar va alohida ochilganda bir xil
// shaklda qaytadi. $1 — so'rov yuborayotgan foydalanuvchi (viewer): u layk
// bosganmi, repost/saqlaganmi, muallifni kuzatadimi. `extraColumns` /
// `extraJoins` — repost/saqlanganlar ro'yxatlari uchun (masalan qachon
// repost qilingani).
function postSelectSql({ extraColumns = '', extraJoins = '' } = {}) {
    return `
        SELECT p.id, p.user_id, p.media_url, p.media_type, p.caption, p.thumbnail_url,
               p.duration, p.views_count, p.likes_count, p.comments_count, p.reposts_count,
               p.created_at, u.username, u.avatar_url,
               EXISTS(
                   SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $1
               ) AS is_liked,
               EXISTS(
                   SELECT 1 FROM reposts r WHERE r.post_id = p.id AND r.user_id = $1
               ) AS is_reposted,
               EXISTS(
                   SELECT 1 FROM saved_posts sv WHERE sv.post_id = p.id AND sv.user_id = $1
               ) AS is_saved,
               EXISTS(
                   SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = p.user_id
               ) AS is_author_followed,
               COALESCE(pm.media, '[]'::json) AS media
               ${extraColumns}
        FROM posts p
        JOIN users u ON u.id = p.user_id
        ${extraJoins}
        LEFT JOIN LATERAL (
            SELECT json_agg(
                       json_build_object('url', media_url, 'mediaType', media_type, 'position', position)
                       ORDER BY position
                   ) AS media
            FROM post_media
            WHERE post_media.post_id = p.id
        ) pm ON true
    `;
}

// ---------- Lenta (feed) — sahifalash cursor (oxirgi postning created_at'i) orqali ----------
async function getFeed({ limit, cursor, viewerId } = {}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 30);
    const params = [viewerId || null];
    // Bloklangan (is_active = false) foydalanuvchining postlari lentaga chiqmaydi
    let where = 'WHERE u.is_active = true';
    if (cursor) {
        params.push(cursor);
        where += ` AND p.created_at < $${params.length}`;
    }
    params.push(safeLimit);

    const { rows } = await pool.query(
        `${postSelectSql()}
         ${where}
         ORDER BY p.created_at DESC
         LIMIT $${params.length}`,
        params
    );
    return rows;
}

// ---------- Bitta foydalanuvchining postlari (profil ekrani: Video/Rasm tablari) ----------
async function getUserPosts({ userId, mediaType, limit, cursor, viewerId } = {}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 21, 1), 60);
    const params = [viewerId || null, userId];
    let where = 'WHERE p.user_id = $2';
    if (mediaType) {
        params.push(mediaType);
        where += ` AND p.media_type = $${params.length}`;
    }
    if (cursor) {
        params.push(cursor);
        where += ` AND p.created_at < $${params.length}`;
    }
    params.push(safeLimit);

    const { rows } = await pool.query(
        `${postSelectSql()}
         ${where}
         ORDER BY p.created_at DESC
         LIMIT $${params.length}`,
        params
    );
    return rows;
}

// ---------- Bitta post (masalan chatda yuborilgan postni ochganda) ----------
async function getPostById(postId, viewerId) {
    const { rows } = await pool.query(
        `${postSelectSql()} WHERE p.id = $2 AND u.is_active = true`,
        [viewerId || null, postId]
    );
    if (!rows[0]) throw httpError('Post topilmadi', 404);
    return rows[0];
}

// ---------- Foydalanuvchi repost qilgan postlar (profil > Repostlar) ----------
// Eng so'nggi repost birinchi; activity_at — qachon repost qilingani
// (keyingi sahifa cursor'i shu bo'yicha).
async function getUserReposts({ userId, limit, cursor, viewerId } = {}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 21, 1), 60);
    const params = [viewerId || null, userId];
    let where = 'WHERE u.is_active = true';
    if (cursor) {
        params.push(cursor);
        where += ` AND rp.created_at < $${params.length}`;
    }
    params.push(safeLimit);

    const { rows } = await pool.query(
        `${postSelectSql({
            extraColumns: ', rp.created_at AS activity_at',
            extraJoins: 'JOIN reposts rp ON rp.post_id = p.id AND rp.user_id = $2',
        })}
         ${where}
         ORDER BY rp.created_at DESC
         LIMIT $${params.length}`,
        params
    );
    return rows;
}

// ---------- Saqlangan postlar (faqat o'zimniki) ----------
async function getSavedPosts({ viewerId, limit, cursor } = {}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 21, 1), 60);
    const params = [viewerId];
    let where = 'WHERE u.is_active = true';
    if (cursor) {
        params.push(cursor);
        where += ` AND sp.created_at < $${params.length}`;
    }
    params.push(safeLimit);

    const { rows } = await pool.query(
        `${postSelectSql({
            extraColumns: ', sp.created_at AS activity_at',
            extraJoins: 'JOIN saved_posts sp ON sp.post_id = p.id AND sp.user_id = $1',
        })}
         ${where}
         ORDER BY sp.created_at DESC
         LIMIT $${params.length}`,
        params
    );
    return rows;
}

// ---------- Repost qilish / bekor qilish ----------
// Idempotent (izoh laykidagi kabi). O'z postini repost qilib bo'lmaydi.
async function setRepost(userId, postId, reposted) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const post = await client.query('SELECT user_id FROM posts WHERE id = $1 FOR UPDATE', [postId]);
        if (!post.rows[0]) throw httpError('Post topilmadi', 404);
        if (reposted && post.rows[0].user_id === userId) {
            throw httpError('O\'z postingizni repost qilib bo\'lmaydi', 400);
        }

        const changed = reposted
            ? await client.query(
                `INSERT INTO reposts (post_id, user_id) VALUES ($1, $2)
                 ON CONFLICT DO NOTHING RETURNING post_id`,
                [postId, userId]
            )
            : await client.query(
                'DELETE FROM reposts WHERE post_id = $1 AND user_id = $2 RETURNING post_id',
                [postId, userId]
            );

        const delta = changed.rows[0] ? (reposted ? 1 : -1) : 0;
        const { rows } = await client.query(
            'UPDATE posts SET reposts_count = GREATEST(reposts_count + $2, 0) WHERE id = $1 RETURNING reposts_count',
            [postId, delta]
        );
        await client.query('COMMIT');
        return { repostsCount: rows[0].reposts_count, isReposted: reposted };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

// ---------- Saqlash / saqlanganlardan olib tashlash (idempotent) ----------
async function setSaved(userId, postId, saved) {
    const post = await pool.query('SELECT 1 FROM posts WHERE id = $1', [postId]);
    if (!post.rows[0]) throw httpError('Post topilmadi', 404);

    if (saved) {
        await pool.query(
            'INSERT INTO saved_posts (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [postId, userId]
        );
    } else {
        await pool.query('DELETE FROM saved_posts WHERE post_id = $1 AND user_id = $2', [postId, userId]);
    }
    return { isSaved: saved };
}

// ---------- Postni do'stlarga chat orqali yuborish ----------
// Har bir oluvchi bilan 1:1 suhbat topiladi/yaratiladi va unga 'post'
// turidagi xabar yoziladi. Avval HAMMA oluvchi tekshiriladi — biri topilmasa
// hech kimga yuborilmaydi (yarim-yuborilgan holat qolmasin).
async function sendPostToUsers(senderId, postId, userIds, content) {
    const post = await pool.query(
        'SELECT 1 FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = $1 AND u.is_active = true',
        [postId]
    );
    if (!post.rows[0]) throw httpError('Post topilmadi', 404);

    const targets = [...new Set(userIds.map((id) => String(id).toLowerCase()))]
        .filter((id) => id !== senderId);
    if (targets.length === 0) throw httpError('Kimga yuborishni tanlang', 400);

    const existing = await pool.query(
        'SELECT id FROM users WHERE id = ANY($1::uuid[]) AND is_active = true',
        [targets]
    );
    if (existing.rows.length !== targets.length) throw httpError('Foydalanuvchi topilmadi', 404);

    const messages = [];
    for (const targetId of targets) {
        const conversation = await getOrCreateDirectConversation(senderId, targetId);
        messages.push(
            await sendMessage(conversation.conversation_id, senderId, content, {
                type: 'post',
                sharedPostId: postId,
            })
        );
    }
    return messages;
}

// ---------- Layk qo'yish ----------
async function likePost(userId, postId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const post = await client.query('SELECT id FROM posts WHERE id = $1 FOR UPDATE', [postId]);
        if (!post.rows[0]) throw httpError('Post topilmadi', 404);

        try {
            await client.query('INSERT INTO likes (post_id, user_id) VALUES ($1, $2)', [postId, userId]);
        } catch (err) {
            if (err.code === '23505') throw httpError('Siz allaqachon layk bosgansiz', 409);
            throw err;
        }

        const { rows } = await client.query(
            'UPDATE posts SET likes_count = likes_count + 1 WHERE id = $1 RETURNING likes_count',
            [postId]
        );
        await client.query('COMMIT');
        return { likesCount: rows[0].likes_count };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

// ---------- Laykni bekor qilish ----------
async function unlikePost(userId, postId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const del = await client.query(
            'DELETE FROM likes WHERE post_id = $1 AND user_id = $2 RETURNING id',
            [postId, userId]
        );
        if (!del.rows[0]) throw httpError('Siz bu postni layk bosmagansiz', 404);

        const { rows } = await client.query(
            'UPDATE posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = $1 RETURNING likes_count',
            [postId]
        );
        await client.query('COMMIT');
        return { likesCount: rows[0].likes_count };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

// Izoh ro'yxatda ham, yaratilganda ham bir xil shaklda qaytadi: muallifning
// ismi/rasmi, layklar va javoblar soni hamda so'rov yuborayotgan
// foydalanuvchi ($1) unga layk bosganmi.
const COMMENT_SELECT_SQL = `
    SELECT c.id, c.post_id, c.user_id, c.parent_id, c.content, c.created_at,
           c.likes_count, c.replies_count,
           u.username, u.avatar_url,
           EXISTS(
               SELECT 1 FROM comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = $1
           ) AS is_liked
    FROM comments c
    JOIN users u ON u.id = c.user_id
`;

// ---------- Izoh (yoki izohga javob) qoldirish ----------
// parentId berilsa — javob. Instagram'dagi kabi faqat BITTA daraja: javobga
// javob yozilsa ham u yuqori darajadagi izohga bog'lanadi.
async function addComment(userId, postId, content, parentId) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const post = await client.query('SELECT id FROM posts WHERE id = $1', [postId]);
        if (!post.rows[0]) throw httpError('Post topilmadi', 404);

        let rootId = null;
        if (parentId) {
            const parent = await client.query(
                'SELECT id, parent_id FROM comments WHERE id = $1 AND post_id = $2',
                [parentId, postId]
            );
            if (!parent.rows[0]) throw httpError('Izoh topilmadi', 404);
            rootId = parent.rows[0].parent_id || parent.rows[0].id;
        }

        const { rows } = await client.query(
            `INSERT INTO comments (post_id, user_id, content, parent_id)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [postId, userId, content, rootId]
        );
        // Postdagi izohlar soniga javoblar ham kiradi (Instagram'dagi kabi).
        await client.query(
            'UPDATE posts SET comments_count = comments_count + 1 WHERE id = $1',
            [postId]
        );
        if (rootId) {
            await client.query(
                'UPDATE comments SET replies_count = replies_count + 1 WHERE id = $1',
                [rootId]
            );
        }
        const created = await client.query(`${COMMENT_SELECT_SQL} WHERE c.id = $2`, [userId, rows[0].id]);
        await client.query('COMMIT');
        return created.rows[0];
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

// ---------- Izohlarni o'qish ----------
// parentId berilmasa — yuqori darajadagi izohlar, eng yangisidan boshlab
// (cursor = ro'yxatdagi eng eski izohning vaqti). parentId berilsa — shu
// izohga yozilgan javoblar, suhbat tartibida eng eskisidan boshlab
// (cursor = ro'yxatdagi eng so'nggi javobning vaqti).
async function listComments(postId, { limit, cursor, parentId, viewerId } = {}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
    const params = [viewerId || null, postId];
    let where = 'WHERE c.post_id = $2';
    let order;
    if (parentId) {
        params.push(parentId);
        where += ` AND c.parent_id = $${params.length}`;
        order = 'ASC';
    } else {
        where += ' AND c.parent_id IS NULL';
        order = 'DESC';
    }
    if (cursor) {
        params.push(cursor);
        // Cursor klientdan millisekund aniqligida qaytadi, bazada esa vaqt
        // mikrosekundgacha saqlanadi — qisqartirmasdan solishtirilsa, "dan
        // keyingi" shartiga cursor'ning o'z yozuvi ham tushib, qayta kelardi.
        where += order === 'ASC'
            ? ` AND date_trunc('milliseconds', c.created_at) > $${params.length}`
            : ` AND c.created_at < $${params.length}`;
    }
    params.push(safeLimit);

    const { rows } = await pool.query(
        `${COMMENT_SELECT_SQL}
         ${where}
         ORDER BY c.created_at ${order}
         LIMIT $${params.length}`,
        params
    );
    return rows;
}

// ---------- Izohga layk qo'yish / olib tashlash ----------
// Ikkalasi ham idempotent: ketma-ket tez bosilganda (yoki qayta yuborilgan
// so'rovda) xato emas, shunchaki joriy holat qaytadi.
async function setCommentLike(userId, postId, commentId, liked) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const comment = await client.query(
            'SELECT id FROM comments WHERE id = $1 AND post_id = $2 FOR UPDATE',
            [commentId, postId]
        );
        if (!comment.rows[0]) throw httpError('Izoh topilmadi', 404);

        const changed = liked
            ? await client.query(
                `INSERT INTO comment_likes (comment_id, user_id) VALUES ($1, $2)
                 ON CONFLICT DO NOTHING RETURNING comment_id`,
                [commentId, userId]
            )
            : await client.query(
                'DELETE FROM comment_likes WHERE comment_id = $1 AND user_id = $2 RETURNING comment_id',
                [commentId, userId]
            );

        const delta = changed.rows[0] ? (liked ? 1 : -1) : 0;
        const { rows } = await client.query(
            'UPDATE comments SET likes_count = GREATEST(likes_count + $2, 0) WHERE id = $1 RETURNING likes_count',
            [commentId, delta]
        );
        await client.query('COMMIT');
        return { likesCount: rows[0].likes_count, isLiked: liked };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

module.exports = {
    createPost,
    getFeed,
    getUserPosts,
    getPostById,
    getUserReposts,
    getSavedPosts,
    setRepost,
    setSaved,
    sendPostToUsers,
    likePost,
    unlikePost,
    addComment,
    listComments,
    setCommentLike,
};
