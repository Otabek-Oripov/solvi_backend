const storiesService = require('../services/stories.service');
const { emitToParticipants } = require('../realtime/socket');
const { handleError } = require('../utils/http');
const { publicPath, removeUploadedFile } = require('../middlewares/upload.middleware');

// POST /stories — multipart: "media" fayl (+ ixtiyoriy "thumbnail") YOKI
// "postId" (postni story'ga qo'shish); "overlays" — matn/emoji'lar (JSON).
async function create(req, res) {
    try {
        const mediaFile = req.files?.media?.[0];
        const thumbFile = req.files?.thumbnail?.[0];
        const upload = mediaFile
            ? {
                mediaUrl: publicPath(mediaFile.filename),
                mediaType: mediaFile.mimetype.startsWith('video/') ? 'video' : 'photo',
                thumbnailUrl: thumbFile ? publicPath(thumbFile.filename) : null,
            }
            : null;
        const story = await storiesService.createStory(req.userId, {
            upload,
            postId: req.body.postId || null,
            overlays: req.body.overlays,
            durationMs: req.body.durationMs,
        });
        res.status(201).json({ story });
    } catch (err) {
        handleError(res, err);
    }
}

// GET /stories/feed — Home'dagi avatarlar qatori uchun
async function getFeed(req, res) {
    try {
        const users = await storiesService.getStoryFeed(req.userId);
        res.json({ users });
    } catch (err) {
        handleError(res, err);
    }
}

// GET /stories/user/:id
async function getUserStories(req, res) {
    try {
        const stories = await storiesService.getUserStories(req.userId, req.params.id);
        res.json({ stories });
    } catch (err) {
        handleError(res, err);
    }
}

// POST /stories/:id/view
async function view(req, res) {
    try {
        res.json(await storiesService.markViewed(req.userId, req.params.id));
    } catch (err) {
        handleError(res, err);
    }
}

// POST|DELETE /stories/:id/like
function likeHandler(liked) {
    return async (req, res) => {
        try {
            res.json(await storiesService.setLike(req.userId, req.params.id, liked));
        } catch (err) {
            handleError(res, err);
        }
    };
}

// GET /stories/:id/viewers — faqat egasiga
async function getViewers(req, res) {
    try {
        const viewers = await storiesService.getViewers(req.userId, req.params.id);
        res.json({ viewers });
    } catch (err) {
        handleError(res, err);
    }
}

// DELETE /stories/:id — faqat egasi
async function remove(req, res) {
    try {
        const files = await storiesService.deleteStory(req.userId, req.params.id);
        files.forEach(removeUploadedFile);
        res.json({ success: true });
    } catch (err) {
        handleError(res, err);
    }
}

// POST /stories/:id/reply — { content } — egasiga chatda xabar (story
// kartochkasi bilan), socket orqali darhol yetadi.
async function reply(req, res) {
    try {
        const message = await storiesService.replyToStory(req.userId, req.params.id, req.body.content);
        const io = req.app.get('io');
        if (io) await emitToParticipants(io, message.conversation_id, 'message:new', message);
        res.status(201).json({ message });
    } catch (err) {
        handleError(res, err);
    }
}

module.exports = {
    create,
    getFeed,
    getUserStories,
    view,
    like: likeHandler(true),
    unlike: likeHandler(false),
    getViewers,
    remove,
    reply,
};
