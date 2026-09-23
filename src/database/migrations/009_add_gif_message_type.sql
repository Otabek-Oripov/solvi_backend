-- =====================================================================
-- Migratsiya: messages.type ro'yxatiga 'gif' qo'shiladi — Giphy kabi
-- tashqi manbadan GIF yuborish uchun (fayl serverga yuklanmaydi, faqat
-- havola saqlanadi). Qayta-qayta ishga tushirish xavfsiz.
-- =====================================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_messages_type'
    ) THEN
        ALTER TABLE messages DROP CONSTRAINT chk_messages_type;
    END IF;
    ALTER TABLE messages ADD CONSTRAINT chk_messages_type
        CHECK (type IN ('text', 'image', 'video', 'voice', 'gif'));
END $$;
