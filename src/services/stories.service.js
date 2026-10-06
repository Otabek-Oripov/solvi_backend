const pool = require('../config/db');
const { httpError } = require('../utils/http');
const { getOrCreateDirectConversation, sendMessage } = require('./messaging.service');

// Rasm story'si shuncha ko'rsatiladi; video — o'z uzunligicha (max 60 s).
const PHOTO_DURATION_MS = 5000;
const MAX_VIDEO_DURATION_MS = 60 * 1000;
const MAX_OVERLAYS = 20;

// Story bir xil shaklda qaytadi (lenta, bitta foydalanuvchi, yaratilganda).
// $1 — so'rov yuborayotgan foydalanuvchi: ko'rganmi, layk bosganmi.
// Ko'rishlar/layklar soni faqat story egasiga (o'z ko'rishi hisobga olinmaydi).
const STORY_SELECT_SQL = `
    SELECT s.id, s.user_id, s.media_url, s.media_type, s.thumbnail_url, s.duration_ms,
           s.source_post_id, s.overlays, s.created_at, s.expires_at,
           u.username, u.avatar_url,
           (mv.viewer_id IS NOT NULL) AS is_seen,
           COALESCE(mv.liked, false) AS is_liked,
           CASE WHEN s.user_id = $1 THEN (
               SELECT COUNT(*) FROM story_views v WHERE v.story_id = s.id AND v.viewer_id <> s.user_id
           )::int END AS views_count,
           CASE WHEN s.user_id = $1 THEN (
               SELECT COUNT(*) FROM story_views v
               WHERE v.story_id = s.id AND v.liked AND v.viewer_id <> s.user_id
           )::int END AS likes_count,
           EXISTS(
               SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.following_id = s.user_id
           ) AS is_following
    FROM stories s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN story_views mv ON mv.story_id = s.id AND mv.viewer_id = $1
`;

// Klientdan kelgan matn/emoji'larni tekshiradi — bazaga faqat ma'lum
// maydonlar, ruxsat etilgan oraliqda yoziladi (ixtiyoriy JSON emas).
// x/y — story maydoniga nisbatan (0..1), shunda har qanday ekranda bir xil joyda.
function sanitizeOverlays(raw) {
    let list = raw;
    if (typeof raw === 'string') {
        try {
            list = JSON.parse(raw);
        } catch {
            throw httpError('overlays noto\'g\'ri', 400);
        }
    }
    if (list == null) return [];
    if (!Array.isArray(list)) throw httpError('overlays noto\'g\'ri', 400);
    if (list.length > MAX_OVERLAYS) throw httpError(`Ko'pi bilan ${MAX_OVERLAYS} ta matn/emoji`, 400);

    const num = (value, min, max, fallback) => {
        const n = Number(value);
        return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
    };
    return list.map((o) => {
        if (!o || !['text', 'emoji'].includes(o.type)) throw httpError('overlays noto\'g\'ri', 400);
        const text = String(o.text ?? '').trim().slice(0, 200);
        if (!text) throw httpError('Bo\'sh matn qo\'shib bo\'lmaydi', 400);
        return {
            type: o.type,
            text,
            x: num(o.x, 0, 1, 0.5),
            y: num(o.y, 0, 1, 0.5),
            scale: num(o.scale, 0.2, 8, 1),
            rotation: num(o.rotation, -4 * Math.PI, 4 * Math.PI, 0),
            color: Math.trunc(num(o.color, 0, 0xffffffff, 0xffffffff)),
            style: o.style === 'filled' ? 'filled' : 'plain',
        };
    });
}

async function fetchStory(storyId, viewerId) {
    const { rows } = await pool.query(`${STORY_SELECT_SQL} WHERE s.id = $2`, [viewerId, storyId]);
    return rows[0];
}

// Faol (muddati o'tmagan) story — topilmasa 404.
async function getActiveStory(storyId) {
    const { rows } = await pool.query(
        'SELECT id, user_id FROM stories WHERE id = $1 AND expires_at > NOW()',
        [storyId]
    );
    if (!rows[0]) throw httpError('Story topilmadi', 404);
    return rows[0];
}

// Story qancha turishi — foydalanuvchi o'zi tanlashi mumkin (1 daqiqadan
// 7 kungacha); tanlamasa 24 soat (Instagram'dagidek).
const DEFAULT_LIFETIME_MINUTES = 24 * 60;
const MAX_LIFETIME_MINUTES = 7 * 24 * 60;

function lifetimeMinutes(value) {
    if (value == null || value === '') return DEFAULT_LIFETIME_MINUTES;
    const minutes = Number(value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_LIFETIME_MINUTES) {
        throw httpError('Story muddati 1 daqiqadan 7 kungacha bo\'lishi kerak', 400);
    }
    return minutes;
}

// ---------- Story yaratish ----------
// Yoki yuklangan fayl (upload), yoki mavjud post (postId — "Story'ga
// qo'shish"); ikkalasi birga emas. expiresInMinutes — necha daqiqadan keyin
// o'chishi (berilmasa 24 soat).
async function createStory(userId, { upload, postId, overlays, durationMs, expiresInMinutes }) {
    const items = sanitizeOverlays(overlays);
    const lifetime = lifetimeMinutes(expiresInMinutes);
    if (upload && postId) throw httpError('Yoki fayl, yoki post tanlang', 400);

    let media;
    if (postId) {
        const { rows } = await pool.query(
            `SELECT p.media_url, p.media_type, p.thumbnail_url, p.duration, p.visibility
             FROM posts p JOIN users u ON u.id = p.user_id
             WHERE p.id = $1 AND u.is_active = true`,
            [postId]
        );
        if (!rows[0]) throw httpError('Post topilmadi', 404);
        // Story'ni hamma ko'radi — yopiq (kuzatuvchilar / faqat men) post
        // u orqali boshqalarga ko'rinib qolmasin.
        if (rows[0].visibility !== 'public') {
            throw httpError('Bu postni story\'ga qo\'shib bo\'lmaydi', 403);
        }
        media = {
            mediaUrl: rows[0].media_url,
            mediaType: rows[0].media_type,
            thumbnailUrl: rows[0].thumbnail_url,
            durationMs: rows[0].duration ? rows[0].duration * 1000 : null,
            ownsMedia: false,
        };
    } else if (upload) {
        media = { ...upload, durationMs, ownsMedia: true };
    } else {
        throw httpError('Rasm yoki video kerak', 400);
    }

    const duration = media.mediaType === 'photo'
        ? PHOTO_DURATION_MS
        : Number(media.durationMs) > 0
            ? Math.min(Number(media.durationMs), MAX_VIDEO_DURATION_MS)
            : null;

    const { rows } = await pool.query(
        `INSERT INTO stories (user_id, media_url, media_type, thumbnail_url, duration_ms,
                              source_post_id, owns_media, overlays, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW() + make_interval(mins => $9))
         RETURNING id`,
        [
            userId, media.mediaUrl, media.mediaType, media.thumbnailUrl || null, duration,
            postId || null, media.ownsMedia, JSON.stringify(items), lifetime,
        ]
    );
    return fetchStory(rows[0].id, userId);
}

// ---------- Story'lar lentasi (Home'dagi avatarlar qatori) ----------
// Faol story'si bor foydalanuvchilar, har birining story'lari eskisidan
// yangisiga. Tartib: avval o'zim, keyin ko'rilmagan story'si borlar
// (kuzatilayotganlar oldinda), oxirida hammasi ko'rilganlar.
async function getStoryFeed(viewerId) {
    const { rows } = await pool.query(
        `${STORY_SELECT_SQL}
         WHERE s.expires_at > NOW() AND u.is_active = true
         ORDER BY s.created_at ASC`,
        [viewerId]
    );
    return groupByUser(rows, viewerId);
}

// ---------- Bitta foydalanuvchining faol story'lari ----------
async function getUserStories(viewerId, userId) {
    const { rows } = await pool.query(
        `${STORY_SELECT_SQL}
         WHERE s.user_id = $2 AND s.expires_at > NOW() AND u.is_active = true
         ORDER BY s.created_at ASC`,
        [viewerId, userId]
    );
    return rows;
}

function groupByUser(rows, viewerId) {
    const groups = new Map();
    for (const story of rows) {
        let group = groups.get(story.user_id);
        if (!group) {
            group = {
                user_id: story.user_id,
                username: story.username,
                avatar_url: story.avatar_url,
                is_following: story.is_following,
                stories: [],
            };
            groups.set(story.user_id, group);
        }
        group.stories.push(story);
    }
    const list = [...groups.values()].map((g) => ({
        ...g,
        has_unseen: g.stories.some((s) => !s.is_seen),
        latest_at: g.stories[g.stories.length - 1].created_at,
    }));
    const rank = (g) => (g.user_id === viewerId ? 0 : g.has_unseen ? 1 : 2);
    list.sort((a, b) =>
        rank(a) - rank(b)
        || Number(b.is_following) - Number(a.is_following)
        || new Date(b.latest_at) - new Date(a.latest_at)
    );
    return list;
}

// ---------- Ko'rildi deb belgilash (idempotent) ----------
async function markViewed(viewerId, storyId) {
    await getActiveStory(storyId);
    await pool.query(
        `INSERT INTO story_views (story_id, viewer_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [storyId, viewerId]
    );
    return { ok: true };
}

// ---------- Layk (idempotent). O'z story'siga layk bosilmaydi. ----------
async function setLike(viewerId, storyId, liked) {
    const story = await getActiveStory(storyId);
    if (story.user_id === viewerId) throw httpError('O\'z story\'ingizga layk bosib bo\'lmaydi', 400);
    await pool.query(
        `INSERT INTO story_views (story_id, viewer_id, liked) VALUES ($1, $2, $3)
         ON CONFLICT (story_id, viewer_id) DO UPDATE SET liked = EXCLUDED.liked`,
        [storyId, viewerId, liked]
    );
    return { isLiked: liked };
}

// ---------- Kim ko'rgani (faqat egasiga) ----------
// Layk bosganlar birinchi, keyin eng so'nggi ko'rganlar.
async function getViewers(ownerId, storyId) {
    const { rows: stories } = await pool.query('SELECT user_id FROM stories WHERE id = $1', [storyId]);
    if (!stories[0]) throw httpError('Story topilmadi', 404);
    if (stories[0].user_id !== ownerId) throw httpError('Faqat o\'z story\'ingizni ko\'rganlarni ko\'ra olasiz', 403);

    const { rows } = await pool.query(
        `SELECT u.id, u.username, u.full_name, u.avatar_url, v.liked, v.viewed_at
         FROM story_views v JOIN users u ON u.id = v.viewer_id
         WHERE v.story_id = $1 AND v.viewer_id <> $2 AND u.is_active = true
         ORDER BY v.liked DESC, v.viewed_at DESC`,
        [storyId, ownerId]
    );
    return rows;
}

// ---------- O'chirish (faqat egasi) ----------
// Qaytadi: diskdan o'chirilishi kerak bo'lgan fayllar (faqat shu story
// uchun yuklangan bo'lsa — postdan yaratilgan story'ning fayli postniki).
async function deleteStory(ownerId, storyId) {
    const { rows } = await pool.query(
        `DELETE FROM stories WHERE id = $1 AND user_id = $2
         RETURNING media_url, thumbnail_url, owns_media`,
        [storyId, ownerId]
    );
    if (!rows[0]) throw httpError('Story topilmadi', 404);
    return rows[0].owns_media ? [rows[0].media_url, rows[0].thumbnail_url].filter(Boolean) : [];
}

// ---------- Story'ga javob — egasiga chatda xabar bo'lib boradi ----------
async function replyToStory(senderId, storyId, content) {
    const story = await getActiveStory(storyId);
    if (story.user_id === senderId) throw httpError('O\'z story\'ingizga javob yozib bo\'lmaydi', 400);
    const conversation = await getOrCreateDirectConversation(senderId, story.user_id);
    return sendMessage(conversation.conversation_id, senderId, content, { storyId });
}

// ---------- Muddati o'tgan story'larni tozalash (maintenance) ----------
async function purgeExpiredStories() {
    const { rows } = await pool.query(
        `DELETE FROM stories WHERE expires_at < NOW()
         RETURNING media_url, thumbnail_url, owns_media`
    );
    return rows.filter((r) => r.owns_media).flatMap((r) => [r.media_url, r.thumbnail_url].filter(Boolean));
}

module.exports = {
    createStory,
    getStoryFeed,
    getUserStories,
    markViewed,
    setLike,
    getViewers,
    deleteStory,
    replyToStory,
    purgeExpiredStories,
    sanitizeOverlays,
};
