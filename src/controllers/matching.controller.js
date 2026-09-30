const matchingService = require('../services/matching.service');
const usersService = require('../services/users.service');

function handleError(res, err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message || 'Server xatosi' });
}

// "a,b,c" -> ['a','b','c'] (bo'sh/berilmagan bo'lsa undefined)
function parseList(value) {
    if (!value) return undefined;
    return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

function parseNum(value) {
    if (value === undefined || value === '') return undefined;
    const n = Number(value);
    return Number.isNaN(n) ? undefined : n;
}

// GET /matching/candidates — swipe uchun navbatdagi kartalar (Search
// filters ekranidan kelgan ixtiyoriy so'rov parametrlari bilan).
async function getCandidates(req, res) {
    try {
        const q = req.query;
        const filters = {
            gender: q.gender || undefined,
            minAge: parseNum(q.minAge),
            maxAge: parseNum(q.maxAge),
            locationCity: q.locationCity || undefined,
            minHeight: parseNum(q.minHeight),
            maxHeight: parseNum(q.maxHeight),
            minWeight: parseNum(q.minWeight),
            maxWeight: parseNum(q.maxWeight),
            goals: parseList(q.goals),
            educationLevels: parseList(q.educationLevels),
            maritalStatuses: parseList(q.maritalStatuses),
            hasKids: parseList(q.hasKids),
            drinking: parseList(q.drinking),
            smoking: parseList(q.smoking),
            pets: parseList(q.pets),
            religion: parseList(q.religion),
            coreValues: parseList(q.coreValues),
            starSigns: parseList(q.starSigns),
            exercise: parseList(q.exercise),
            languages: parseList(q.languages),
            interests: parseList(q.interests),
        };
        const candidates = await matchingService.getCandidates(req.userId, { limit: q.limit, filters });
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

module.exports = { getCandidates, swipe, getMatches, getLikedUsers };
