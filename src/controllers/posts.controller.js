const postsService = require('../services/posts.service');
const { emitToParticipants } = require('../realtime/socket');
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

// GET /posts/:id — bitta post (chatda yuborilgan postni ochganda)
async function getPost(req, res) {
    try {
        const post = await postsService.getPostById(req.params.id, req.userId);
        res.json({ post });
    } catch (err) {
        handleError(res, err);
    }
}

// GET /posts/user/:id/reposts — profil > Repostlar tabi
async function getUserReposts(req, res) {
    try {
        const posts = await postsService.getUserReposts({
            userId: req.params.id,
            limit: req.query.limit,
            cursor: req.query.cursor,
            viewerId: req.userId,
        });
        res.json({ posts });
    } catch (err) {
        handleError(res, err);
    }
}

// GET /posts/saved — o'zim saqlagan postlar
async function getSaved(req, res) {
    try {
        const posts = await postsService.getSavedPosts({
            viewerId: req.userId,
            limit: req.query.limit,
            cursor: req.query.cursor,
        });
        res.json({ posts });
    } catch (err) {
        handleError(res, err);
    }
}

// POST|DELETE /posts/:id/repost — POST body'da ixtiyoriy { thought }
// (repostga fikr; bo'sh satr — fikrni o'chirish).
function repostHandler(reposted) {
    return async (req, res) => {
        try {
            const thought = reposted ? req.body?.thought : undefined;
            res.json(await postsService.setRepost(req.userId, req.params.id, reposted, thought));
        } catch (err) {
            handleError(res, err);
        }
    };
}

// POST|DELETE /posts/:id/save
function saveHandler(saved) {
    return async (req, res) => {
        try {
            res.json(await postsService.setSaved(req.userId, req.params.id, saved));
        } catch (err) {
            handleError(res, err);
        }
    };
}

// POST /posts/:id/send — { userIds: [...], content? } — postni do'stlarga
// chat orqali yuborish; har bir xabar oluvchiga socket orqali darhol yetadi.
async function sendPost(req, res) {
    try {
        const messages = await postsService.sendPostToUsers(
            req.userId,
            req.params.id,
            req.body.userIds,
            req.body.content
        );
        const io = req.app.get('io');
        if (io) {
            for (const message of messages) {
                await emitToParticipants(io, message.conversation_id, 'message:new', message);
            }
        }
        res.status(201).json({ messages });
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
    getPost,
    getUserReposts,
    getSaved,
    repost: repostHandler(true),
    unrepost: repostHandler(false),
    save: saveHandler(true),
    unsave: saveHandler(false),
    sendPost,
    like,
    unlike,
    addComment,
    listComments,
    likeComment,
    unlikeComment,
};
