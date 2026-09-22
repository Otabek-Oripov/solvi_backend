const express = require('express');
const { body, param, validationResult } = require('express-validator');
const controller = require('../controllers/messaging.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

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

router.get('/', requireAuth, controller.listConversations);

router.post(
    '/',
    requireAuth,
    [body('userId').isUUID().withMessage('userId noto\'g\'ri')],
    validate,
    controller.createConversation
);

router.get(
    '/:id/messages',
    requireAuth,
    [param('id').isUUID().withMessage('ID noto\'g\'ri')],
    validate,
    controller.listMessages
);

router.post(
    '/:id/messages',
    requireAuth,
    [
        param('id').isUUID().withMessage('ID noto\'g\'ri'),
        body('content').trim().notEmpty().withMessage('Xabar bo\'sh bo\'lmasin').isLength({ max: 2000 }).withMessage('Xabar juda uzun'),
    ],
    validate,
    controller.sendMessage
);

router.post(
    '/:id/read',
    requireAuth,
    [param('id').isUUID().withMessage('ID noto\'g\'ri')],
    validate,
    controller.markRead
);

module.exports = router;
