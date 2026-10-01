-- =====================================================================
-- Migratsiya: yaxlitlik va tozalash (2026-10 tekshiruvi natijalari).
-- Qayta-qayta ishga tushirish xavfsiz.
--
--  1. users.updated_at triggeri — bazada qo'lda yaratilgan, lekin repo'da
--     yo'q edi (noldan o'rnatilgan bazada updated_at yangilanmas edi).
--  2. otp_codes.attempts — tasdiqlash kodiga urinishlar sonini cheklash.
--  3. Yuklangan fayl havolalari: to'liq URL (http://<IP>:3000/uploads/..)
--     o'rniga nisbiy yo'l (/uploads/..) — host o'zgarganda buzilmaydi.
--  4. Bir juftlik uchun bitta suhbat (conversations.direct_key, UNIQUE)
--     va ishtirokchisiz qolgan suhbatlarni tozalash.
--  5. Gmail manzillarini backend ishlatadigan yagona shaklga keltirish.
-- =====================================================================

-- ------------------------------------------------------- 1. updated_at
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------ 2. OTP attempts
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS attempts SMALLINT NOT NULL DEFAULT 0;

-- --------------------------------------------- 3. nisbiy fayl havolalari
-- Faqat o'zimiz yuklagan fayllar (/uploads/<uuid>.<kengaytma>) o'zgaradi;
-- tashqi havolalar (Google avatar, Giphy va h.k.) tegilmaydi.
UPDATE users SET avatar_url = regexp_replace(avatar_url, '^https?://[^/]+(/uploads/[0-9a-f-]{36}\.[a-z0-9]+)$', '\1')
    WHERE avatar_url ~ '^https?://[^/]+/uploads/[0-9a-f-]{36}\.[a-z0-9]+$';
UPDATE user_photos SET url = regexp_replace(url, '^https?://[^/]+(/uploads/[0-9a-f-]{36}\.[a-z0-9]+)$', '\1')
    WHERE url ~ '^https?://[^/]+/uploads/[0-9a-f-]{36}\.[a-z0-9]+$';
UPDATE posts SET media_url = regexp_replace(media_url, '^https?://[^/]+(/uploads/[0-9a-f-]{36}\.[a-z0-9]+)$', '\1')
    WHERE media_url ~ '^https?://[^/]+/uploads/[0-9a-f-]{36}\.[a-z0-9]+$';
UPDATE posts SET thumbnail_url = regexp_replace(thumbnail_url, '^https?://[^/]+(/uploads/[0-9a-f-]{36}\.[a-z0-9]+)$', '\1')
    WHERE thumbnail_url ~ '^https?://[^/]+/uploads/[0-9a-f-]{36}\.[a-z0-9]+$';
UPDATE post_media SET media_url = regexp_replace(media_url, '^https?://[^/]+(/uploads/[0-9a-f-]{36}\.[a-z0-9]+)$', '\1')
    WHERE media_url ~ '^https?://[^/]+/uploads/[0-9a-f-]{36}\.[a-z0-9]+$';
UPDATE post_media SET thumbnail_url = regexp_replace(thumbnail_url, '^https?://[^/]+(/uploads/[0-9a-f-]{36}\.[a-z0-9]+)$', '\1')
    WHERE thumbnail_url ~ '^https?://[^/]+/uploads/[0-9a-f-]{36}\.[a-z0-9]+$';
UPDATE messages SET media_url = regexp_replace(media_url, '^https?://[^/]+(/uploads/[0-9a-f-]{36}\.[a-z0-9]+)$', '\1')
    WHERE media_url ~ '^https?://[^/]+/uploads/[0-9a-f-]{36}\.[a-z0-9]+$';

-- ------------------------------------------- 4. suhbatlar yaxlitligi
-- 4a. Ishtirokchisi to'liq bo'lmagan 1:1 suhbatlar (user o'chirilganda
--     qolib ketgan) — ularni hech kim ocha olmaydi.
DELETE FROM conversations c
WHERE c.is_group = false
  AND (SELECT COUNT(*) FROM conversation_participants p WHERE p.conversation_id = c.id) < 2;

-- 4b. Bir juftlik uchun bir nechta suhbat ochilib qolgan bo'lsa — eng
--     eskisi qoldiriladi, qolganlarining xabarlari unga ko'chiriladi.
DROP TABLE IF EXISTS _duplicate_direct_conversations;
CREATE TEMP TABLE _duplicate_direct_conversations AS
SELECT id, keeper_id
FROM (
    SELECT c.id,
           first_value(c.id) OVER (
               PARTITION BY a.user_id, b.user_id ORDER BY c.created_at, c.id
           ) AS keeper_id
    FROM conversations c
    JOIN conversation_participants a ON a.conversation_id = c.id
    JOIN conversation_participants b ON b.conversation_id = c.id AND a.user_id < b.user_id
    WHERE c.is_group = false
) ranked
WHERE id <> keeper_id;

UPDATE messages m SET conversation_id = d.keeper_id
    FROM _duplicate_direct_conversations d WHERE m.conversation_id = d.id;
UPDATE matches m SET conversation_id = d.keeper_id
    FROM _duplicate_direct_conversations d WHERE m.conversation_id = d.id;
DELETE FROM conversations c USING _duplicate_direct_conversations d WHERE c.id = d.id;
DROP TABLE _duplicate_direct_conversations;

-- 4c. direct_key = "<kichik user id>:<katta user id>" — UNIQUE bo'lgani
--     uchun ikki so'rov bir vaqtda kelsa ham ikkinchi suhbat yaratilmaydi
--     (backend: INSERT ... ON CONFLICT (direct_key) DO NOTHING).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS direct_key TEXT;

UPDATE conversations c
SET direct_key = k.direct_key
FROM (
    SELECT a.conversation_id, a.user_id::text || ':' || b.user_id::text AS direct_key
    FROM conversation_participants a
    JOIN conversation_participants b
      ON b.conversation_id = a.conversation_id AND a.user_id < b.user_id
) k
WHERE k.conversation_id = c.id AND c.is_group = false AND c.direct_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_conversations_direct_key ON conversations(direct_key);

-- 4d. Ishtirokchi o'chirilganda (masalan user o'chirilishi bilan CASCADE
--     orqali) 1:1 suhbatning o'zi ham o'chiriladi — aks holda u bazada
--     ishtirokchisiz, hech kim ko'rmaydigan holda qolib ketardi.
CREATE OR REPLACE FUNCTION delete_orphaned_conversation() RETURNS trigger AS $$
BEGIN
    DELETE FROM conversations c
    WHERE c.id = OLD.conversation_id
      AND (
          c.is_group = false
          OR NOT EXISTS (
              SELECT 1 FROM conversation_participants p WHERE p.conversation_id = c.id
          )
      );
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_conversation_participant_removed ON conversation_participants;
CREATE TRIGGER trg_conversation_participant_removed
    AFTER DELETE ON conversation_participants
    FOR EACH ROW EXECUTE FUNCTION delete_orphaned_conversation();

-- ------------------------------------------------ 5. Gmail manzillari
-- Backend email'ni validator.normalizeEmail bilan bir shaklga keltiradi:
-- Gmail'da nuqtalar va "+tag" olib tashlanadi, googlemail.com -> gmail.com.
-- Ilgari Google orqali kirgan foydalanuvchilar asl (nuqtali) shaklda
-- saqlangan — ularni ham shu shaklga keltiramiz, aks holda o'sha odam
-- email bilan ro'yxatdan o'tsa ikkinchi hisob ochilardi. Natijasi boshqa
-- hisob bilan ustma-ust tushadigan manzillarga tegilmaydi.
WITH candidates AS (
    SELECT id,
           replace(split_part(split_part(email, '@', 1), '+', 1), '.', '') || '@gmail.com' AS normalized
    FROM users
    WHERE email ~ '@(gmail|googlemail)\.com$'
)
UPDATE users u
SET email = c.normalized
FROM candidates c
WHERE c.id = u.id
  AND u.email <> c.normalized
  AND (SELECT COUNT(*) FROM candidates c2 WHERE c2.normalized = c.normalized) = 1
  AND NOT EXISTS (SELECT 1 FROM users x WHERE x.email = c.normalized);
