const pool = require('../config/db');

// =====================================================================
// "Siz uchun" lentasi — TikTok / Instagram Reels / YouTube Shorts
// mantig'ining soddalashtirilgan ko'rinishi:
//
//  1. Signallar: har bir harakat (layk, izoh, saqlash, repost, do'stga
//     yuborish, follow, videoni oxirigacha ko'rish yoki tez o'tkazib
//     yuborish) foydalanuvchining shu post MUALLIFI va MAVZULARI
//     (#hashtag / kalit so'zlar) bo'yicha qiziqish baliga qo'shiladi
//     (user_interests). Ballar vaqt o'tishi bilan so'nadi — 14 kunda yarmi,
//     shuning uchun yangi qiziqishlar eskilarini tez "bosib" o'tadi.
//  2. Nomzodlar: kuzatilayotganlar postlari, qiziqqan mavzu/mualliflar
//     postlari, "menga o'xshaganlar" layk bosgan postlar, so'nggi
//     ommabop va eng yangi postlar.
//  3. Reyting: har bir nomzodga ball beriladi (pastdagi SQL) — follow,
//     mavzu, muallif, o'xshash foydalanuvchilar, ommaboplik, yangilik;
//     ko'rilgan/o'tkazib yuborilganlar pastga tushadi; ozgina tasodif
//     lentani "jonli" qiladi (har safar bir xil tartib chiqmasin).
//  4. Xilma-xillik: ketma-ket bir muallif chiqmaydi, bir sahifada bir
//     muallifdan ko'pi bilan 2 ta.
//  5. Sessiya: bitta lenta ochilishida (session) ko'rsatilgan postlar
//     keyingi sahifalarda takrorlanmaydi (feed_impressions).
// =====================================================================

// Mavzu ajratish qoidalari o'zgarsa — oshiriladi; eski postlar fon ishida
// (tagUntaggedPosts) qayta ajratiladi.
const TAGS_VERSION = 1;
const HALF_LIFE_DAYS = 14;
const MAX_KEYWORDS = 8;
const SCORE_MIN = -30;
const SCORE_MAX = 100;

const SIGNAL_WEIGHTS = {
    like: 3,
    unlike: -3,
    comment: 3,
    save: 4,
    unsave: -2,
    repost: 4,
    unrepost: -2,
    share: 3,
    view_complete: 1.5,
    view_half: 0.7,
    view_skip: -1,
    photo_view: 0.6,
    photo_skip: -0.3,
    replay: 1,
};
const FOLLOW_WEIGHT = 6;

// Kalit so'z sifatida olinmaydigan umumiy so'zlar (4+ harfli — qisqalari
// baribir tashlanadi). Apostroflar olib tashlangan holda yoziladi.
const STOPWORDS = new Set([
    // o'zbekcha
    'bilan', 'uchun', 'lekin', 'ammo', 'yoki', 'juda', 'endi', 'keyin', 'oldin', 'hamma',
    'barcha', 'qanday', 'nima', 'nega', 'qachon', 'qayer', 'qayerda', 'mening', 'sening',
    'uning', 'bizning', 'sizning', 'ularning', 'menga', 'senga', 'unga', 'bizga', 'sizga',
    'ularga', 'mana', 'emas', 'ekan', 'boldi', 'bolsa', 'bolib', 'boladi', 'qilib',
    'qildi', 'qiladi', 'kerak', 'hali', 'yana', 'faqat', 'chunki', 'agar', 'balki', 'hech',
    'narsa', 'bugun', 'ertaga', 'kecha', 'shunday', 'bunday', 'shuning', 'buning', 'ham',
    'deb', 'dedi', 'degan', 'bor', 'yoq', 'hozir', 'doim', 'har', 'birga', 'qilish',
    'kimdir', 'nimadir', 'ozim', 'ozing', 'ozi', 'sizlar', 'bizlar', 'ular', 'mendan',
    'sendan', 'undan', 'bizdan', 'sizdan', 'boylab', 'qildik', 'qildim', 'qilamiz', 'boldik',
    'boldim', 'kerakli', 'yaxshi', 'zorr',
    // русский
    'это', 'этот', 'эта', 'эти', 'того', 'тоже', 'только', 'когда', 'чтобы', 'очень',
    'всех', 'если', 'меня', 'тебя', 'него', 'нее', 'неё', 'были', 'было', 'будет', 'есть',
    'свой', 'свою', 'себя', 'наши', 'ваши', 'просто', 'сегодня', 'здесь', 'там', 'потому',
    'какой', 'какая', 'какие', 'который', 'которая', 'которые', 'всегда', 'теперь', 'тогда',
    'после', 'перед', 'между', 'через', 'более', 'менее', 'можно', 'нужно', 'надо', 'вот',
    'всё', 'все', 'ещё', 'еще', 'также', 'даже', 'опять', 'уже', 'хотя', 'вместе',
    // english
    'this', 'that', 'with', 'from', 'have', 'your', 'what', 'when', 'where', 'which', 'they',
    'them', 'their', 'there', 'here', 'been', 'were', 'will', 'would', 'could', 'should',
    'about', 'into', 'just', 'like', 'more', 'most', 'some', 'such', 'than', 'then', 'very',
    'only', 'also', 'over', 'after', 'before', 'because', 'being', 'does', 'doing', 'each',
    'every', 'much', 'many', 'make', 'made', 'know', 'want', 'these', 'those', 'while',
    'other', 'again', 'still', 'really', 'today', 'always', 'never', 'something', 'anything',
    'everything', 'nothing', 'thing', 'things', 'mine', 'yours', 'ours', 'cant', 'dont',
    'didnt', 'doesnt', 'isnt', 'wasnt', 'im', 'ive', 'youre', 'its', 'lets', 'gonna',
]);

// O'zbekcha apostroflarning barcha ko'rinishlari bitta belgiga keltiriladi,
// kalitda esa umuman olib tashlanadi: #o'zbekiston va #ozbekiston — bitta mavzu.
const APOSTROPHES = /[ʻʼ‘’`´]/g;
const HASHTAG_RE = /#([\p{L}\p{N}_]+(?:'[\p{L}\p{N}_]+)*)/gu;
const WORD_RE = /[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu;

function normalizeKey(raw) {
    return raw.toLowerCase().replace(/'/g, '');
}

// caption → [{ tag, weight }]: #hashtag'lar (1) + ko'pi bilan 8 ta kalit so'z (0.4)
function extractPostTags(caption) {
    if (!caption) return [];
    const text = String(caption).replace(APOSTROPHES, "'");
    const tags = new Map();

    for (const match of text.matchAll(HASHTAG_RE)) {
        const tag = normalizeKey(match[1]);
        if (tag.length >= 2 && tag.length <= 50) tags.set(tag, 1);
    }

    const plain = text
        .replace(HASHTAG_RE, ' ')
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/@[\w.]+/g, ' ');
    let keywords = 0;
    for (const match of plain.matchAll(WORD_RE)) {
        if (keywords >= MAX_KEYWORDS) break;
        const word = normalizeKey(match[0]);
        if (word.length < 4 || word.length > 50) continue;
        if (/^\p{N}+$/u.test(word) || STOPWORDS.has(word) || tags.has(word)) continue;
        tags.set(word, 0.4);
        keywords++;
    }

    return [...tags].map(([tag, weight]) => ({ tag, weight }));
}

// Post mavzularini (qayta) yozish. db — pool yoki ochiq tranzaksiya client'i.
async function tagPost(db, postId, caption) {
    const tags = extractPostTags(caption);
    await db.query('DELETE FROM post_tags WHERE post_id = $1', [postId]);
    if (tags.length) {
        await db.query(
            `INSERT INTO post_tags (post_id, tag, weight)
             SELECT $1, t.tag, t.weight
             FROM unnest($2::text[], $3::real[]) AS t(tag, weight)`,
            [postId, tags.map((t) => t.tag), tags.map((t) => t.weight)]
        );
    }
    await db.query('UPDATE posts SET tags_version = $2 WHERE id = $1', [postId, TAGS_VERSION]);
}

// Hali ajratilmagan (yoki eski qoidalar bilan ajratilgan) postlar — fon ishi.
async function tagUntaggedPosts(batchSize = 200) {
    let total = 0;
    for (;;) {
        const { rows } = await pool.query(
            'SELECT id, caption FROM posts WHERE tags_version < $1 ORDER BY created_at DESC LIMIT $2',
            [TAGS_VERSION, batchSize]
        );
        for (const row of rows) await tagPost(pool, row.id, row.caption);
        total += rows.length;
        if (rows.length < batchSize) return total;
    }
}

// Ball so'nishi: 14 kunda yarmi (alias — user_interests jadvali nomi/taxallusi)
function decayedScoreSql(alias) {
    return `(${alias}.score * power(0.5, EXTRACT(EPOCH FROM (NOW() - ${alias}.updated_at)) / 86400.0 / ${HALF_LIFE_DAYS}))`;
}

// entries: [{ kind: 'tag' | 'author', key, delta }]. Eski ball avval so'ndiriladi,
// keyin delta qo'shiladi (va chegaralanadi — bitta muallif/mavzu abadiy ustun bo'lmasin).
async function addInterests(userId, entries) {
    const merged = new Map();
    for (const { kind, key, delta } of entries) {
        if (!key || !delta) continue;
        const id = `${kind}\u0000${key}`;
        const prev = merged.get(id);
        merged.set(id, { kind, key, delta: (prev?.delta || 0) + delta });
    }
    const rows = [...merged.values()].filter((e) => e.delta !== 0);
    if (!rows.length) return;

    await pool.query(
        `INSERT INTO user_interests (user_id, kind, key, score, updated_at)
         SELECT $1, e.kind, e.key, LEAST(GREATEST(e.delta, ${SCORE_MIN}), ${SCORE_MAX}), NOW()
         FROM unnest($2::text[], $3::text[], $4::real[]) AS e(kind, key, delta)
         ON CONFLICT (user_id, kind, key) DO UPDATE SET
             score = LEAST(GREATEST(${decayedScoreSql('user_interests')} + EXCLUDED.score, ${SCORE_MIN}), ${SCORE_MAX}),
             updated_at = NOW()`,
        [userId, rows.map((e) => e.kind), rows.map((e) => e.key), rows.map((e) => e.delta)]
    );
}

// items: [{ postId, weight }] — har bir postning muallifi va mavzulari
// bo'yicha qiziqish o'zgaradi. O'z postlari hisobga olinmaydi.
async function applyPostSignals(userId, items) {
    if (!userId || !items.length) return;
    const ids = [...new Set(items.map((i) => i.postId))];
    const [posts, tags] = await Promise.all([
        pool.query('SELECT id, user_id FROM posts WHERE id = ANY($1::uuid[])', [ids]),
        pool.query('SELECT post_id, tag, weight FROM post_tags WHERE post_id = ANY($1::uuid[])', [ids]),
    ]);
    const authorOf = new Map(posts.rows.map((p) => [p.id, p.user_id]));
    const tagsOf = new Map();
    for (const t of tags.rows) {
        if (!tagsOf.has(t.post_id)) tagsOf.set(t.post_id, []);
        tagsOf.get(t.post_id).push(t);
    }

    const me = String(userId).toLowerCase();
    const entries = [];
    for (const { postId, weight } of items) {
        const author = authorOf.get(postId);
        if (!author || author === me) continue;
        entries.push({ kind: 'author', key: author, delta: weight });
        for (const t of tagsOf.get(postId) || []) {
            entries.push({ kind: 'tag', key: t.tag, delta: weight * t.weight });
        }
    }
    await addInterests(me, entries);
}

// Bitta harakat signali (layk, izoh, saqlash, ...). Hech qachon xato
// tashlamaydi — tavsiya yangilanmay qolsa ham asosiy harakat buzilmasin.
async function recordSignal(userId, postId, signal) {
    const weight = SIGNAL_WEIGHTS[signal];
    if (!weight) return;
    try {
        await applyPostSignals(userId, [{ postId: String(postId).toLowerCase(), weight }]);
    } catch (err) {
        console.error(`Tavsiya signali (${signal}) yozilmadi:`, err.message);
    }
}

async function recordFollowSignal(followerId, targetId, followed) {
    try {
        await addInterests(String(followerId).toLowerCase(), [
            { kind: 'author', key: String(targetId).toLowerCase(), delta: followed ? FOLLOW_WEIGHT : -FOLLOW_WEIGHT },
        ]);
    } catch (err) {
        console.error('Tavsiya signali (follow) yozilmadi:', err.message);
    }
}

// Juda qisqa "ko'rish" — shunchaki skroll qilib o'tib ketilgan, hisobga olinmaydi.
const MIN_VIEW_MS = 300;

// Ko'rishlarni yozish. events: [{ postId, watchMs, durationMs?, progress? }]
// (ko'pi bilan 50 ta). Video: 90%+ — oxirigacha ko'rildi; 2 soniyadan kam va
// 25% gacha — o'tkazib yuborildi; videodan 1.8 baravar ko'p ko'rilsa — qayta
// ko'rildi. Rasm: 2.5 soniya+ — qiziqib ko'rildi, 0.7 soniyadan kam —
// o'tkazib yuborildi. posts.views_count — post nechta odam ko'rgani.
async function recordViews(userId, events) {
    const me = String(userId).toLowerCase();
    const list = (events || []).slice(0, 50)
        .map((e) => ({ ...e, postId: String(e.postId).toLowerCase(), watchMs: Number(e.watchMs) || 0 }))
        .filter((e) => e.watchMs >= MIN_VIEW_MS);
    if (!list.length) return { recorded: 0 };

    const ids = [...new Set(list.map((e) => e.postId))];
    const { rows } = await pool.query(
        'SELECT id, user_id, media_type, duration FROM posts WHERE id = ANY($1::uuid[])',
        [ids]
    );
    const postOf = new Map(rows.map((p) => [p.id, p]));

    const signals = [];
    let recorded = 0;
    for (const event of list) {
        const post = postOf.get(event.postId);
        if (!post) continue;

        let progress = 0;
        let completed;
        let skipped;
        if (post.media_type === 'video') {
            const durationMs = Number(event.durationMs) || (post.duration ? post.duration * 1000 : 0);
            progress = event.progress != null
                ? Number(event.progress)
                : (durationMs ? event.watchMs / durationMs : 0);
            progress = Math.min(Math.max(progress || 0, 0), 1);
            completed = progress >= 0.9;
            skipped = event.watchMs < 2000 && progress < 0.25;

            if (completed) {
                signals.push({ postId: post.id, weight: SIGNAL_WEIGHTS.view_complete });
                if (durationMs && event.watchMs >= durationMs * 1.8) {
                    signals.push({ postId: post.id, weight: SIGNAL_WEIGHTS.replay });
                }
            } else if (progress >= 0.5) {
                signals.push({ postId: post.id, weight: SIGNAL_WEIGHTS.view_half });
            } else if (skipped) {
                signals.push({ postId: post.id, weight: SIGNAL_WEIGHTS.view_skip });
            }
        } else {
            completed = event.watchMs >= 2500;
            skipped = event.watchMs < 700;
            progress = completed ? 1 : 0;
            if (completed) signals.push({ postId: post.id, weight: SIGNAL_WEIGHTS.photo_view });
            else if (skipped) signals.push({ postId: post.id, weight: SIGNAL_WEIGHTS.photo_skip });
        }

        const view = await pool.query(
            `INSERT INTO post_views (post_id, user_id, total_watch_ms, max_progress, completed, skipped)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (post_id, user_id) DO UPDATE SET
                 view_count = post_views.view_count + 1,
                 total_watch_ms = post_views.total_watch_ms + EXCLUDED.total_watch_ms,
                 max_progress = GREATEST(post_views.max_progress, EXCLUDED.max_progress),
                 completed = post_views.completed OR EXCLUDED.completed,
                 skipped = EXCLUDED.skipped,
                 last_viewed_at = NOW()
             RETURNING (xmax = 0) AS inserted`,
            [post.id, me, Math.round(event.watchMs), progress, completed, skipped]
        );
        // Ko'rishlar soni — har bir odam bir marta; muallifning o'zi hisoblanmaydi.
        if (view.rows[0].inserted && post.user_id !== me) {
            await pool.query('UPDATE posts SET views_count = views_count + 1 WHERE id = $1', [post.id]);
        }
        recorded++;
    }

    try {
        await applyPostSignals(me, signals);
    } catch (err) {
        console.error('Tavsiya signali (ko\'rish) yozilmadi:', err.message);
    }
    return { recorded };
}

// ---------- "Siz uchun" reytingi ----------
// $1 — foydalanuvchi, $2 — sessiya, $3 — nechta nomzod olinsin.
const FOR_YOU_SQL = `
WITH
served AS (
    SELECT post_id FROM feed_impressions WHERE session_id = $2 AND user_id = $1
),
tag_interest AS (
    SELECT ui.key AS tag, ${decayedScoreSql('ui')} AS s
    FROM user_interests ui
    WHERE ui.user_id = $1 AND ui.kind = 'tag'
    ORDER BY abs(ui.score) DESC
    LIMIT 300
),
author_interest AS (
    SELECT ui.key::uuid AS author_id, ${decayedScoreSql('ui')} AS s
    FROM user_interests ui
    WHERE ui.user_id = $1 AND ui.kind = 'author'
    ORDER BY abs(ui.score) DESC
    LIMIT 300
),
followed AS (
    SELECT following_id FROM follows WHERE follower_id = $1
),
-- "Menga o'xshaganlar": men layk bosgan postlarga layk bosgan odamlar
-- (umumiy laykilari ko'pligi bo'yicha) va ular yana nimalarga layk bosgani.
my_likes AS (
    SELECT post_id FROM likes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200
),
neighbors AS (
    SELECT l.user_id, COUNT(*) AS overlap
    FROM likes l
    WHERE l.post_id IN (SELECT post_id FROM my_likes) AND l.user_id <> $1
    GROUP BY l.user_id
    ORDER BY overlap DESC
    LIMIT 100
),
co_liked AS (
    SELECT l.post_id, SUM(n.overlap) AS c
    FROM likes l
    JOIN neighbors n ON n.user_id = l.user_id
    GROUP BY l.post_id
),
candidates AS (
    (SELECT p.id FROM posts p JOIN followed f ON f.following_id = p.user_id
     WHERE p.created_at > NOW() - INTERVAL '60 days')
    UNION
    (SELECT pt.post_id FROM post_tags pt JOIN tag_interest ti ON ti.tag = pt.tag AND ti.s > 0.3
     LIMIT 2000)
    UNION
    (SELECT p.id FROM posts p JOIN author_interest ai ON ai.author_id = p.user_id AND ai.s > 0.3
     LIMIT 2000)
    UNION
    (SELECT post_id FROM co_liked ORDER BY c DESC LIMIT 1000)
    UNION
    (SELECT id FROM posts WHERE created_at > NOW() - INTERVAL '14 days'
     ORDER BY likes_count + 2 * comments_count + 3 * reposts_count DESC LIMIT 300)
    UNION
    (SELECT id FROM posts ORDER BY created_at DESC LIMIT 300)
    UNION
    (SELECT id FROM posts
     ORDER BY likes_count + 2 * comments_count + 3 * reposts_count + views_count / 20 DESC LIMIT 300)
),
tag_match AS (
    SELECT pt.post_id, SUM(ti.s * pt.weight) AS s
    FROM post_tags pt
    JOIN tag_interest ti ON ti.tag = pt.tag
    WHERE pt.post_id IN (SELECT id FROM candidates)
    GROUP BY pt.post_id
)
SELECT p.id, p.user_id,
       (CASE WHEN f.following_id IS NOT NULL THEN 2.5 ELSE 0 END)
     + sign(COALESCE(tm.s, 0)) * ln(1 + abs(COALESCE(tm.s, 0))) * 1.2
     + sign(COALESCE(ai.s, 0)) * ln(1 + abs(COALESCE(ai.s, 0))) * 1.0
     + ln(1 + COALESCE(co.c, 0)) * 1.5
     + ln(1 + p.likes_count + 2 * p.comments_count + 3 * p.reposts_count + p.views_count / 20.0)
         * 0.6 * exp(-LEAST(age.h, 20000) / 168.0)
     + 1.5 * exp(-LEAST(age.h, 20000) / 48.0)
     - (CASE WHEN pv.post_id IS NULL THEN 0 WHEN pv.completed THEN 3.5 ELSE 2 END)
     - (CASE WHEN pv.skipped THEN 2 ELSE 0 END)
     - (CASE WHEN p.user_id = $1 THEN 1 ELSE 0 END)
     + random() * 0.8 AS score
FROM candidates c
JOIN posts p ON p.id = c.id
JOIN users u ON u.id = p.user_id AND u.is_active = true
CROSS JOIN LATERAL (SELECT EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600.0 AS h) age
LEFT JOIN followed f ON f.following_id = p.user_id
LEFT JOIN tag_match tm ON tm.post_id = p.id
LEFT JOIN author_interest ai ON ai.author_id = p.user_id
LEFT JOIN co_liked co ON co.post_id = p.id
LEFT JOIN post_views pv ON pv.post_id = p.id AND pv.user_id = $1
WHERE p.id NOT IN (SELECT post_id FROM served)
ORDER BY score DESC
LIMIT $3
`;

// Xilma-xillik: ketma-ket bir muallif chiqmasin, bir sahifada bir
// muallifdan ko'pi bilan MAX_PER_AUTHOR ta. Nomzodlar yetmasa (masalan
// mualliflar kam) — shartlar bosqichma-bosqich yumshatiladi, lenta
// erta tugab qolmasin.
const MAX_PER_AUTHOR = 2;

function diversify(ranked, limit) {
    const rest = [...ranked];
    const picked = [];
    const perAuthor = new Map();
    while (picked.length < limit && rest.length) {
        const last = picked[picked.length - 1]?.user_id;
        let idx = rest.findIndex((r) => r.user_id !== last && (perAuthor.get(r.user_id) || 0) < MAX_PER_AUTHOR);
        if (idx === -1) idx = rest.findIndex((r) => r.user_id !== last);
        if (idx === -1) idx = 0;
        const [row] = rest.splice(idx, 1);
        picked.push(row);
        perAuthor.set(row.user_id, (perAuthor.get(row.user_id) || 0) + 1);
    }
    return picked;
}

// Navbatdagi sahifa uchun post id'lari (tartib bilan). Qaytarilganlari shu
// sessiyada "ko'rsatildi" deb belgilanadi.
async function rankForYouIds(viewerId, sessionId, limit) {
    const me = String(viewerId).toLowerCase();
    const { rows } = await pool.query(FOR_YOU_SQL, [me, sessionId, limit * 4]);
    const ids = diversify(rows, limit).map((r) => r.id);
    if (ids.length) {
        await pool.query(
            `INSERT INTO feed_impressions (session_id, user_id, post_id)
             SELECT $1, $2, unnest($3::uuid[])
             ON CONFLICT DO NOTHING`,
            [sessionId, me, ids]
        );
    }
    return ids;
}

// Fon ishi: eski sessiyalar va deyarli nolga so'ngan qiziqishlar tozalanadi.
async function purgeRecommendationData() {
    const impressions = await pool.query(
        `DELETE FROM feed_impressions WHERE served_at < NOW() - INTERVAL '2 days'`
    );
    const interests = await pool.query(
        `DELETE FROM user_interests ui WHERE abs(${decayedScoreSql('ui')}) < 0.05`
    );
    return { impressions: impressions.rowCount, interests: interests.rowCount };
}

module.exports = {
    SIGNAL_WEIGHTS,
    extractPostTags,
    tagPost,
    tagUntaggedPosts,
    addInterests,
    recordSignal,
    recordFollowSignal,
    recordViews,
    rankForYouIds,
    diversify,
    purgeRecommendationData,
};
