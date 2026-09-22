-- =====================================================================
-- Migratsiya: "sexual_orientation" maydoni butunlay olib tashlandi
-- (mahsulot qarori). Qayta-qayta ishga tushirish xavfsiz.
-- =====================================================================

ALTER TABLE users DROP COLUMN IF EXISTS sexual_orientation;
