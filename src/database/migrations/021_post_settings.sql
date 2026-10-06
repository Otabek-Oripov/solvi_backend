-- =====================================================================
-- Migratsiya: post sozlamalari (Instagram / TikTok / YouTube uslubida).
-- Qayta-qayta ishga tushirish xavfsiz.
--
--  - visibility — kim ko'ra oladi: 'public' (hamma), 'followers' (faqat
--    kuzatuvchilar), 'private' (faqat muallif);
--  - comments_enabled — izoh yozish mumkinmi (o'chirilsa, mavjud izohlar
--    ham faqat muallifga ko'rinadi);
--  - hide_like_count — layklar soni faqat muallifga ko'rinadi;
--  - allow_downloads — boshqalar postni yuklab olib, ilovadan tashqariga
--    ulasha oladimi;
--  - edited_at — caption/sozlamalar oxirgi marta qachon o'zgartirilgan.
--  - post_tags(tag text_pattern_ops) — heshteg takliflari (prefiks bo'yicha
--    qidiruv) uchun indeks.
-- =====================================================================

ALTER TABLE posts ADD COLUMN IF NOT EXISTS visibility VARCHAR(10) NOT NULL DEFAULT 'public';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS comments_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS hide_like_count BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS allow_downloads BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_posts_visibility') THEN
        ALTER TABLE posts ADD CONSTRAINT chk_posts_visibility
            CHECK (visibility IN ('public', 'followers', 'private'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_post_tags_tag_prefix ON post_tags(tag text_pattern_ops);
