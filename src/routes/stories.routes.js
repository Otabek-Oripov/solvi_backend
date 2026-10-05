const express = require('express');
const { body, param, validationResult } = require('express-validator');
const controller = require('../controllers/stories.controller');
const { requireAuth } = require('../middlewares/auth.middleware');
const { uploadStory, cleanupUploadsOnError } = require('../middlewares/upload.middleware');

const router = express.Router();

function validate(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg, errors: errors.array() });
    }
    next();
}

const storyId = [param('id').isUUID().withMessage('ID noto\'g\'ri')];

router.get('/feed', requireAuth, controller.getFeed);

router.get(
    '/user/:id',
    requireAuth,
    [param('id').isUUID().withMessage('ID noto\'g\'ri')],
    validate,
    controller.getUserStories
);

router.post(
    '/',
    requireAuth,
    cleanupUploadsOnError,
    uploadStory,
    [
        body('postId').optional({ values: 'falsy' }).isUUID().withMessage('postId noto\'g\'ri'),
        body('durationMs').optional({ values: 'falsy' }).isInt({ min: 0 }).withMessage('durationMs noto\'g\'ri'),
        // Necha daqiqadan keyin o'chishi (ixtiyoriy, berilmasa 24 soat)
        body('expiresInMinutes').optional({ values: 'falsy' }).isInt({ min: 1, max: 7 * 24 * 60 })
            .withMessage('Story muddati 1 daqiqadan 7 kungacha bo\'lishi kerak'),
    ],
    validate,
    controller.create
);

router.post('/:id/view', requireAuth, storyId, validate, controller.view);
router.post('/:id/like', requireAuth, storyId, validate, controller.like);
router.delete('/:id/like', requireAuth, storyId, validate, controller.unlike);
router.get('/:id/viewers', requireAuth, storyId, validate, controller.getViewers);
router.delete('/:id', requireAuth, storyId, validate, controller.remove);

router.post(
    '/:id/reply',
    requireAuth,
    [
        ...storyId,
        body('content').trim().notEmpty().withMessage('Xabar bo\'sh bo\'lmasin')
            .isLength({ max: 2000 }).withMessage('Xabar juda uzun'),
    ],
    validate,
    controller.reply
);

module.exports = router;
