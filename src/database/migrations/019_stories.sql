-- =====================================================================
-- Migratsiya: Story'lar (Instagram uslubida, 24 soat yashaydi).
-- Qayta-qayta ishga tushirish xavfsiz.
--
--  - stories — rasm/video + ustidagi matn/emoji'lar (overlays, JSON).
--    source_post_id — story postdan yaratilgan bo'lsa ("Story'ga qo'shish").
--    owns_media — fayl shu story uchun yuklangan (o'chirilganda fayl ham
--    o'chadi); postdan yaratilganda fayl postniki, unga tegilmaydi.
--  - story_views — kim ko'rgani va layk bosgani.
--  - messages.story_id — story'ga javob sifatida yozilgan xabar.
-- =====================================================================

CREATE TABLE IF NOT EXISTS stories (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_url      TEXT NOT NULL,
    media_type     VARCHAR(10) NOT NULL CHECK (media_type IN ('photo', 'video')),
    thumbnail_url  TEXT,
    duration_ms    INTEGER,
    source_post_id UUID REFERENCES posts(id) ON DELETE SET NULL,
    owns_media     BOOLEAN NOT NULL DEFAULT false,
    overlays       JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at     TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE TABLE IF NOT EXISTS story_views (
    story_id  UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    viewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    liked     BOOLEAN NOT NULL DEFAULT false,
    viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (story_id, viewer_id)
);

CREATE INDEX IF NOT EXISTS idx_stories_user_expires ON stories(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);
CREATE INDEX IF NOT EXISTS idx_story_views_viewer ON story_views(viewer_id);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS story_id UUID REFERENCES stories(id) ON DELETE SET NULL;
