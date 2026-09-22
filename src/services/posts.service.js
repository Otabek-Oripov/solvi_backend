const pool = require('../config/db');

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

// ---------- Lenta (feed) — sahifalash cursor (oxirgi postning created_at'i) orqali ----------
async function getFeed({ limit, cursor, viewerId } = {}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 30);
    const params = [viewerId || null];
    let where = '';
    if (cursor) {
        params.push(cursor);
        where = `WHERE p.created_at < $${params.length}`;
    }
    params.push(safeLimit);

    const { rows } = await pool.query(
        `SELECT p.id, p.user_id, p.media_url, p.media_type, p.caption, p.thumbnail_url,
                p.duration, p.views_count, p.likes_count, p.comments_count, p.created_at,
                u.username, u.avatar_url,
                EXISTS(
                    SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $1
                ) AS is_liked,
                EXISTS(
                    SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = p.user_id
                ) AS is_author_followed,
                COALESCE(pm.media, '[]'::json) AS media
         FROM posts p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN LATERAL (
             SELECT json_agg(
                        json_build_object('url', media_url, 'mediaType', media_type, 'position', position)
                        ORDER BY position
                    ) AS media
             FROM post_media
             WHERE post_media.post_id = p.id
         ) pm ON true
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
        `SELECT p.id, p.user_id, p.media_url, p.media_type, p.caption, p.thumbnail_url,
                p.duration, p.views_count, p.likes_count, p.comments_count, p.created_at,
                u.username, u.avatar_url,
                EXISTS(
                    SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $1
                ) AS is_liked,
                EXISTS(
                    SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = p.user_id
                ) AS is_author_followed,
                COALESCE(pm.media, '[]'::json) AS media
         FROM posts p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN LATERAL (
             SELECT json_agg(
                        json_build_object('url', media_url, 'mediaType', media_type, 'position', position)
                        ORDER BY position
                    ) AS media
             FROM post_media
             WHERE post_media.post_id = p.id
         ) pm ON true
         ${where}
         ORDER BY p.created_at DESC
         LIMIT $${params.length}`,
        params
    );
    return rows;
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

// ---------- Izoh qoldirish ----------
async function addComment(userId, postId, content) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const post = await client.query('SELECT id FROM posts WHERE id = $1', [postId]);
        if (!post.rows[0]) throw httpError('Post topilmadi', 404);

        const { rows } = await client.query(
            `INSERT INTO comments (post_id, user_id, content)
             VALUES ($1, $2, $3)
             RETURNING id, post_id, user_id, content, created_at`,
            [postId, userId, content]
        );
        await client.query(
            'UPDATE posts SET comments_count = comments_count + 1 WHERE id = $1',
            [postId]
        );
        await client.query('COMMIT');
        return rows[0];
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

// ---------- Izohlarni o'qish ----------
async function listComments(postId, { limit, cursor } = {}) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);
    const params = [postId];
    let extraWhere = '';
    if (cursor) {
        params.push(cursor);
        extraWhere = ` AND c.created_at < $${params.length}`;
    }
    params.push(safeLimit);

    const { rows } = await pool.query(
        `SELECT c.id, c.post_id, c.user_id, c.content, c.created_at,
                u.username, u.avatar_url
         FROM comments c
         JOIN users u ON u.id = c.user_id
         WHERE c.post_id = $1${extraWhere}
         ORDER BY c.created_at DESC
         LIMIT $${params.length}`,
        params
    );
    return rows;
}

module.exports = {
    createPost,
    getFeed,
    getUserPosts,
    likePost,
    unlikePost,
    addComment,
    listComments,
};
