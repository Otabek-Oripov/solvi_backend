const express = require('express');
const { body, validationResult } = require('express-validator');
const controller = require('../controllers/auth.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

const router = express.Router();

function validate(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        // Flutter tomoni {error: "..."} kutadi — birinchi xabarni shunday qaytaramiz
        return res.status(400).json({
            error: errors.array()[0].msg,
            errors: errors.array(),
        });
    }
    next();
}

router.post(
    '/register',
    [
        body('email').isEmail().withMessage('Email noto\'g\'ri').normalizeEmail(),
        body('password')
            .isLength({ min: 8 }).withMessage('Parol kamida 8 belgidan iborat bo\'lishi kerak')
            .matches(/[0-9]/).withMessage('Parolda kamida bitta raqam bo\'lishi kerak'),
        body('username')
            .isLength({ min: 3, max: 30 }).withMessage('Username 3-30 belgi bo\'lishi kerak')
            .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username faqat harf, raqam va _ dan iborat bo\'lsin'),
        body('fullName').optional({ nullable: true }).isLength({ max: 100 }),
        body('birthDate').isISO8601().withMessage('Tug\'ilgan sana YYYY-MM-DD formatida bo\'lishi kerak'),
    ],
    validate,
    controller.register
);

router.post(
    '/login',
    [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
    validate,
    controller.login
);

router.post('/google', [body('idToken').notEmpty()], validate, controller.googleLogin);

router.post('/facebook', [body('accessToken').notEmpty()], validate, controller.facebookLogin);

router.post(
    '/verify-email',
    [
        body('email').isEmail().normalizeEmail(),
        body('code').isLength({ min: 6, max: 6 }).withMessage('Kod 6 xonali bo\'lishi kerak').isNumeric(),
    ],
    validate,
    controller.verifyEmail
);

router.post(
    '/resend-code',
    [body('email').isEmail().normalizeEmail()],
    validate,
    controller.resendCode
);

router.post('/refresh', [body('refreshToken').notEmpty()], validate, controller.refresh);

router.post('/logout', [body('refreshToken').notEmpty()], validate, controller.logout);

// Himoyalangan endpointlar
router.get('/me', requireAuth, controller.me);
router.post('/logout-all', requireAuth, controller.logoutAll);

module.exports = router;
