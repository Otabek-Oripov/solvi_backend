// Migratsiyalarni tartib bilan ishga tushiruvchi kichik skript:
//     npm run db:migrate
//
// Qaysi fayl allaqachon qo'llangani schema_migrations jadvalida yoziladi,
// shuning uchun har bir migratsiya faqat BIR MARTA ishlaydi. Har bir fayl
// alohida tranzaksiyada bajariladi — xato bo'lsa o'sha fayl to'liq bekor
// qilinadi va skript to'xtaydi.
//
// Birinchi ishga tushirishda:
//   - baza bo'sh bo'lsa — schema.sql (joriy to'liq sxema) o'rnatiladi va
//     barcha migratsiyalar "qo'llangan" deb belgilanadi;
//   - baza allaqachon mavjud bo'lsa (migratsiyalar pgAdmin orqali qo'lda
//     yurgizilgan) — LAST_MANUAL gacha bo'lganlari "qo'llangan" deb
//     belgilanadi, qolganlari ishga tushadi.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const SCHEMA_FILE = path.join(__dirname, 'schema.sql');
// Shu skript paydo bo'lishidan oldin qo'lda qo'llangan oxirgi migratsiya
const LAST_MANUAL = '014_swipes_matches.sql';

async function main() {
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    const client = await pool.connect();
    try {
        await client.query(
            `CREATE TABLE IF NOT EXISTS schema_migrations (
                 filename   TEXT PRIMARY KEY,
                 applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
             )`
        );

        const { rows } = await client.query('SELECT filename FROM schema_migrations');
        const applied = new Set(rows.map((r) => r.filename));

        if (applied.size === 0) {
            const existing = await client.query(`SELECT to_regclass('public.users') AS users`);
            const baseline = existing.rows[0].users
                ? files.filter((f) => f <= LAST_MANUAL)
                : files;

            await client.query('BEGIN');
            if (!existing.rows[0].users) {
                console.log('Baza bo\'sh — schema.sql o\'rnatilmoqda...');
                await client.query(fs.readFileSync(SCHEMA_FILE, 'utf8'));
            }
            for (const file of baseline) {
                await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
                applied.add(file);
            }
            await client.query('COMMIT');
            console.log(`${baseline.length} ta migratsiya "qo'llangan" deb belgilandi.`);
        }

        const pending = files.filter((f) => !applied.has(f));
        if (pending.length === 0) {
            console.log('Yangi migratsiya yo\'q — baza joriy holatda.');
            return;
        }

        for (const file of pending) {
            process.stdout.write(`-> ${file} ... `);
            await client.query('BEGIN');
            try {
                await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
                await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
                await client.query('COMMIT');
                console.log('OK');
            } catch (err) {
                await client.query('ROLLBACK').catch(() => {});
                console.log('XATO');
                throw err;
            }
        }
        console.log(`${pending.length} ta migratsiya qo'llandi.`);
    } finally {
        client.release();
    }
}

main()
    .catch((err) => {
        console.error('Migratsiya to\'xtadi:', err.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
