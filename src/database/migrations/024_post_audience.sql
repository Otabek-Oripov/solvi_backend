-- =====================================================================
-- Migratsiya: "Kim ko'ra oladi" > "Tanlash" (custom).
-- Qayta-qayta ishga tushirish xavfsiz.
--
--  - visibility = 'custom' — post faqat muallif tanlagan odamlarga ko'rinadi
--    (tanlov muallifning kuzatuvchilari va kuzatganlari orasidan).
--  - post_audience — shu tanlangan odamlar ro'yxati. Post boshqa turga
--    o'tkazilsa — ro'yxat tozalanadi.
-- =====================================================================

ALTER TABLE posts DROP CONSTRAINT IF EXISTS chk_posts_visibility;
ALTER TABLE posts ADD CONSTRAINT chk_posts_visibility
    CHECK (visibility IN ('public', 'followers', 'private', 'custom'));

CREATE TABLE IF NOT EXISTS post_audience (
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_audience_user ON post_audience(user_id);
