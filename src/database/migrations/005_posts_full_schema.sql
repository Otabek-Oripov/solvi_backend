-- =====================================================================
-- Migratsiya: Reels/Posts moduli — "posts" jadvalini to'liq kengaytirish
-- (004-migratsiyadagi stub faqat postlar sonini hisoblash uchun edi)
-- + likes va comments jadvallari. Qayta-qayta ishga tushirish xavfsiz.
-- =====================================================================

ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_url      TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_type     VARCHAR(10);
ALTER TABLE posts ADD COLUMN IF NOT EXISTS caption        TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS thumbnail_url  TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS duration       SMALLINT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS views_count    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS likes_count    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS comments_count INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_posts_media_type'
    ) THEN
        ALTER TABLE posts ADD CONSTRAINT chk_posts_media_type
            CHECK (media_type IN ('photo', 'video'));
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS likes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uniq_like UNIQUE (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content    VARCHAR(500) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_created_at    ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_likes_post_id        ON likes(post_id);
CREATE INDEX IF NOT EXISTS idx_likes_user_id         ON likes(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_post_id      ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_user_id      ON comments(user_id);
