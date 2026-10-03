-- =====================================================================
-- Migratsiya: repostga "fikr" (Instagram'dagi "Add a thought...").
-- Repost qilgan odam avatari ustidagi pufakchada ko'rinadigan qisqa
-- matn; bo'sh (NULL) bo'lishi mumkin. Qayta-qayta ishga tushirish xavfsiz.
-- =====================================================================

ALTER TABLE reposts ADD COLUMN IF NOT EXISTS thought VARCHAR(100);
