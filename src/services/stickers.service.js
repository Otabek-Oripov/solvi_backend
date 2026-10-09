const pool = require('../config/db');
const { httpError } = require('../utils/http');

const MAX_PACKS_PER_USER = 50;
const MAX_INSTALLED_PACKS = 200;
const MAX_STICKERS_PER_PACK = 120;
const MAX_SAVED_GIFS = 200;
const MAX_TITLE_LENGTH = 64;

// To'plam + uning stikerlari (yaratilish tartibida) — barcha javoblarda
// bir xil JSON tuzilmasi.
function packSelect(extraJoin = '') {
    return `
        SELECT p.id, p.title, p.owner_id, u.username AS owner_username, p.created_at,
               EXISTS (
                   SELECT 1 FROM user_sticker_packs i WHERE i.pack_id = p.id AND i.user_id = $1
               ) AS is_installed,
               COALESCE(s.stickers, '[]'::json) AS stickers
        FROM sticker_packs p
        JOIN users u ON u.id = p.owner_id
        ${extraJoin}
        LEFT JOIN LATERAL (
            SELECT json_agg(json_build_object(
                       'id', st.id, 'mediaUrl', st.media_url,
                       'isAnimated', st.is_animated, 'emoji', st.emoji
                   ) ORDER BY st.created_at, st.id) AS stickers
            FROM stickers st
            WHERE st.pack_id = p.id
        ) s ON true
    `;
}

function mapPack(row, userId) {
    return {
        id: row.id,
        title: row.title,
        ownerId: row.owner_id,
        ownerUsername: row.owner_username,
        isOwner: row.owner_id === userId,
        isInstalled: row.is_installed,
        stickers: row.stickers,
        createdAt: row.created_at,
    };
}

function cleanTitle(title) {
    const trimmed = (title || '').trim();
    if (!trimmed) throw httpError('To\'plam nomi bo\'sh bo\'lmasin', 400);
    if (trimmed.length > MAX_TITLE_LENGTH) throw httpError('To\'plam nomi juda uzun', 400);
    return trimmed;
}

// Foydalanuvchi paneliga qo'shgan to'plamlar (o'zi yaratganlari ham) —
// oxirgi qo'shilgani birinchi.
async function listInstalledPacks(userId) {
    const { rows } = await pool.query(
        `${packSelect('JOIN user_sticker_packs usp ON usp.pack_id = p.id AND usp.user_id = $1')}
         ORDER BY usp.added_at DESC`,
        [userId]
    );
    return rows.map((r) => mapPack(r, userId));
}

async function getPack(packId, userId) {
    const { rows } = await pool.query(`${packSelect()} WHERE p.id = $2`, [userId, packId]);
    if (!rows[0]) throw httpError('Stiker to\'plami topilmadi', 404);
    return mapPack(rows[0], userId);
}

async function createPack(userId, title) {
    const clean = cleanTitle(title);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Bir vaqtda bir nechta so'rov limitni aylanib o'tmasligi uchun
        await client.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
        const count = await client.query('SELECT COUNT(*)::int AS n FROM sticker_packs WHERE owner_id = $1', [userId]);
        if (count.rows[0].n >= MAX_PACKS_PER_USER) {
            throw httpError(`Ko'pi bilan ${MAX_PACKS_PER_USER} ta to'plam yaratish mumkin`, 400);
        }
        const { rows } = await client.query(
            'INSERT INTO sticker_packs (owner_id, title) VALUES ($1, $2) RETURNING id',
            [userId, clean]
        );
        await client.query(
            'INSERT INTO user_sticker_packs (user_id, pack_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [userId, rows[0].id]
        );
        await client.query('COMMIT');
        return getPack(rows[0].id, userId);
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function renamePack(packId, userId, title) {
    const clean = cleanTitle(title);
    const { rowCount } = await pool.query(
        'UPDATE sticker_packs SET title = $1, updated_at = NOW() WHERE id = $2 AND owner_id = $3',
        [clean, packId, userId]
    );
    if (!rowCount) throw httpError('Stiker to\'plami topilmadi', 404);
    return getPack(packId, userId);
}

async function isPackOwner(packId, userId) {
    const { rows } = await pool.query(
        'SELECT 1 FROM sticker_packs WHERE id = $1 AND owner_id = $2',
        [packId, userId]
    );
    return rows.length > 0;
}

// Fayl hali biror joyda (xabar, stiker, saqlangan GIF) ishlatilyaptimi —
// ishlatilmasa diskdan o'chirish mumkin. Forward qilingan xabarlar, boshqa
// foydalanuvchi saqlab olgan GIF va h.k. bir xil faylga ishora qiladi.
async function isMediaReferenced(url, db = pool) {
    const { rows } = await db.query(
        `SELECT EXISTS (SELECT 1 FROM messages WHERE media_url = $1)
             OR EXISTS (SELECT 1 FROM stickers WHERE media_url = $1)
             OR EXISTS (SELECT 1 FROM saved_gifs WHERE url = $1) AS used`,
        [url]
    );
    return rows[0].used;
}

async function orphanedOnly(urls) {
    const result = [];
    for (const url of new Set(urls)) {
        if (url && !(await isMediaReferenced(url))) result.push(url);
    }
    return result;
}

// Faqat egasi. Qaytadi: diskdan o'chirilishi mumkin bo'lgan fayllar
// (chatda yuborilgan stikerlarning rasmi saqlanib qoladi).
async function deletePack(packId, userId) {
    const { rows } = await pool.query(
        `WITH files AS (SELECT media_url FROM stickers WHERE pack_id = $1)
         DELETE FROM sticker_packs WHERE id = $1 AND owner_id = $2
         RETURNING (SELECT COALESCE(array_agg(media_url), '{}') FROM files) AS files`,
        [packId, userId]
    );
    if (!rows[0]) throw httpError('Stiker to\'plami topilmadi', 404);
    return orphanedOnly(rows[0].files);
}

async function installPack(packId, userId) {
    const exists = await pool.query('SELECT 1 FROM sticker_packs WHERE id = $1', [packId]);
    if (!exists.rows[0]) throw httpError('Stiker to\'plami topilmadi', 404);
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM user_sticker_packs WHERE user_id = $1', [userId]);
    if (count.rows[0].n >= MAX_INSTALLED_PACKS) {
        throw httpError(`Ko'pi bilan ${MAX_INSTALLED_PACKS} ta to'plam qo'shish mumkin`, 400);
    }
    await pool.query(
        'INSERT INTO user_sticker_packs (user_id, pack_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, packId]
    );
    return getPack(packId, userId);
}

// O'z to'plamini panel'dan olib tashlab bo'lmaydi — faqat o'chirish mumkin
// (aks holda u "Mening stikerlarim"da bor, panelda yo'q bo'lib qolardi).
async function uninstallPack(packId, userId) {
    if (await isPackOwner(packId, userId)) {
        throw httpError('O\'z to\'plamingizni olib tashlab bo\'lmaydi — uni o\'chirishingiz mumkin', 400);
    }
    await pool.query('DELETE FROM user_sticker_packs WHERE user_id = $1 AND pack_id = $2', [userId, packId]);
}

async function addSticker(packId, userId, { mediaUrl, isAnimated, emoji }) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const pack = await client.query(
            'SELECT 1 FROM sticker_packs WHERE id = $1 AND owner_id = $2 FOR UPDATE',
            [packId, userId]
        );
        if (!pack.rows[0]) throw httpError('Stiker to\'plami topilmadi', 404);
        const count = await client.query('SELECT COUNT(*)::int AS n FROM stickers WHERE pack_id = $1', [packId]);
        if (count.rows[0].n >= MAX_STICKERS_PER_PACK) {
            throw httpError(`Bitta to'plamda ko'pi bilan ${MAX_STICKERS_PER_PACK} ta stiker bo'ladi`, 400);
        }
        const { rows } = await client.query(
            `INSERT INTO stickers (pack_id, media_url, is_animated, emoji)
             VALUES ($1, $2, $3, $4)
             RETURNING id, media_url, is_animated, emoji`,
            [packId, mediaUrl, !!isAnimated, emoji || null]
        );
        await client.query('UPDATE sticker_packs SET updated_at = NOW() WHERE id = $1', [packId]);
        await client.query('COMMIT');
        const r = rows[0];
        return { id: r.id, mediaUrl: r.media_url, isAnimated: r.is_animated, emoji: r.emoji };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// Faqat to'plam egasi. Qaytadi: diskdan o'chirilishi mumkin bo'lgan fayl yoki null.
async function deleteSticker(stickerId, userId) {
    const { rows } = await pool.query(
        `DELETE FROM stickers s
         USING sticker_packs p
         WHERE s.id = $1 AND p.id = s.pack_id AND p.owner_id = $2
         RETURNING s.media_url`,
        [stickerId, userId]
    );
    if (!rows[0]) throw httpError('Stiker topilmadi', 404);
    const [orphan] = await orphanedOnly([rows[0].media_url]);
    return orphan || null;
}

async function getStickerMedia(stickerId) {
    const { rows } = await pool.query('SELECT media_url FROM stickers WHERE id = $1', [stickerId]);
    if (!rows[0]) throw httpError('Stiker topilmadi', 404);
    return rows[0].media_url;
}

// ---------- Saqlangan GIFlar ----------

function mapGif(r) {
    return {
        id: r.id,
        url: r.url,
        previewUrl: r.preview_url || r.url,
        width: r.width,
        height: r.height,
        isOwn: r.is_own,
        createdAt: r.created_at,
    };
}

async function listSavedGifs(userId) {
    const { rows } = await pool.query(
        `SELECT id, url, preview_url, width, height, is_own, created_at
         FROM saved_gifs WHERE user_id = $1
         ORDER BY created_at DESC LIMIT $2`,
        [userId, MAX_SAVED_GIFS]
    );
    return rows.map(mapGif);
}

// Allaqachon saqlangan bo'lsa — ro'yxat boshiga ko'tariladi.
async function saveGif(userId, { url, previewUrl, width, height, isOwn = false }) {
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM saved_gifs WHERE user_id = $1', [userId]);
    if (count.rows[0].n >= MAX_SAVED_GIFS) {
        const existing = await pool.query('SELECT 1 FROM saved_gifs WHERE user_id = $1 AND url = $2', [userId, url]);
        if (!existing.rows[0]) {
            throw httpError(`Ko'pi bilan ${MAX_SAVED_GIFS} ta GIF saqlash mumkin`, 400);
        }
    }
    const { rows } = await pool.query(
        `INSERT INTO saved_gifs (user_id, url, preview_url, width, height, is_own)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, url) DO UPDATE SET created_at = NOW()
         RETURNING id, url, preview_url, width, height, is_own, created_at`,
        [userId, url, previewUrl || null, width || null, height || null, !!isOwn]
    );
    return mapGif(rows[0]);
}

// Qaytadi: diskdan o'chirilishi mumkin bo'lgan fayl (faqat o'zimizning
// /uploads ichidagi, hech qayerda ishlatilmayotgan bo'lsa) yoki null.
async function deleteSavedGif(gifId, userId) {
    const { rows } = await pool.query(
        'DELETE FROM saved_gifs WHERE id = $1 AND user_id = $2 RETURNING url',
        [gifId, userId]
    );
    if (!rows[0]) throw httpError('GIF topilmadi', 404);
    const url = rows[0].url;
    if (!url.startsWith('/uploads/')) return null;
    const [orphan] = await orphanedOnly([url]);
    return orphan || null;
}

module.exports = {
    listInstalledPacks,
    getPack,
    createPack,
    renamePack,
    isPackOwner,
    deletePack,
    installPack,
    uninstallPack,
    addSticker,
    deleteSticker,
    getStickerMedia,
    isMediaReferenced,
    listSavedGifs,
    saveGif,
    deleteSavedGif,
};
