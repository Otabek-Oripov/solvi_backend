const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const authRoutes = require('./routes/auth.routes');

const app = express();

app.set('trust proxy', 1); // Nginx orqasida to'g'ri IP olish uchun (rate limit)

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));

// Brute-force'dan himoya: auth endpointlariga daqiqasiga cheklangan so'rov
const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Juda ko\'p urinish. Birozdan keyin qayta urinib ko\'ring.' },
});

// /auth/me har safar ilova ochilganda chaqiriladi — unga kengroq limit
const meLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/auth/me', meLimiter);

// Register/resend-code emailga xabar yuboradi — bularni alohida qattiqroq
// cheklaymiz, aks holda birov birovning emailini spam bilan to'ldirishi mumkin.
const emailLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 soat
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Juda ko\'p urinish. Birozdan keyin qayta urinib ko\'ring.' },
});
app.use('/auth/register', emailLimiter);
app.use('/auth/resend-code', emailLimiter);

app.use('/auth', authLimiter, authRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use((req, res) => res.status(404).json({ error: 'Topilmadi' }));

// Oxirgi himoya qatlami — stack trace hech qachon clientga ketmaydi
app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'Server xatosi' });
});

module.exports = app;
