const { Pool, types } = require('pg');
require('dotenv').config();

// DATE ustunlari (masalan users.birth_date) vaqt zonasiga bog'liq emas.
// node-pg ularni sukut bo'yicha JS Date'ga (server zonasidagi yarim tun)
// aylantiradi va JSON'da UTC'ga o'tganda sana bir kun orqaga surilib ketadi.
// Shuning uchun DATE'ni bazadagi kabi 'YYYY-MM-DD' matn holida qoldiramiz.
types.setTypeParser(types.builtins.DATE, (value) => value);

// Butun backend shu bitta pool orqali PostgreSQL'ga ulanadi
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

// Bo'sh turgan ulanishdagi xato (masalan Postgres qayta ishga tushganda) —
// pool o'sha ulanishni o'zi tashlab yuboradi, serverni to'xtatish shart emas.
pool.on('error', (err) => {
    console.error('Kutilmagan PostgreSQL xatosi:', err);
});

module.exports = pool;
