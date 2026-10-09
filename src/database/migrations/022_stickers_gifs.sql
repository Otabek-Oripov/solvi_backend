-- =====================================================================
-- Migratsiya: stikerlar va GIFlar (Telegram uslubida). Qayta-qayta ishga
-- tushirish xavfsiz.
--
--  - sticker_packs — foydalanuvchi yaratgan stiker to'plamlari. To'plam
--    ochiq: kimdir chatda shu to'plamdagi stikerni olsa, uni bosib
--    butun to'plamni o'ziga qo'sha oladi;
--  - stickers — to'plam ichidagi stikerlar (PNG/WEBP — oddiy, GIF —
--    animatsion), har biriga bitta "ma'nosi" emoji;
--  - user_sticker_packs — foydalanuvchi o'z paneliga qo'shgan to'plamlar
--    (o'zi yaratganlari ham yaratilishi bilan shu yerga yoziladi);
--  - saved_gifs — "Saqlangan GIFlar": tashqi manbadan (KLIPY/GIPHY)
--    saqlanganlari va foydalanuvchining o'zi yasaganlari (is_own);
--  - messages.type ro'yxatiga 'sticker' qo'shiladi, messages.sticker_id —
--    qaysi stiker yuborilgani (to'plamni ochish uchun; stiker o'chirilsa
--    NULL, rasmi esa media_url'da qoladi).
-- =====================================================================

CREATE TABLE IF NOT EXISTS sticker_packs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stickers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_id     UUID NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
    media_url   TEXT NOT NULL,
    is_animated BOOLEAN NOT NULL DEFAULT false,
    emoji       VARCHAR(16),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sticker_packs (
    user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pack_id  UUID NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, pack_id)
);

CREATE TABLE IF NOT EXISTS saved_gifs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    preview_url TEXT,
    width       INTEGER,
    height      INTEGER,
    is_own      BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_saved_gifs_user_url UNIQUE (user_id, url)
);

CREATE INDEX IF NOT EXISTS idx_sticker_packs_owner ON sticker_packs(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stickers_pack ON stickers(pack_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stickers_media_url ON stickers(media_url);
CREATE INDEX IF NOT EXISTS idx_user_sticker_packs_pack ON user_sticker_packs(pack_id);
CREATE INDEX IF NOT EXISTS idx_saved_gifs_user ON saved_gifs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_gifs_url ON saved_gifs(url);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS sticker_id UUID REFERENCES stickers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_sticker ON messages(sticker_id) WHERE sticker_id IS NOT NULL;
-- "Fayl hali ishlatilyaptimi" tekshiruvi (xabar/stiker o'chirilganda)
CREATE INDEX IF NOT EXISTS idx_messages_media_url ON messages(media_url) WHERE media_url IS NOT NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_messages_type') THEN
        ALTER TABLE messages DROP CONSTRAINT chk_messages_type;
    END IF;
    ALTER TABLE messages ADD CONSTRAINT chk_messages_type
        CHECK (type IN ('text', 'image', 'video', 'voice', 'gif', 'post', 'sticker'));
END $$;
