const matchingService = require('../services/matching.service');
const usersService = require('../services/users.service');
const { handleError } = require('../utils/http');
const { parseMatchFilters } = require('../utils/filters');

// GET /matching/candidates — swipe uchun navbatdagi kartalar (Search
// filters ekranidan kelgan ixtiyoriy so'rov parametrlari bilan).
async function getCandidates(req, res) {
    try {
        const q = req.query;
        const filters = parseMatchFilters(q);
        const candidates = await matchingService.getCandidates(req.userId, { limit: q.limit, filters });
        res.json({ candidates });
    } catch (err) {
        handleError(res, err);
    }
}

// GET /matching/candidates/:id — bitta foydalanuvchini Bumpy kartasi
// shaklida olish (masalan xaritadagi avatarga bosilganda).
async function getCandidateById(req, res) {
    try {
        const candidate = await matchingService.getCandidateById(req.userId, req.params.id);
        res.json({ candidate });
    } catch (err) {
        handleError(res, err);
    }
}

// POST /matching/swipe — like yoki pass
async function swipe(req, res) {
    try {
        const { targetId, action } = req.body;
        const result = await matchingService.swipe(req.userId, targetId, action);
        const io = req.app.get('io');
        if (result.matched) {
            // Ikkinchi tomonga real-time "yangi match" xabari — u ham shu
            // zahoti "Matches" ro'yxatida ko'rishi uchun.
            const me = await usersService.getPublicSummary(req.userId);
            io.to(`user:${result.user.id}`).emit('match:new', {
                matchId: result.matchId,
                conversationId: result.conversationId,
                user: me,
            });
        } else if (action === 'like') {
            // Hali o'zaro moslik hosil bo'lmadi — ikkinchi tomonning "Liked
            // You" ro'yxati/nishoni darhol yangilanishi uchun xabar beramiz.
            const me = await usersService.getPublicSummary(req.userId);
            io.to(`user:${targetId}`).emit('like:received', { user: me });
        }
        res.json(result);
    } catch (err) {
        handleError(res, err);
    }
}

// GET /matching/matches — mavjud matchlar ro'yxati
async function getMatches(req, res) {
    try {
        const matches = await matchingService.getMatches(req.userId);
        res.json({ matches });
    } catch (err) {
        handleError(res, err);
    }
}

// GET /matching/likes — "Sevimlilar" (o'zim like qilganlar), profil
// sahifasida follow tugmalari bilan ko'rsatish uchun.
async function getLikedUsers(req, res) {
    try {
        const users = await matchingService.getLikedUsers(req.userId);
        res.json({ users });
    } catch (err) {
        handleError(res, err);
    }
}

// GET /matching/liked-by — meni like qilgan, hali javob bermagan
// foydalanuvchilar ("Liked You" bo'limi, to'g'ridan-to'g'ri like/pass bilan).
async function getLikedByUsers(req, res) {
    try {
        const candidates = await matchingService.getLikedByUsers(req.userId);
        res.json({ candidates });
    } catch (err) {
        handleError(res, err);
    }
}

module.exports = {
    getCandidates,
    getCandidateById,
    swipe,
    getMatches,
    getLikedUsers,
    getLikedByUsers,
};
