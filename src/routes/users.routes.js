const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const controller = require('../controllers/users.controller');
const { requireAuth } = require('../middlewares/auth.middleware');
const { uploadPhoto } = require('../middlewares/upload.middleware');

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

// Barcha /users endpointlari himoyalangan (token talab qiladi)
router.get(
    '/',
    requireAuth,
    [query('search').optional({ nullable: true }).isLength({ max: 100 })],
    validate,
    controller.listUsers
);

router.get('/me', requireAuth, controller.getMe);

router.patch(
    '/me',
    requireAuth,
    [
        body('username')
            .optional()
            .isLength({ min: 3, max: 30 }).withMessage('Username 3-30 belgi bo\'lishi kerak')
            .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username faqat harf, raqam va _ dan iborat bo\'lsin'),
        body('fullName').optional({ nullable: true }).isLength({ max: 150 }),
        body('bio').optional({ nullable: true }).isLength({ max: 500 }).withMessage('Bio 500 belgidan oshmasin'),
        body('gender').optional({ nullable: true }).isIn(['male', 'female', '']),
        body('avatarUrl').optional({ nullable: true }).isURL().withMessage('Avatar URL noto\'g\'ri'),
        body('goal').optional({ nullable: true }).isLength({ max: 50 }),
        body('work').optional({ nullable: true }).isLength({ max: 150 }),
        body('school').optional({ nullable: true }).isLength({ max: 150 }),
        body('locationCountry').optional({ nullable: true }).isLength({ max: 100 }),
        body('locationCity').optional({ nullable: true }).isLength({ max: 100 }),
        body('heightCm').optional({ nullable: true }).isInt({ min: 100, max: 250 }).withMessage('Bo\'y 100-250 sm oralig\'ida bo\'lishi kerak'),
        body('weightKg').optional({ nullable: true }).isInt({ min: 30, max: 300 }).withMessage('Vazn 30-300 kg oralig\'ida bo\'lishi kerak'),
        body('starSign').optional({ nullable: true }).isLength({ max: 20 }),
        body('exercise').optional({ nullable: true }).isLength({ max: 30 }),
        body('educationLevel').optional({ nullable: true }).isLength({ max: 50 }),
        body('maritalStatus').optional({ nullable: true }).isLength({ max: 30 }),
        body('hasKids').optional({ nullable: true }).isLength({ max: 30 }),
        body('drinking').optional({ nullable: true }).isLength({ max: 30 }),
        body('smoking').optional({ nullable: true }).isLength({ max: 30 }),
        body('pets').optional({ nullable: true }).isLength({ max: 50 }),
        body('religion').optional({ nullable: true }).isLength({ max: 50 }),
        body('coreValues').optional({ nullable: true }).isLength({ max: 50 }),
        body('interests').optional().isArray({ max: 20 }).withMessage('Ko\'pi bilan 20 ta qiziqish'),
        body('languagesKnown').optional().isArray({ max: 20 }).withMessage('Ko\'pi bilan 20 ta til'),
    ],
    validate,
    controller.updateMe
);

router.get('/me/photos', requireAuth, controller.listPhotos);

router.post(
    '/me/photos',
    requireAuth,
    uploadPhoto.single('photo'),
    controller.uploadPhoto
);

router.delete(
    '/me/photos/:photoId',
    requireAuth,
    [param('photoId').isUUID().withMessage('ID noto\'g\'ri')],
    validate,
    controller.deletePhoto
);

router.patch(
    '/me/photos/reorder',
    requireAuth,
    [body('photoIds').isArray({ min: 1 }).withMessage('photoIds ro\'yxati kerak')],
    validate,
    controller.reorderPhotos
);

router.get(
    '/:id',
    requireAuth,
    [param('id').isUUID().withMessage('ID noto\'g\'ri')],
    validate,
    controller.getById
);

router.post(
    '/:id/follow',
    requireAuth,
    [param('id').isUUID().withMessage('ID noto\'g\'ri')],
    validate,
    controller.follow
);

router.delete(
    '/:id/follow',
    requireAuth,
    [param('id').isUUID().withMessage('ID noto\'g\'ri')],
    validate,
    controller.unfollow
);

router.get(
    '/:id/following',
    requireAuth,
    [param('id').isUUID().withMessage('ID noto\'g\'ri')],
    validate,
    controller.listFollowing
);

router.get(
    '/:id/followers',
    requireAuth,
    [param('id').isUUID().withMessage('ID noto\'g\'ri')],
    validate,
    controller.listFollowers
);

module.exports = router;
