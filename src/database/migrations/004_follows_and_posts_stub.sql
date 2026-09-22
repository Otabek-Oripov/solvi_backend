-- =====================================================================
-- Migratsiya: follow tizimi (SRS 2.2) + posts uchun minimal jadval
-- (faqat "postlar soni"ni hisoblash uchun — to'liq Reels/Posts moduli
-- keyingi bosqichda quriladi). Qayta-qayta ishga tushirish xavfsiz.
-- =====================================================================

CREATE TABLE IF NOT EXISTS follows (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    follower_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uniq_follow UNIQUE (follower_id, following_id),
    CONSTRAINT chk_no_self_follow CHECK (follower_id <> following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower  ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

-- Postlar soni haqiqiy (0 dan boshlanadi) bo'lishi uchun — soxta son
-- ko'rsatmaslik uchun jadvalning o'zi mavjud bo'lishi kerak.
CREATE TABLE IF NOT EXISTS posts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
