-- Bir nechta rasm birga tanlab yuborilganda — ularni bitta "albom"
-- sifatida guruhlash uchun. Qiymat mijoz (Flutter) tomonidan generatsiya
-- qilinadi va shu partiyadagi barcha xabarlarga bir xil beriladi.
ALTER TABLE messages ADD COLUMN group_id TEXT;

CREATE INDEX idx_messages_group_id ON messages(group_id) WHERE group_id IS NOT NULL;
