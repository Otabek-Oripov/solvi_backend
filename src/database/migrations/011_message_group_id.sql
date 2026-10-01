-- Bir nechta rasm birga tanlab yuborilganda — ularni bitta "albom"
-- sifatida guruhlash uchun. Qiymat mijoz (Flutter) tomonidan generatsiya
-- qilinadi va shu partiyadagi barcha xabarlarga bir xil beriladi.
-- Qayta-qayta ishga tushirish xavfsiz.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS group_id TEXT;

CREATE INDEX IF NOT EXISTS idx_messages_group_id ON messages(group_id) WHERE group_id IS NOT NULL;
