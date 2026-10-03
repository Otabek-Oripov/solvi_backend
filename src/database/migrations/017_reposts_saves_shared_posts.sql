-- =====================================================================
-- Migratsiya: repost, saqlash (bookmark) va postni chatda ulashish.
-- Qayta-qayta ishga tushirish xavfsiz.
--
--  - reposts — foydalanuvchi boshqaning postini o'z profiliga "repost"
--    qiladi (profil > Postlar > Repostlar tabida ko'rinadi, hammaga ochiq).
--  - saved_posts — saqlangan postlar (faqat egasiga ko'rinadi).
--  - posts.reposts_count — reels'dagi repost tugmasi ostidagi son.
--  - messages.shared_post_id + type 'post' — post do'stga chat orqali
--    yuborilganda (post o'chirilsa havola NULL bo'ladi, xabar qoladi).
-- =====================================================================

ALTER TABLE posts ADD COLUMN IF NOT EXISTS reposts_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS reposts (
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS saved_posts (
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reposts_user ON reposts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_posts_user ON saved_posts(user_id, created_at DESC);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS shared_post_id UUID REFERENCES posts(id) ON DELETE SET NULL;

-- Cheklov nomi bazaning qanday yaratilganiga bog'liq: migratsiyalar orqali
-- — chk_messages_type, schema.sql'dagi ustun cheklovi — messages_type_check.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS chk_messages_type;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE messages ADD CONSTRAINT chk_messages_type
    CHECK (type IN ('text', 'image', 'video', 'voice', 'gif', 'post'));
