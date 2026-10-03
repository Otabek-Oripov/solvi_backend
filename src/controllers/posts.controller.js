const postsService = require('../services/posts.service');
const { handleError } = require('../utils/http');
const { publicPath } = require('../middlewares/upload.middleware');

// POST /posts — yangi video yoki rasm(lar) (carousel) yuklash.
// Yoki "video" (+ ixtiyoriy "thumbnail"), yoki "photos" (1-10 ta) kelishi kerak.
async function create(req, res) {
    try {
        const videoFile = req.files?.video?.[0];
        const thumbFile = req.files?.thumbnail?.[0];
        const photoFiles = req.files?.photos || [];

        let mediaItems;
        if (videoFile) {
            mediaItems = [
                {
                    mediaUrl: publicPath(videoFile.filename),
                    mediaType: 'video',
                    thumbnailUrl: thumbFile ? publicPath(thumbFile.filename) : null,
                    duration: req.body.duration ? parseInt(req.body.duration, 10) : null,
                },
            ];
        } else if (photoFiles.length > 0) {
            mediaItems = photoFiles.map((file) => ({
                mediaUrl: publicPath(file.filename),
                mediaType: 'photo',
            }));
        } else {
            throw Object.assign(new Error('Video yoki rasm(lar) topilmadi'), { status: 400 });
        }

        const post = await postsService.createPost(req.userId, {
            mediaItems,
            caption: req.body.caption,
        });

        res.status(201).json({ post });
    } catch (err) {
        handleError(res, err);
    }
}

// GET /posts/feed — lenta
async function getFeed(req, res) {
    try {
        const posts = await postsService.getFeed({
            limit: req.query.limit,
            cursor: req.query.cursor,
            viewerId: req.userId,
        });
        res.json({ posts });
    } catch (err) {
        handleError(res, err);
    }
}

// GET /posts/user/:id — bitta foydalanuvchining postlari (profil: Video/Rasm tablari)
async function getUserPosts(req, res) {
    try {
        const posts = await postsService.getUserPosts({
            userId: req.params.id,
            mediaType: req.query.mediaType,
            limit: req.query.limit,
            cursor: req.query.cursor,
            viewerId: req.userId,
        });
        res.json({ posts });
    } catch (err) {
        handleError(res, err);
    }
}

// POST /posts/:id/like
async function like(req, res) {
    try {
        const result = await postsService.likePost(req.userId, req.params.id);
        res.status(201).json(result);
    } catch (err) {
        handleError(res, err);
    }
}

// DELETE /posts/:id/like
async function unlike(req, res) {
    try {
        const result = await postsService.unlikePost(req.userId, req.params.id);
        res.json(result);
    } catch (err) {
        handleError(res, err);
    }
}

// POST /posts/:id/comments
async function addComment(req, res) {
    try {
        const comment = await postsService.addComment(
            req.userId,
            req.params.id,
            req.body.content,
            req.body.parentId || null
        );
        res.status(201).json({ comment });
    } catch (err) {
        handleError(res, err);
    }
}

// GET /posts/:id/comments?parentId= — parentId bilan: shu izohning javoblari
async function listComments(req, res) {
    try {
        const comments = await postsService.listComments(req.params.id, {
            limit: req.query.limit,
            cursor: req.query.cursor,
            parentId: req.query.parentId,
            viewerId: req.userId,
        });
        res.json({ comments });
    } catch (err) {
        handleError(res, err);
    }
}

// POST /posts/:id/comments/:commentId/like
async function likeComment(req, res) {
    try {
        const result = await postsService.setCommentLike(req.userId, req.params.id, req.params.commentId, true);
        res.json(result);
    } catch (err) {
        handleError(res, err);
    }
}

// DELETE /posts/:id/comments/:commentId/like
async function unlikeComment(req, res) {
    try {
        const result = await postsService.setCommentLike(req.userId, req.params.id, req.params.commentId, false);
        res.json(result);
    } catch (err) {
        handleError(res, err);
    }
}

module.exports = {
    create,
    getFeed,
    getUserPosts,
    like,
    unlike,
    addComment,
    listComments,
    likeComment,
    unlikeComment,
};
