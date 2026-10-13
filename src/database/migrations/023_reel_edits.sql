-- =====================================================================
-- Migratsiya: Reels muharriri (Instagram / TikTok uslubida).
-- Qayta-qayta ishga tushirish xavfsiz.
--
--  - edit — videoga qo'llangan tahrirlar: filtr va uning kuchi, yorqinlik/
--    kontrast/to'yinganlik/iliqlik/xiralik/vinyetka, kesish (boshi/oxiri),
--    tezlik, asl ovoz va musiqa balandligi, fon (videoni to'liq ko'rsatganda
--    — xira video, rang yoki gradient), matn/emoji/stikerlar. Video fayl
--    qayta kodlanmaydi — tahrirlar ko'rsatish paytida qo'llanadi (story
--    ustidagi matnlar kabi). NULL — tahrirsiz.
--  - music_url — videoga qo'shilgan musiqa yoki ovozli izoh (alohida audio
--    fayl, video bilan birga o'ynaydi).
-- =====================================================================

ALTER TABLE posts ADD COLUMN IF NOT EXISTS edit JSONB;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS music_url TEXT;
