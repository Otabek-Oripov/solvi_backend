-- =====================================================================
-- Migratsiya: kengaytirilgan profil maydonlari (dating-uslub, swap card
-- uchun) + bir nechta rasm (user_photos). Qayta-qayta ishga tushirish
-- xavfsiz (IF NOT EXISTS).
-- =====================================================================

-- ---------------------------------------------------------------- users
ALTER TABLE users ADD COLUMN IF NOT EXISTS goal               VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS work                VARCHAR(150);
ALTER TABLE users ADD COLUMN IF NOT EXISTS school              VARCHAR(150);
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_country    VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_city       VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS height_cm            SMALLINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS weight_kg            SMALLINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sexual_orientation  VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS star_sign            VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS exercise             VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS education_level      VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS marital_status       VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS has_kids             VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS drinking             VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS smoking              VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS pets                 VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS religion             VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS core_values          VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS interests            TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS languages_known      TEXT[] NOT NULL DEFAULT '{}';

-- ------------------------------------------------------------ user_photos
-- Avatardan tashqari, profil kartasida ko'rsatiladigan qo'shimcha rasmlar
-- (max 9 dona, backend darajasida cheklanadi).
CREATE TABLE IF NOT EXISTS user_photos (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url        TEXT NOT NULL,
    position   SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_photos_user_id ON user_photos(user_id);
