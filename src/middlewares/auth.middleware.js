const { verifyAccessToken } = require('../utils/jwt');

// Bundan keyingi modullarda (masalan /posts, /messages) himoyalangan
// route'larni yozganda shu middleware'ni ishlatasiz: router.get('/feed', requireAuth, ...)
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token topilmadi' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const payload = verifyAccessToken(token);
        req.userId = payload.userId;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token yaroqsiz yoki muddati o\'tgan' });
    }
}

module.exports = { requireAuth };