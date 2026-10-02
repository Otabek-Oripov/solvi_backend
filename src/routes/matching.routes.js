const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const controller = require('../controllers/matching.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

const router = express.Router();

function validate(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg, errors: errors.array() });
    }
    next();
}

router.get(
    '/candidates',
    requireAuth,
    [query('limit').optional().isInt({ min: 1, max: 50 })],
    validate,
    controller.getCandidates
);

router.get(
    '/candidates/:id',
    requireAuth,
    [param('id').isUUID().withMessage('ID noto\'g\'ri')],
    validate,
    controller.getCandidateById
);

router.post(
    '/swipe',
    requireAuth,
    [
        body('targetId').isUUID().withMessage('targetId noto\'g\'ri'),
        body('action').isIn(['like', 'pass']).withMessage('action \'like\' yoki \'pass\' bo\'lishi kerak'),
    ],
    validate,
    controller.swipe
);

router.get('/matches', requireAuth, controller.getMatches);
router.get('/likes', requireAuth, controller.getLikedUsers);
router.get('/liked-by', requireAuth, controller.getLikedByUsers);

module.exports = router;
