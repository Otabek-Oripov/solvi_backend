const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const controller = require('../controllers/posts.controller');
const { requireAuth } = require('../middlewares/auth.middleware');
const { uploadPost, cleanupUploadsOnError } = require('../middlewares/upload.middleware');

const router = express.Router();

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
    ],
    validate,
    controller.create
);

router.get('/feed', requireAuth, controller.getFeed);

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
    router.post(path, requireAuth, checks, validate, add);
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
