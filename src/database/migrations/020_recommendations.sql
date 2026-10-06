-- =====================================================================
-- Migratsiya: "Siz uchun" tavsiya lentasi (TikTok / Reels / Shorts
-- mantig'ining soddalashtirilgan ko'rinishi). Qayta-qayta ishga tushirish
-- xavfsiz.
--
--  - post_tags — post mavzulari: caption'dagi #hashtag'lar (og'irligi 1) va
--    kalit so'zlar (0.4). Backend ajratib yozadi; posts.tags_version —
--    qaysi qoidalar bilan ajratilgani (eski postlar fon ishida qayta
--    ajratiladi).
--  - post_views — kim qaysi postni qancha ko'rgani (oxirigacha ko'rdimi,
--    tez o'tkazib yubordimi) — tavsiya signali va ko'rishlar soni uchun.
--  - user_interests — foydalanuvchining mavzu ('tag') va muallif ('author')
--    bo'yicha qiziqish bali. Layk/izoh/saqlash/repost/yuborish/follow va
--    ko'rishlardan yig'iladi; vaqt o'tishi bilan so'nadi (14 kunda yarmi).
--  - feed_impressions — bitta lenta sessiyasida allaqachon ko'rsatilgan
--    postlar (keyingi sahifada takrorlanmasin); 2 kundan keyin tozalanadi.
-- =====================================================================

ALTER TABLE posts ADD COLUMN IF NOT EXISTS tags_version SMALLINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS post_tags (
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tag     VARCHAR(50) NOT NULL,
    weight  REAL NOT NULL DEFAULT 1,

    PRIMARY KEY (post_id, tag)
);

CREATE TABLE IF NOT EXISTS post_views (
    post_id        UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    view_count     INTEGER NOT NULL DEFAULT 1,
    total_watch_ms BIGINT NOT NULL DEFAULT 0,
    max_progress   REAL NOT NULL DEFAULT 0,       -- 0..1, eng ko'p qayergacha ko'rilgan
    completed      BOOLEAN NOT NULL DEFAULT false,
    skipped        BOOLEAN NOT NULL DEFAULT false, -- oxirgi marta tez o'tkazib yuborilgan
    first_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_viewed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_interests (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       VARCHAR(10) NOT NULL CHECK (kind IN ('tag', 'author')),
    key        TEXT NOT NULL,
    score      REAL NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, kind, key)
);

CREATE TABLE IF NOT EXISTS feed_impressions (
    session_id UUID NOT NULL,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    served_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (session_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag);
CREATE INDEX IF NOT EXISTS idx_post_views_user ON post_views(user_id, last_viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_interests_top ON user_interests(user_id, kind, score DESC);
CREATE INDEX IF NOT EXISTS idx_feed_impressions_served ON feed_impressions(served_at);
CREATE INDEX IF NOT EXISTS idx_posts_user_created ON posts(user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- Mavjud harakatlardan muallif bo'yicha boshlang'ich qiziqishlar
-- (mavzular bo'yicha qiziqishlar yangi harakatlardan yig'iladi — post
-- mavzulari backend tomonidan fon ishida ajratiladi).
-- ---------------------------------------------------------------------
INSERT INTO user_interests (user_id, kind, key, score)
SELECT s.user_id, 'author', s.author_id::text, SUM(s.w)
FROM (
    SELECT l.user_id, p.user_id AS author_id, 3.0 AS w
    FROM likes l JOIN posts p ON p.id = l.post_id
    UNION ALL
    SELECT c.user_id, p.user_id, 3.0 FROM comments c JOIN posts p ON p.id = c.post_id
    UNION ALL
    SELECT sp.user_id, p.user_id, 4.0 FROM saved_posts sp JOIN posts p ON p.id = sp.post_id
    UNION ALL
    SELECT r.user_id, p.user_id, 4.0 FROM reposts r JOIN posts p ON p.id = r.post_id
    UNION ALL
    SELECT f.follower_id, f.following_id, 6.0 FROM follows f
) s
WHERE s.user_id <> s.author_id
GROUP BY s.user_id, s.author_id
ON CONFLICT (user_id, kind, key) DO NOTHING;
