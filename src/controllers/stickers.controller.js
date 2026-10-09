const stickersService = require('../services/stickers.service');
const gifSearchService = require('../services/gifSearch.service');
const { handleError, httpError } = require('../utils/http');
const { publicPath, removeUploadedFile } = require('../middlewares/upload.middleware');
const { normalizeMediaUrl, hasImageSignature } = require('../utils/externalMedia');

function assertImageFile(file) {
    if (!file) throw httpError('Fayl yuborilmadi', 400);
    if (!hasImageSignature(file.path, file.mimetype)) {
        throw httpError('Fayl buzilgan yoki rasm emas', 400);
    }
}

// GET /stickers/packs — panelga qo'shilgan to'plamlar (o'zimnikilar ham)
async function listPacks(req, res) {
    try {
        res.json({ packs: await stickersService.listInstalledPacks(req.userId) });
    } catch (err) {
        handleError(res, err);
    }
}

// GET /stickers/packs/:id — istalgan to'plam (chatda olingan stiker bosilganda)
async function getPack(req, res) {
    try {
        res.json({ pack: await stickersService.getPack(req.params.id, req.userId) });
    } catch (err) {
        handleError(res, err);
    }
}

// POST /stickers/packs — { title }
async function createPack(req, res) {
    try {
        res.status(201).json({ pack: await stickersService.createPack(req.userId, req.body.title) });
    } catch (err) {
        handleError(res, err);
    }
}

// PATCH /stickers/packs/:id — { title }
async function renamePack(req, res) {
    try {
        res.json({ pack: await stickersService.renamePack(req.params.id, req.userId, req.body.title) });
    } catch (err) {
        handleError(res, err);
    }
}

// DELETE /stickers/packs/:id
async function deletePack(req, res) {
    try {
        const orphaned = await stickersService.deletePack(req.params.id, req.userId);
        orphaned.forEach(removeUploadedFile);
        res.json({ success: true });
    } catch (err) {
        handleError(res, err);
    }
}

// POST /stickers/packs/:id/install
async function installPack(req, res) {
    try {
        res.json({ pack: await stickersService.installPack(req.params.id, req.userId) });
    } catch (err) {
        handleError(res, err);
    }
}

// DELETE /stickers/packs/:id/install
async function uninstallPack(req, res) {
    try {
        await stickersService.uninstallPack(req.params.id, req.userId);
        res.json({ success: true });
    } catch (err) {
        handleError(res, err);
    }
}

// POST /stickers/packs/:id/stickers — multipart: file (PNG/WEBP/GIF), emoji
async function addSticker(req, res) {
    try {
        assertImageFile(req.file);
        const sticker = await stickersService.addSticker(req.params.id, req.userId, {
            mediaUrl: publicPath(req.file.filename),
            isAnimated: req.file.mimetype === 'image/gif',
            emoji: req.body.emoji,
        });
        res.status(201).json({ sticker });
    } catch (err) {
        handleError(res, err);
    }
}

// DELETE /stickers/items/:id
async function deleteSticker(req, res) {
    try {
        removeUploadedFile(await stickersService.deleteSticker(req.params.id, req.userId));
        res.json({ success: true });
    } catch (err) {
        handleError(res, err);
    }
}

// GET /stickers/gifs — saqlangan va o'zim yasagan GIFlar
async function listGifs(req, res) {
    try {
        res.json({ gifs: await stickersService.listSavedGifs(req.userId) });
    } catch (err) {
        handleError(res, err);
    }
}

// POST /stickers/gifs — { url, previewUrl?, width?, height? } — tashqi
// manbadagi (yoki chatda olingan) GIFni saqlash
async function saveGif(req, res) {
    try {
        const url = normalizeMediaUrl(req.body.url);
        if (!url) throw httpError('Bu havolani saqlab bo\'lmaydi', 400);
        const previewUrl = req.body.previewUrl ? normalizeMediaUrl(req.body.previewUrl) : null;
        const gif = await stickersService.saveGif(req.userId, {
            url,
            previewUrl,
            width: req.body.width,
            height: req.body.height,
        });
        res.status(201).json({ gif });
    } catch (err) {
        handleError(res, err);
    }
}

// POST /stickers/gifs/upload — multipart: file (GIF), width, height —
// foydalanuvchining o'zi yasagan GIF
async function uploadGif(req, res) {
    try {
        assertImageFile(req.file);
        const url = publicPath(req.file.filename);
        const gif = await stickersService.saveGif(req.userId, {
            url,
            previewUrl: url,
            width: req.body.width ? parseInt(req.body.width, 10) : null,
            height: req.body.height ? parseInt(req.body.height, 10) : null,
            isOwn: true,
        });
        res.status(201).json({ gif });
    } catch (err) {
        handleError(res, err);
    }
}

// DELETE /stickers/gifs/:id
async function deleteGif(req, res) {
    try {
        removeUploadedFile(await stickersService.deleteSavedGif(req.params.id, req.userId));
        res.json({ success: true });
    } catch (err) {
        handleError(res, err);
    }
}

// GET /stickers/search?kind=gifs|stickers&q=&page=&lang=
async function search(req, res) {
    try {
        const result = await gifSearchService.search({
            kind: req.query.kind,
            q: req.query.q,
            page: req.query.page ? parseInt(req.query.page, 10) : 1,
            userId: req.userId,
            lang: req.query.lang,
        });
        res.json(result);
    } catch (err) {
        handleError(res, err);
    }
}

module.exports = {
    listPacks,
    getPack,
    createPack,
    renamePack,
    deletePack,
    installPack,
    uninstallPack,
    addSticker,
    deleteSticker,
    listGifs,
    saveGif,
    uploadGif,
    deleteGif,
    search,
};
