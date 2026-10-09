// GIF va stiker qidiruvi — KLIPY yoki GIPHY orqali (Instagram'dagi GIF
// stikerlar ham GIPHY'dan). API kaliti klientda (ilovada) emas, shu yerda,
// .env'da saqlanadi; natijalar qisqa muddat keshlanadi (bepul kalitlarning
// soatlik limiti tejaladi).
//
//   KLIPY_API_KEY — partner.klipy.com (bepul)
//   GIPHY_API_KEY — developers.giphy.com (bepul "beta" kalit, soatiga ~100 so'rov)
// Ikkalasi ham bo'lsa — KLIPY ishlatiladi. Hech biri bo'lmasa — klientga
// configured:false qaytadi (ilova o'zidagi animatsion emoji'lar va
// foydalanuvchilarning stiker/GIFlari bilan ishlashda davom etadi).
const { httpError } = require('../utils/http');
const { rememberMediaHost } = require('../utils/externalMedia');

const KLIPY_BASE = 'https://api.klipy.com/api/v1';
const GIPHY_BASE = 'https://api.giphy.com/v1';
const PAGE_SIZE = 24;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
const REQUEST_TIMEOUT_MS = 8000;

const cache = new Map();

function activeProvider() {
    if (process.env.KLIPY_API_KEY) return 'klipy';
    if (process.env.GIPHY_API_KEY) return 'giphy';
    return null;
}

async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
        if (!res.ok) {
            // URL'da API kaliti bor — logga faqat host va status yoziladi.
            console.error(`GIF provider ${new URL(url).host} HTTP ${res.status}`);
            throw httpError('GIF xizmati javob bermadi', 502);
        }
        return await res.json();
    } catch (err) {
        if (err.status) throw err;
        throw httpError('GIF xizmatiga ulanib bo\'lmadi', 502);
    } finally {
        clearTimeout(timer);
    }
}

function toInt(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// KLIPY javobidagi fayllar: item.file.<o'lcham>.<format> = { url, width, height }
// (o'lchamlar: hd, md, sm, xs). Hujjatlarda ba'zan "files.<format>" shakli
// ham uchraydi — ikkalasi ham qo'llab-quvvatlanadi.
function pickKlipyFile(item, sizes, formats) {
    const file = item.file || item.files || {};
    for (const size of sizes) {
        for (const format of formats) {
            const v = file[size] && file[size][format];
            if (v && typeof v.url === 'string') return v;
        }
    }
    for (const format of formats) {
        const v = file[format];
        if (v && typeof v.url === 'string') return v;
    }
    return null;
}

function mapKlipyItem(item, kind) {
    if (!item || item.type === 'ad') return null;
    const formats = kind === 'stickers' ? ['webp', 'gif', 'png'] : ['gif', 'webp'];
    const full = pickKlipyFile(item, ['md', 'hd', 'sm'], formats);
    if (!full) return null;
    const preview = pickKlipyFile(item, ['sm', 'xs', 'md'], ['webp', 'gif', 'png']) || full;
    return {
        id: String(item.slug || item.id || full.url),
        url: full.url,
        previewUrl: preview.url,
        width: toInt(full.width),
        height: toInt(full.height),
    };
}

async function searchKlipy({ kind, q, page, userId }) {
    const params = new URLSearchParams({
        page: String(page),
        per_page: String(PAGE_SIZE),
        customer_id: userId,
        content_filter: 'medium',
    });
    if (q) params.set('q', q);
    const key = encodeURIComponent(process.env.KLIPY_API_KEY);
    const json = await fetchJson(`${KLIPY_BASE}/${key}/${kind}/${q ? 'search' : 'trending'}?${params}`);
    const block = (json && json.data) || {};
    const list = Array.isArray(block.data) ? block.data : (Array.isArray(block) ? block : []);
    return {
        items: list.map((item) => mapKlipyItem(item, kind)).filter(Boolean),
        nextPage: block.has_next ? page + 1 : null,
    };
}

function mapGiphyItem(item, kind) {
    const images = (item && item.images) || {};
    // preferWebp — panel'dagi kichik ko'rinishlar va stikerlar uchun (yengilroq,
    // shaffof fon saqlanadi); chatga yuboriladigan GIF esa .gif.
    const pick = (preferWebp, ...names) => {
        for (const name of names) {
            const v = images[name];
            if (!v) continue;
            const url = preferWebp ? (v.webp || v.url) : (v.url || v.webp);
            if (url) return { url, width: v.width, height: v.height };
        }
        return null;
    };
    const full = kind === 'stickers'
        ? pick(true, 'fixed_width', 'original')
        : pick(false, 'downsized_medium', 'downsized', 'original');
    if (!full) return null;
    const preview = pick(true, 'fixed_width_small', 'fixed_width', 'original') || full;
    return {
        id: String(item.id),
        url: full.url,
        previewUrl: preview.url,
        width: toInt(full.width),
        height: toInt(full.height),
    };
}

async function searchGiphy({ kind, q, page, lang }) {
    const params = new URLSearchParams({
        api_key: process.env.GIPHY_API_KEY,
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
        rating: 'pg-13',
    });
    if (q) params.set('q', q);
    if (q && lang) params.set('lang', lang);
    const json = await fetchJson(`${GIPHY_BASE}/${kind}/${q ? 'search' : 'trending'}?${params}`);
    const list = Array.isArray(json && json.data) ? json.data : [];
    const p = (json && json.pagination) || {};
    const loaded = (Number(p.offset) || 0) + (Number(p.count) || list.length);
    return {
        items: list.map((item) => mapGiphyItem(item, kind)).filter(Boolean),
        nextPage: list.length > 0 && loaded < (Number(p.total_count) || 0) ? page + 1 : null,
    };
}

// kind: 'gifs' | 'stickers'; q bo'sh bo'lsa — trenddagilar.
async function search({ kind, q, page = 1, userId, lang }) {
    const provider = activeProvider();
    if (!provider) return { configured: false, provider: null, items: [], nextPage: null };

    const query = (q || '').trim().toLowerCase();
    const cacheKey = `${provider}:${kind}:${query}:${page}:${lang || ''}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

    const result = provider === 'klipy'
        ? await searchKlipy({ kind, q: query, page, userId })
        : await searchGiphy({ kind, q: query, page, lang });
    for (const item of result.items) {
        rememberMediaHost(item.url);
        rememberMediaHost(item.previewUrl);
    }

    const value = { configured: true, provider, ...result };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { at: Date.now(), value });
    return value;
}

module.exports = { search, activeProvider, mapKlipyItem, mapGiphyItem };
