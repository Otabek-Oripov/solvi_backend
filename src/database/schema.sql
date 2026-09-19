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

-- Tezkor qidiruv uchun indekslar
CREATE INDEX IF NOT EXISTS idx_auth_providers_user_id ON auth_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_otp_codes_phone_or_email ON otp_codes(phone_or_email);
