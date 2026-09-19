const { Pool } = require('pg');
require('dotenv').config();

// Butun backend shu bitta pool orqali PostgreSQL'ga ulanadi
const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

pool.on('error', (err) => {
    console.error('Kutilmagan PostgreSQL xatosi:', err);
    process.exit(-1);
});

module.exports = pool;