-- Ovozli xabarlar uchun — davomiylik (mm:ss ko'rsatish uchun, faylni
-- yuklab tahlil qilmasdan) va to'lqin shakli (waveform) namunalari
-- (mijoz tomonidan yozib olish paytida hisoblanadi, vergul bilan
-- ajratilgan sonlar sifatida saqlanadi va qayta ijro etishda bir xil
-- ko'rinishni chizish uchun ishlatiladi).
ALTER TABLE messages ADD COLUMN duration_ms INTEGER;
ALTER TABLE messages ADD COLUMN waveform TEXT;
