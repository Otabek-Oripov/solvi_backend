const express = require('express');
const { body, param, validationResult } = require('express-validator');
const controller = require('../controllers/messaging.controller');
const { requireAuth } = require('../middlewares/auth.middleware');
const { uploadChatMedia, cleanupUploadsOnError } = require('../middlewares/upload.middleware');
const messagingService = require('../services/messaging.service');
const { isUuid } = require('../utils/http');

const router = express.Router();

// Fayl (100 MB gacha) diskka yozilishidan OLDIN tekshiriladi: suhbatga
// aloqasi yo'q foydalanuvchi serverga fayl yuklay olmasligi kerak.
async function requireParticipant(req, res, next) {
    try {
        if (!isUuid(req.params.id)) return res.status(400).json({ error: 'ID noto\'g\'ri' });
        if (!(await messagingService.isParticipant(req.params.id, req.userId))) {
            return res.status(403).json({ error: 'Bu suhbatga kirish huquqingiz yo\'q' });
        }
        next();
    } catch (err) {
        next(err);
    }
}

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
    requireParticipant,
    cleanupUploadsOnError,
    uploadChatMedia,
    [
        param('id').isUUID().withMessage('ID noto\'g\'ri'),
        // Rasm/video xabarida content bo'sh bo'lishi mumkin (izoh ixtiyoriy) —
        // bo'sh-yoki-mediasiz holat xizmat qatlamida tekshiriladi.
        body('content').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }).withMessage('Xabar juda uzun'),
        // GIF kabi tashqi manbadan tayyor havola bilan yuborilganda (fayl yo'q).
        body('mediaUrl').optional({ values: 'falsy' }).isURL().withMessage('mediaUrl noto\'g\'ri'),
        body('type').optional({ values: 'falsy' }).isIn(['image', 'gif']).withMessage('type noto\'g\'ri'),
        body('replyToId').optional({ values: 'falsy' }).isUUID().withMessage('replyToId noto\'g\'ri'),
        // Bir nechta rasm birga tanlab yuborilganda — barchasiga bir xil
        // qiymat beriladi, shunda ular chatda bitta albom sifatida chiqadi.
        body('groupId').optional({ values: 'falsy' }).isString().isLength({ max: 100 }).withMessage('groupId noto\'g\'ri'),
        // Ovozli xabar — davomiylik (ms) va to'lqin shakli namunalari
        // (vergul bilan ajratilgan sonlar, "media" fayl yozib olish paytida
        // mijoz tomonidan hisoblanadi).
        body('durationMs').optional({ values: 'falsy' }).isInt({ min: 0 }).withMessage('durationMs noto\'g\'ri'),
        body('waveform').optional({ values: 'falsy' }).isString().isLength({ max: 2000 }).withMessage('waveform noto\'g\'ri'),
    ],
    validate,
    controller.sendMessage
);

router.patch(
    '/:id/messages/:messageId',
    requireAuth,
    [
        param('id').isUUID().withMessage('ID noto\'g\'ri'),
        param('messageId').isUUID().withMessage('messageId noto\'g\'ri'),
        body('content').trim().notEmpty().withMessage('Xabar bo\'sh bo\'lmasin').isLength({ max: 2000 }).withMessage('Xabar juda uzun'),
    ],
    validate,
    controller.editMessage
);

router.delete(
    '/:id/messages/:messageId',
    requireAuth,
    [
        param('id').isUUID().withMessage('ID noto\'g\'ri'),
        param('messageId').isUUID().withMessage('messageId noto\'g\'ri'),
    ],
    validate,
    controller.deleteMessage
);

router.post(
    '/:id/messages/:messageId/pin',
    requireAuth,
    [
        param('id').isUUID().withMessage('ID noto\'g\'ri'),
        param('messageId').isUUID().withMessage('messageId noto\'g\'ri'),
    ],
    validate,
    controller.pinMessage
);

router.delete(
    '/:id/messages/:messageId/pin',
    requireAuth,
    [
        param('id').isUUID().withMessage('ID noto\'g\'ri'),
        param('messageId').isUUID().withMessage('messageId noto\'g\'ri'),
    ],
    validate,
    controller.unpinMessage
);

router.get(
    '/:id/pinned',
    requireAuth,
    [param('id').isUUID().withMessage('ID noto\'g\'ri')],
    validate,
    controller.getPinnedMessage
);

router.post(
    '/:id/messages/:messageId/forward',
    requireAuth,
    [
        param('id').isUUID().withMessage('ID noto\'g\'ri'),
        param('messageId').isUUID().withMessage('messageId noto\'g\'ri'),
        body('targetConversationId').isUUID().withMessage('targetConversationId noto\'g\'ri'),
    ],
    validate,
    controller.forwardMessage
);

router.post(
    '/:id/read',
    requireAuth,
    [param('id').isUUID().withMessage('ID noto\'g\'ri')],
    validate,
    controller.markRead
);

module.exports = router;
