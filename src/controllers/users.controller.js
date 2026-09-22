const usersService = require('../services/users.service');

function handleError(res, err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message || 'Server xatosi' });
}

// GET /users/me — o'z profili
async function getMe(req, res) {
    try {
        const user = await usersService.getProfile(req.userId);
        res.json({ user });
    } catch (err) {
        handleError(res, err);
    }
}

// GET /users/:id — boshqa foydalanuvchi profili
async function getById(req, res) {
    try {
        const user = await usersService.getProfile(req.params.id, req.userId);
        res.json({ user });
    } catch (err) {
        handleError(res, err);
    }
}

// POST /users/:id/follow — foydalanuvchini kuzatishni boshlash
async function follow(req, res) {
    try {
        const user = await usersService.followUser(req.userId, req.params.id);
        res.status(201).json({ user });
    } catch (err) {
        handleError(res, err);
    }
}

// DELETE /users/:id/follow — kuzatishni bekor qilish
async function unfollow(req, res) {
    try {
        const user = await usersService.unfollowUser(req.userId, req.params.id);
        res.json({ user });
    } catch (err) {
        handleError(res, err);
    }
}

// GET /users — barcha foydalanuvchilar (qidiruv bilan)
async function listUsers(req, res) {
    try {
        const users = await usersService.listUsers({
            search: req.query.search,
            limit: req.query.limit,
            cursor: req.query.cursor,
            viewerId: req.userId,
        });
        res.json({ users });
    } catch (err) {
        handleError(res, err);
    }
}

// GET /users/:id/following — :id kuzatayotgan foydalanuvchilar
async function listFollowing(req, res) {
    try {
        const users = await usersService.listFollowing(req.params.id, {
            limit: req.query.limit,
            cursor: req.query.cursor,
            viewerId: req.userId,
        });
        res.json({ users });
    } catch (err) {
        handleError(res, err);
    }
}

// GET /users/:id/followers — :id'ni kuzatayotganlar
async function listFollowers(req, res) {
    try {
        const users = await usersService.listFollowers(req.params.id, {
            limit: req.query.limit,
            cursor: req.query.cursor,
            viewerId: req.userId,
        });
        res.json({ users });
    } catch (err) {
        handleError(res, err);
    }
}

// PATCH /users/me — o'z profilini tahrirlash (kengaytirilgan maydonlar bilan)
async function updateMe(req, res) {
    try {
        const user = await usersService.updateProfile(req.userId, req.body);
        res.json({ user });
    } catch (err) {
        handleError(res, err);
    }
}

// POST /users/me/photos — rasm yuklash (multer orqali diskka saqlanadi)
async function uploadPhoto(req, res) {
    try {
        if (!req.file) throw Object.assign(new Error('Fayl topilmadi'), { status: 400 });

        // Diskdagi faylni ochiq URL'ga aylantiramiz (statik serving orqali)
        const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        const photo = await usersService.addPhoto(req.userId, url);
        res.status(201).json({ photo });
    } catch (err) {
        handleError(res, err);
    }
}

async function listPhotos(req, res) {
    try {
        const photos = await usersService.listPhotos(req.userId);
        res.json({ photos });
    } catch (err) {
        handleError(res, err);
    }
}

async function deletePhoto(req, res) {
    try {
        await usersService.deletePhoto(req.userId, req.params.photoId);
        res.json({ success: true });
    } catch (err) {
        handleError(res, err);
    }
}

async function reorderPhotos(req, res) {
    try {
        const photos = await usersService.reorderPhotos(req.userId, req.body.photoIds || []);
        res.json({ photos });
    } catch (err) {
        handleError(res, err);
    }
}

module.exports = {
    getMe,
    getById,
    updateMe,
    uploadPhoto,
    listPhotos,
    deletePhoto,
    reorderPhotos,
    follow,
    unfollow,
    listUsers,
    listFollowing,
    listFollowers,
};
