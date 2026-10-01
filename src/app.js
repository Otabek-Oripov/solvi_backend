const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const authRoutes = require('./routes/auth.routes');
const usersRoutes = require('./routes/users.routes');
const postsRoutes = require('./routes/posts.routes');
const messagingRoutes = require('./routes/messaging.routes');
const matchingRoutes = require('./routes/matching.routes');
const { UPLOAD_DIR } = require('./middlewares/upload.middleware');
const { handleError } = require('./utils/http');

const app = express();

// X-Forwarded-For sarlavhasiga FAQAT server haqiqatan ham proxy (Nginx)
// orqasida turganda ishonamiz. Proxy yo'q bo'lsa (lokal ishga tushirish),
// bu sarlavhani istalgan klient o'zi yozib, rate limit'ni aylanib o'tardi.
// Serverga chiqarilganda .env'da TRUST_PROXY=1 qo'yiladi.
if (process.env.TRUST_PROXY) {
    const hops = Number(process.env.TRUST_PROXY);
    app.set('trust proxy', Number.isNaN(hops) ? process.env.TRUST_PROXY : hops);
}

// helmet cross-origin siyosati rasm fayllarni <img> orqali ko'rsatishga
// to'sqinlik qilmasligi uchun crossOriginResourcePolicy bo'shatiladi.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));

// Yuklangan profil rasmlari — MUHIM: bu vaqtinchalik yechim, production'da
// Cloudflare R2/S3'ga o'tkaziladi (SRS 5-bo'lim).
app.use('/uploads', express.static(UPLOAD_DIR));

// /auth/me (har safar ilova ochilganda) va /auth/refresh (har 15 daqiqada,
// har bir qurilmadan) — oddiy ish jarayonining bir qismi, brute-force
// nishoni emas. Bitta IP ortida ko'p foydalanuvchi bo'lishi mumkin (ofis
// Wi-Fi, mobil operator), shuning uchun ular qattiq authLimiter'ga
// tushmaydi — alohida, kengroq limit oladi.
const SESSION_PATHS = ['/me', '/refresh'];

// Brute-force'dan himoya: auth endpointlariga daqiqasiga cheklangan so'rov
const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => SESSION_PATHS.includes(req.path),
    message: { error: 'Juda ko\'p urinish. Birozdan keyin qayta urinib ko\'ring.' },
});

const sessionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Juda ko\'p so\'rov. Birozdan keyin qayta urinib ko\'ring.' },
});
app.use('/auth/me', sessionLimiter);
app.use('/auth/refresh', sessionLimiter);

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

// Profil (ko'rish/tahrirlash) — oddiy foydalanish limiti
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/users', apiLimiter, usersRoutes);
app.use('/posts', apiLimiter, postsRoutes);
app.use('/conversations', apiLimiter, messagingRoutes);
app.use('/matching', apiLimiter, matchingRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use((req, res) => res.status(404).json({ error: 'Topilmadi' }));

// Oxirgi himoya qatlami — stack trace hech qachon clientga ketmaydi
app.use((err, req, res, next) => {
    // Multer xatolari (fayl juda katta va h.k.) — 400 sifatida qaytariladi
    if (err.name === 'MulterError') {
        return res.status(400).json({ error: err.message });
    }
    // status'i bor (o'zimiz yoki express/body-parser qo'ygan 4xx) xatolargina
    // matni bilan qaytariladi; qolgan hammasi — kutilmagan xato.
    handleError(res, err);
});

module.exports = app;
