const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const controller = require('../controllers/posts.controller');
const { requireAuth } = require('../middlewares/auth.middleware');
const { uploadPost } = require('../middlewares/upload.middleware');

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
    uploadPost,
    [
        body('caption').optional({ nullable: true }).isLength({ max: 500 }).withMessage('Caption 500 belgidan oshmasin'),
        body('duration').optional({ nullable: true }).isInt({ min: 0, max: 600 }).withMessage('Video davomiyligi noto\'g\'ri'),
    ],
    validate,
    controller.create
);

router.get('/feed', requireAuth, controller.getFeed);

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
    ],
    validate,
    controller.addComment
);

router.get(
    '/:id/comments',
    requireAuth,
    [param('id').isUUID().withMessage('ID noto\'g\'ri')],
    validate,
    controller.listComments
);

module.exports = router;
