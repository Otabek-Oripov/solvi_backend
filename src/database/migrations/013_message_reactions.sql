-- =====================================================================
-- Migratsiya: Xabarlarga emoji reaksiya qoldirish (WhatsApp uslubida —
-- har bir foydalanuvchi bitta xabarga faqat BITTA emoji qo'ya oladi;
-- qayta bosilsa o'chadi, boshqa emoji tanlansa almashadi).
-- Qayta-qayta ishga tushirish xavfsiz.
-- =====================================================================

CREATE TABLE IF NOT EXISTS message_reactions (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);
