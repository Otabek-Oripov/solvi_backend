const authService = require('../services/auth.service');
const usersService = require('../services/users.service');
const { verifyGoogleToken, verifyFacebookToken } = require('../services/oauthVerify.service');
const otpService = require('../services/otp.service');

function handleError(res, err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message || 'Server xatosi' });
}

async function register(req, res) {
    try {
        const { email, password, username, fullName, birthDate } = req.body;
        const user = await authService.registerWithEmail({
            email,
            password,
            username,
            fullName,
            birthDate,
        });

        // Foydalanuvchi yaratildi — endi tasdiqlash kodini yuboramiz.
        // Email yuborish muvaffaqiyatsiz bo'lsa ham userni yaratilgan holda
        // qoldiramiz — u "kodni qayta yuborish" orqali qayta urinishi mumkin.
        let emailSent = true;
        try {
            await otpService.sendOtp({ email: user.email, purpose: 'register', userId: user.id });
        } catch (err) {
            console.error('Tasdiqlash kodi yuborilmadi:', err.message);
            emailSent = false;
        }

        res.status(201).json({ user, emailSent });
    } catch (err) {
        handleError(res, err);
    }
}

async function login(req, res) {
    try {
        const { email, password } = req.body;
        const tokens = await authService.loginWithEmail({
            email,
            password,
            deviceInfo: req.headers['user-agent'],
        });
        res.json(tokens);
    } catch (err) {
        handleError(res, err);
    }
}

// Google va Facebook oqimi bir xil — faqat tekshiruvchi funksiya farq qiladi
function oauthHandler(provider, verifyFn) {
    return async (req, res) => {
        try {
            const token = provider === 'google' ? req.body.idToken : req.body.accessToken;
            const profile = await verifyFn(token);

            const tokens = await authService.findOrCreateOAuthUser({
                provider,
                providerUserId: profile.providerUserId,
                email: profile.email,
                fullName: profile.fullName,
                avatarUrl: profile.avatarUrl,
                deviceInfo: req.headers['user-agent'],
            });
            res.json(tokens);
        } catch (err) {
            handleError(res, err);
        }
    };
}

async function refresh(req, res) {
    try {
        const tokens = await authService.refreshAccessToken(
            req.body.refreshToken,
            req.headers['user-agent']
        );
        res.json(tokens);
    } catch (err) {
        handleError(res, err);
    }
}

async function logout(req, res) {
    try {
        await authService.revokeRefreshToken(req.body.refreshToken);
        res.json({ success: true });
    } catch (err) {
        handleError(res, err);
    }
}

// Barcha qurilmalardan chiqish
async function logoutAll(req, res) {
    try {
        await authService.revokeAllForUser(req.userId);
        res.json({ success: true });
    } catch (err) {
        handleError(res, err);
    }
}

// Flutter ilova ochilganda sessiya haqiqiyligini shu orqali tekshiradi
// usersService.getProfile — to'liq profil (kengaytirilgan maydonlar, rasmlar,
// followers/following/posts sonlari) qaytaradi. Ilova sessiyani tekshirganda
// (AuthCheckRequested) shu endpointdan foydalanadi, shuning uchun bu yerdagi
// ma'lumot ham to'liq bo'lishi kerak — aks holda son maydonlari 0 ko'rinadi.
async function me(req, res) {
    try {
        const user = await usersService.getProfile(req.userId, req.userId);
        res.json({ user });
    } catch (err) {
        handleError(res, err);
    }
}

async function verifyEmail(req, res) {
    try {
        const { email, code } = req.body;
        const tokens = await authService.verifyEmailCode({
            email,
            code,
            deviceInfo: req.headers['user-agent'],
        });
        res.json(tokens);
    } catch (err) {
        handleError(res, err);
    }
}

async function resendCode(req, res) {
    try {
        await authService.resendVerificationCode(req.body.email);
        res.json({ success: true });
    } catch (err) {
        handleError(res, err);
    }
}

module.exports = {
    register,
    login,
    googleLogin: oauthHandler('google', verifyGoogleToken),
    facebookLogin: oauthHandler('facebook', verifyFacebookToken),
    refresh,
    logout,
    logoutAll,
    me,
    verifyEmail,
    resendCode,
};
