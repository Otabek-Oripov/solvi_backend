const matchingService = require('../services/matching.service');
const usersService = require('../services/users.service');

function handleError(res, err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message || 'Server xatosi' });
}

// GET /matching/candidates — swipe uchun navbatdagi kartalar
async function getCandidates(req, res) {
    try {
        const candidates = await matchingService.getCandidates(req.userId, { limit: req.query.limit });
        res.json({ candidates });
    } catch (err) {
        handleError(res, err);
    }
}

// POST /matching/swipe — like yoki pass
async function swipe(req, res) {
    try {
        const { targetId, action } = req.body;
        const result = await matchingService.swipe(req.userId, targetId, action);
        if (result.matched) {
            // Ikkinchi tomonga real-time "yangi match" xabari — u ham shu
            // zahoti "Matches" ro'yxatida ko'rishi uchun.
            const io = req.app.get('io');
            const me = await usersService.getPublicSummary(req.userId);
            io.to(`user:${targetId}`).emit('match:new', {
                matchId: result.matchId,
                conversationId: result.conversationId,
                user: me,
            });
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

module.exports = { getCandidates, swipe, getMatches };
