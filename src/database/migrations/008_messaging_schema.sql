-- =====================================================================
-- Migratsiya: Messaging moduli — conversations / conversation_participants
-- / messages jadvallari. V1: faqat 1:1 matnli chat (is_group hozircha
-- ishlatilmaydi, kelajakda group chat uchun zaxira). Qayta-qayta ishga
-- tushirish xavfsiz.
-- =====================================================================

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
    type            VARCHAR(10) NOT NULL DEFAULT 'text',
    status          VARCHAR(10) NOT NULL DEFAULT 'sent',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_messages_type'
    ) THEN
        ALTER TABLE messages ADD CONSTRAINT chk_messages_type
            CHECK (type IN ('text', 'image', 'video', 'voice'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_messages_status'
    ) THEN
        ALTER TABLE messages ADD CONSTRAINT chk_messages_status
            CHECK (status IN ('sent', 'delivered', 'read'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created   ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_sender    ON messages(conversation_id, sender_id, status);
