-- =====================================================================
-- Migratsiya: bitta postda bir nechta media (rasm/video) — Instagram
-- uslubidagi "carousel" postlar uchun. posts.media_url/media_type
-- birinchi elementning nusxasi sifatida saqlanadi (tezkor ko'rsatish,
-- Reels-video ekrani uchun) — barcha elementlar shu jadvalda turadi.
-- =====================================================================

CREATE TABLE IF NOT EXISTS post_media (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id       UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    media_url     TEXT NOT NULL,
    media_type    VARCHAR(10) NOT NULL CHECK (media_type IN ('photo', 'video')),
    thumbnail_url TEXT,
    duration      SMALLINT,
    position      SMALLINT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_media_post_id ON post_media(post_id);
