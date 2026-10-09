const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');
const controller = require('../controllers/stickers.controller');
const { requireAuth } = require('../middlewares/auth.middleware');
const {
    uploadStickerFile,
    uploadGifFile,
    cleanupUploadsOnError,
} = require('../middlewares/upload.middleware');
const stickersService = require('../services/stickers.service');
const { isUuid } = require('../utils/http');

const router = express.Router();

function validate(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg, errors: errors.array() });
    }
    next();
}

// Fayl diskka yozilishidan OLDIN: faqat to'plam egasi unga stiker qo'sha oladi.
async function requirePackOwner(req, res, next) {
    try {
        if (!isUuid(req.params.id)) return res.status(400).json({ error: 'ID noto\'g\'ri' });
        if (!(await stickersService.isPackOwner(req.params.id, req.userId))) {
            return res.status(404).json({ error: 'Stiker to\'plami topilmadi' });
        }
        next();
    } catch (err) {
        next(err);
    }
}

// Qidiruv tashqi xizmatga boradi (bepul kalitlarning soatlik limiti bor) —
// har bir foydalanuvchi uchun alohida cheklov (natijalar keshlanadi ham).
const searchLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.userId,
    message: { error: 'Juda ko\'p so\'rov. Birozdan keyin qayta urinib ko\'ring.' },
});

const packId = [param('id').isUUID().withMessage('ID noto\'g\'ri')];
const title = [
    body('title').isString().withMessage('To\'plam nomi kerak').trim()
        .isLength({ min: 1, max: 64 }).withMessage('To\'plam nomi 1–64 belgi bo\'lishi kerak'),
];

router.get(
    '/search',
    requireAuth,
    searchLimiter,
    [
        query('kind').isIn(['gifs', 'stickers']).withMessage('kind noto\'g\'ri'),
        query('q').optional().isString().isLength({ max: 100 }).withMessage('Qidiruv matni juda uzun'),
        query('page').optional().isInt({ min: 1, max: 50 }).withMessage('page noto\'g\'ri'),
        query('lang').optional().isString().isLength({ max: 10 }).withMessage('lang noto\'g\'ri'),
    ],
    validate,
    controller.search
);

router.get('/packs', requireAuth, controller.listPacks);
router.post('/packs', requireAuth, title, validate, controller.createPack);
router.get('/packs/:id', requireAuth, packId, validate, controller.getPack);
router.patch('/packs/:id', requireAuth, [...packId, ...title], validate, controller.renamePack);
router.delete('/packs/:id', requireAuth, packId, validate, controller.deletePack);
router.post('/packs/:id/install', requireAuth, packId, validate, controller.installPack);
router.delete('/packs/:id/install', requireAuth, packId, validate, controller.uninstallPack);

router.post(
    '/packs/:id/stickers',
    requireAuth,
    requirePackOwner,
    cleanupUploadsOnError,
    uploadStickerFile,
    [body('emoji').optional({ values: 'falsy' }).isString().isLength({ max: 16 }).withMessage('emoji noto\'g\'ri')],
    validate,
    controller.addSticker
);

router.delete(
    '/items/:id',
    requireAuth,
    [param('id').isUUID().withMessage('ID noto\'g\'ri')],
    validate,
    controller.deleteSticker
);

router.get('/gifs', requireAuth, controller.listGifs);

router.post(
    '/gifs',
    requireAuth,
    [
        body('url').isString().isLength({ min: 1, max: 2000 }).withMessage('url noto\'g\'ri'),
        body('previewUrl').optional({ values: 'falsy' }).isString().isLength({ max: 2000 }).withMessage('previewUrl noto\'g\'ri'),
        body('width').optional({ values: 'falsy' }).isInt({ min: 1, max: 10000 }).toInt().withMessage('width noto\'g\'ri'),
        body('height').optional({ values: 'falsy' }).isInt({ min: 1, max: 10000 }).toInt().withMessage('height noto\'g\'ri'),
    ],
    validate,
    controller.saveGif
);

router.post(
    '/gifs/upload',
    requireAuth,
    cleanupUploadsOnError,
    uploadGifFile,
    [
        body('width').optional({ values: 'falsy' }).isInt({ min: 1, max: 4000 }).withMessage('width noto\'g\'ri'),
        body('height').optional({ values: 'falsy' }).isInt({ min: 1, max: 4000 }).withMessage('height noto\'g\'ri'),
    ],
    validate,
    controller.uploadGif
);

router.delete(
    '/gifs/:id',
    requireAuth,
    [param('id').isUUID().withMessage('ID noto\'g\'ri')],
    validate,
    controller.deleteGif
);

module.exports = router;
