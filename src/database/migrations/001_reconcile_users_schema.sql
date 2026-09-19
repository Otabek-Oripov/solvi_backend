-- =====================================================================
-- Migratsiya: bazani Otabekning original dizayniga moslashtirish
-- (username/full_name uzunligi, status ENUM->VARCHAR, chk_email_or_phone,
-- auth_providers.access_token/refresh_token). replaced_by_hash saqlanadi —
-- backend refresh token rotation'da shu ustunga yozadi.
-- Qayta-qayta ishga tushirish xavfsiz.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------- users
ALTER TABLE users ALTER COLUMN username TYPE VARCHAR(50);
ALTER TABLE users ALTER COLUMN full_name TYPE VARCHAR(150);

-- status: ENUM emas, oddiy VARCHAR bo'lishi kerak edi
ALTER TABLE users ALTER COLUMN status DROP DEFAULT;
ALTER TABLE users ALTER COLUMN status TYPE VARCHAR(20) USING status::text;
ALTER TABLE users ALTER COLUMN status SET DEFAULT 'offline';
DROP TYPE IF EXISTS user_status;

-- is_verified / is_active: NOT NULL emas, oddiy DEFAULT bo'lishi kerak edi
ALTER TABLE users ALTER COLUMN is_verified DROP NOT NULL;
ALTER TABLE users ALTER COLUMN is_active DROP NOT NULL;

-- email yoki phone'dan kamida bittasi bo'lishi shart
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_email_or_phone;
ALTER TABLE users ADD CONSTRAINT chk_email_or_phone
    CHECK (email IS NOT NULL OR phone IS NOT NULL);

-- ------------------------------------------------------- auth_providers
ALTER TABLE auth_providers ADD COLUMN IF NOT EXISTS access_token  TEXT;
ALTER TABLE auth_providers ADD COLUMN IF NOT EXISTS refresh_token TEXT;

-- provider CHECK constraint — sizda yo'q edi, erkin VARCHAR bo'lishi kerak
ALTER TABLE auth_providers DROP CONSTRAINT IF EXISTS auth_providers_provider_check;

-- -------------------------------------------------------- refresh_tokens
-- replaced_by_hash — token rotation zanjiri uchun (backend kodi ishlatadi,
-- shuning uchun bu ustun SAQLANADI, original skriptda yo'q edi)
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS replaced_by_hash VARCHAR(255);

-- ------------------------------------------------------------ otp_codes
-- O'zgarish kerak emas
