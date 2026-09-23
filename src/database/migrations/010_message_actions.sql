-- =====================================================================
-- Migratsiya: Reply / Pin / Edit / Forward / Delete (o'zim uchun va
-- hammaga) uchun messages jadvaliga ustunlar + o'chirish jadvali.
-- Qayta-qayta ishga tushirish xavfsiz.
-- =====================================================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id            UUID REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_pinned              BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at              TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_for_everyone   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_forwarded           BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS forwarded_from_username VARCHAR(50);

-- "O'zim uchun o'chirish" — faqat shu foydalanuvchining ro'yxatidan
-- yashiradi, xabarning o'zi (va boshqa ishtirokchi uchun) o'zgarmaydi.
CREATE TABLE IF NOT EXISTS message_deletions (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_reply_to    ON messages(reply_to_id);
CREATE INDEX IF NOT EXISTS idx_messages_pinned      ON messages(conversation_id, is_pinned) WHERE is_pinned = true;
CREATE INDEX IF NOT EXISTS idx_message_deletions_user ON message_deletions(user_id);
