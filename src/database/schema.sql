-- =====================================================================
-- Solvi — auth moduli uchun schema (Otabekning original dizayni asosida)
-- Ishga tushirish:  psql -U postgres -d Solvi_base -f src/database/schema.sql
--             yoki: pgAdmin -> File -> Open -> shu fayl -> Run (F5)
--
-- Noldan o'rnatish uchun. Mavjud bazani moslashtirish uchun:
-- src/database/migrations/001_reconcile_users_schema.sql
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE,
    phone           VARCHAR(20) UNIQUE,
    password_hash   VARCHAR(255),           -- OAuth-only userlarda NULL bo'ladi
    username        VARCHAR(50) UNIQUE NOT NULL,
    full_name       VARCHAR(150),
    avatar_url      TEXT,
    bio             TEXT,
    birth_date      DATE,
    gender          VARCHAR(20),
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    is_verified     BOOLEAN DEFAULT FALSE,
    is_active       BOOLEAN DEFAULT TRUE,
    status          VARCHAR(20) DEFAULT 'offline',
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    -- Kengaytirilgan profil (swap/match card'i uchun) — barchasi ixtiyoriy
    goal                VARCHAR(50),
    work                VARCHAR(150),
    school              VARCHAR(150),
    location_country    VARCHAR(100),
    location_city       VARCHAR(100),
    height_cm           SMALLINT,
    weight_kg           SMALLINT,
    star_sign           VARCHAR(20),
    exercise            VARCHAR(30),
    education_level     VARCHAR(50),
    marital_status      VARCHAR(30),
    has_kids            VARCHAR(30),
    drinking            VARCHAR(30),
    smoking             VARCHAR(30),
    pets                VARCHAR(50),
    religion            VARCHAR(50),
    core_values         VARCHAR(50),
    interests           TEXT[] NOT NULL DEFAULT '{}',
    languages_known     TEXT[] NOT NULL DEFAULT '{}',

    CONSTRAINT chk_email_or_phone CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS auth_providers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider            VARCHAR(20) NOT NULL,       -- 'google' | 'facebook' | 'apple' | 'email'
    provider_user_id    VARCHAR(255) NOT NULL,      -- Google 'sub', Facebook 'id' va h.k.
    email_at_provider   VARCHAR(255),
    access_token        TEXT,
    refresh_token       TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uniq_provider_account UNIQUE (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash        VARCHAR(255) NOT NULL,   -- xom tokenni emas, SHA-256 hash saqlang
    device_info       VARCHAR(255),
    expires_at        TIMESTAMPTZ NOT NULL,
    revoked           BOOLEAN DEFAULT FALSE,
    replaced_by_hash  VARCHAR(255),            -- rotation zanjiri (o'g'irlikni aniqlash)
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS otp_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    phone_or_email  VARCHAR(255) NOT NULL,
    code_hash       VARCHAR(255) NOT NULL,
    purpose         VARCHAR(30) NOT NULL,    -- 'register' | 'login' | 'reset_password'
    expires_at      TIMESTAMPTZ NOT NULL,
    used            BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Avatardan tashqari, profil kartasida ko'rsatiladigan qo'shimcha rasmlar
-- (max 9 dona, backend darajasida cheklanadi).
CREATE TABLE IF NOT EXISTS user_photos (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url        TEXT NOT NULL,
    position   SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Follow tizimi (SRS 2.2)
CREATE TABLE IF NOT EXISTS follows (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    follower_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uniq_follow UNIQUE (follower_id, following_id),
    CONSTRAINT chk_no_self_follow CHECK (follower_id <> following_id)
);

-- Reels/Posts moduli (SRS 2.3)
CREATE TABLE IF NOT EXISTS posts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_url       TEXT,
    media_type      VARCHAR(10) CHECK (media_type IN ('photo', 'video')),
    caption         TEXT,
    thumbnail_url   TEXT,
    duration        SMALLINT,
    views_count     INTEGER NOT NULL DEFAULT 0,
    likes_count     INTEGER NOT NULL DEFAULT 0,
    comments_count  INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS likes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uniq_like UNIQUE (post_id, user_id)
);

-- Bitta postda bir nechta media (rasm/video) — carousel postlar uchun.
-- posts.media_url/media_type birinchi elementning nusxasi (tezkor ko'rsatish uchun).
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

CREATE TABLE IF NOT EXISTS comments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content    VARCHAR(500) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_group   BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    media_url       TEXT,
    type            VARCHAR(10) NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image', 'video', 'voice')),
    status          VARCHAR(10) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tezkor qidiruv uchun indekslar
CREATE INDEX IF NOT EXISTS idx_auth_providers_user_id ON auth_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_otp_codes_phone_or_email ON otp_codes(phone_or_email);
CREATE INDEX IF NOT EXISTS idx_user_photos_user_id ON user_photos(user_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower  ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_likes_post_id ON likes(post_id);
CREATE INDEX IF NOT EXISTS idx_likes_user_id ON likes(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id);
CREATE INDEX IF NOT EXISTS idx_post_media_post_id ON post_media(post_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created   ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_sender    ON messages(conversation_id, sender_id, status);
