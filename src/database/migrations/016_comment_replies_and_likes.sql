-- =====================================================================
-- Migratsiya: izohlarga javob (Instagram uslubida) va izohga layk.
-- Qayta-qayta ishga tushirish xavfsiz.
--
--  - comments.parent_id — javob qaysi izohga yozilgani. Faqat BITTA
--    daraja: javobga javob yozilsa ham u yuqori darajadagi izohga
--    bog'lanadi (kimga javob berilgani matn boshidagi @username'dan
--    ko'rinadi).
--  - comments.likes_count / replies_count — ro'yxatda har safar COUNT(*)
--    qilmaslik uchun (posts.likes_count kabi).
--  - comment_likes — kim qaysi izohga layk bosgani.
-- =====================================================================

ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES comments(id) ON DELETE CASCADE;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS likes_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS replies_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS comment_likes (
    comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comment_likes_user ON comment_likes(user_id);
