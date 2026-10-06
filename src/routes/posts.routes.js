const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const controller = require('../controllers/posts.controller');
const { requireAuth } = require('../middlewares/auth.middleware');
const { uploadPost, cleanupUploadsOnError } = require('../middlewares/upload.middleware');
const { VISIBILITIES } = require('../utils/postVisibility');

const router = express.Router();

// Post sozlamalari (yaratishda — multipart satrlar, tahrirlashda — JSON)
const settingsChecks = [
    body('visibility').optional({ values: 'falsy' }).isIn(VISIBILITIES).withMessage('visibility noto\'g\'ri'),
    body('commentsEnabled').optional({ values: 'null' }).isBoolean().withMessage('commentsEnabled noto\'g\'ri'),
    body('hideLikeCount').optional({ values: 'null' }).isBoolean().withMessage('hideLikeCount noto\'g\'ri'),
    body('allowDownloads').optional({ values: 'null' }).isBoolean().withMessage('allowDownloads noto\'g\'ri'),
];

function validate(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: errors.array()[0].msg,
            errors: errors.array(),
        });
    }
    next();
}

router.post(
    '/',
    requireAuth,
    cleanupUploadsOnError,
    uploadPost,
    [
        body('caption').optional({ nullable: true }).isLength({ max: 500 }).withMessage('Caption 500 belgidan oshmasin'),
        body('duration').optional({ nullable: true }).isInt({ min: 0, max: 600 }).withMessage('Video davomiyligi noto\'g\'ri'),
        ...settingsChecks,
        body('shareToStory').optional({ values: 'falsy' }).isBoolean().withMessage('shareToStory noto\'g\'ri'),
    ],
    validate,
    controller.create
);

// Heshteg takliflari. Diqqat: `/:id` dan OLDIN bo'lishi shart.
router.get(
    '/tags',
    requireAuth,
    [
        query('q').optional({ values: 'falsy' }).isString().isLength({ max: 60 }).withMessage('q juda uzun'),
        query('limit').optional().isInt({ min: 1, max: 20 }).withMessage('limit noto\'g\'ri'),
    ],
    validate,
    controller.tags
);

// Caption va sozlamalarni o'zgartirish (faqat muallif)
router.patch(
    '/:id',
    requireAuth,
    [
        param('id').isUUID().withMessage('ID noto\'g\'ri'),
        body('caption').optional({ nullable: true }).isString().withMessage('Caption matn bo\'lishi kerak')
            .isLength({ max: 500 }).withMessage('Caption 500 belgidan oshmasin'),
        ...settingsChecks,
    ],
    validate,
    controller.update
);

router.get(
    '/feed',
    requireAuth,
    [
        query('mode').optional().isIn(['for_you', 'following']).withMessage('mode noto\'g\'ri'),
        query('session').optional({ values: 'falsy' }).isUUID().withMessage('session noto\'g\'ri'),
        query('limit').optional().isInt({ min: 1, max: 30 }).withMessage('limit noto\'g\'ri'),
        query('cursor').optional({ values: 'falsy' }).isISO8601().withMessage('cursor noto\'g\'ri'),
    ],
    validate,
    controller.getFeed
);

// Ko'rishlar (tavsiya signallari): bir so'rovda ko'pi bilan 50 ta
router.post(
    '/views',
    requireAuth,
    [
        body('events').isArray({ min: 1, max: 50 }).withMessage('events — 1..50 ta ko\'rish'),
        body('events.*.postId').isUUID().withMessage('postId noto\'g\'ri'),
        body('events.*.watchMs').isInt({ min: 0, max: 3600000 }).withMessage('watchMs noto\'g\'ri'),
        body('events.*.durationMs').optional({ nullable: true }).isInt({ min: 0, max: 3600000 }).withMessage('durationMs noto\'g\'ri'),
        body('events.*.progress').optional({ nullable: true }).isFloat({ min: 0, max: 1 }).withMessage('progress noto\'g\'ri'),
        body('events.*.source').optional({ nullable: true }).isString().isLength({ max: 20 }),
    ],
    validate,
    controller.views
);

// Diqqat: `/saved` — `/:id` dan OLDIN bo'lishi shart, aks holda "saved"
// UUID parametr sifatida talqin qilinib, 400 xato qaytaradi.
router.get('/saved', requireAuth, controller.getSaved);

router.get(
    '/user/:id',
    requireAuth,
    [
        param('id').isUUID().withMessage('ID noto\'g\'ri'),
        query('mediaType').optional().isIn(['video', 'photo']).withMessage('mediaType noto\'g\'ri'),
    ],
    validate,
    controller.getUserPosts
);

router.get(
    '/user/:id/reposts',
    requireAuth,
    [param('id').isUUID().withMessage('ID noto\'g\'ri')],
    validate,
    controller.getUserReposts
);

router.get(
    '/:id',
    requireAuth,
    [param('id').isUUID().withMessage('ID noto\'g\'ri')],
    validate,
    controller.getPost
);

for (const [path, add, remove] of [
    ['/:id/repost', controller.repost, controller.unrepost],
    ['/:id/save', controller.save, controller.unsave],
]) {
    const checks = [param('id').isUUID().withMessage('ID noto\'g\'ri')];
    const addChecks = path === '/:id/repost'
        // Repostga fikr ("Add a thought") — ixtiyoriy, 100 belgigacha
        ? [...checks, body('thought').optional({ nullable: true }).isString().withMessage('Fikr matn bo\'lishi kerak')
            .trim().isLength({ max: 100 }).withMessage('Fikr 100 belgidan oshmasin')]
        : checks;
    router.post(path, requireAuth, addChecks, validate, add);
    router.delete(path, requireAuth, checks, validate, remove);
}

router.post(
    '/:id/send',
    requireAuth,
    [
        param('id').isUUID().withMessage('ID noto\'g\'ri'),
        body('userIds').isArray({ min: 1, max: 20 }).withMessage('Kimga yuborishni tanlang (ko\'pi bilan 20 kishi)'),
        body('userIds.*').isUUID().withMessage('userId noto\'g\'ri'),
        body('content').optional({ values: 'falsy' }).isString().trim().isLength({ max: 2000 }).withMessage('Xabar juda uzun'),
    ],
    validate,
    controller.sendPost
);

router.post(
    '/:id/like',
    requireAuth,
    [param('id').isUUID().withMessage('ID noto\'g\'ri')],
    validate,
    controller.like
);

router.delete(
    '/:id/like',
    requireAuth,
    [param('id').isUUID().withMessage('ID noto\'g\'ri')],
    validate,
    controller.unlike
);

router.post(
    '/:id/comments',
    requireAuth,
    [
        param('id').isUUID().withMessage('ID noto\'g\'ri'),
        body('content').trim().notEmpty().withMessage('Izoh bo\'sh bo\'lmasin').isLength({ max: 500 }).withMessage('Izoh 500 belgidan oshmasin'),
        // Javob yozilayotgan izoh (ixtiyoriy)
        body('parentId').optional({ values: 'falsy' }).isUUID().withMessage('parentId noto\'g\'ri'),
    ],
    validate,
    controller.addComment
);

router.get(
    '/:id/comments',
    requireAuth,
    [
        param('id').isUUID().withMessage('ID noto\'g\'ri'),
        query('parentId').optional({ values: 'falsy' }).isUUID().withMessage('parentId noto\'g\'ri'),
    ],
    validate,
    controller.listComments
);

router.post(
    '/:id/comments/:commentId/like',
    requireAuth,
    [
        param('id').isUUID().withMessage('ID noto\'g\'ri'),
        param('commentId').isUUID().withMessage('ID noto\'g\'ri'),
    ],
    validate,
    controller.likeComment
);

router.delete(
    '/:id/comments/:commentId/like',
    requireAuth,
    [
        param('id').isUUID().withMessage('ID noto\'g\'ri'),
        param('commentId').isUUID().withMessage('ID noto\'g\'ri'),
    ],
    validate,
    controller.unlikeComment
);

module.exports = router;
