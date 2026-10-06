const crypto = require('crypto');
const postsService = require('../services/posts.service');
const { recordViews } = require('../services/recommendation.service');
const storiesService = require('../services/stories.service');
const { parseBool } = require('../utils/postVisibility');
const { emitToParticipants } = require('../realtime/socket');
const { handleError } = require('../utils/http');
const { publicPath } = require('../middlewares/upload.middleware');

// POST /posts — yangi video yoki rasm(lar) (carousel) yuklash.
// Yoki "video" (+ ixtiyoriy "thumbnail"), yoki "photos" (1-10 ta) kelishi kerak.
// Sozlamalar (ixtiyoriy): visibility, commentsEnabled, hideLikeCount,
// allowDownloads; shareToStory — post darhol story'ga ham qo'yiladi
// (faqat hammaga ochiq post).
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
            settings: {
                visibility: req.body.visibility,
                commentsEnabled: parseBool(req.body.commentsEnabled),
                hideLikeCount: parseBool(req.body.hideLikeCount),
                allowDownloads: parseBool(req.body.allowDownloads),
            },
        });

        // Story'ga ham — muvaffaqiyatsiz bo'lsa ham post joylangan bo'lib qoladi.
        let story = null;
        if (parseBool(req.body.shareToStory) && post.visibility === 'public') {
            story = await storiesService
                .createStory(req.userId, { postId: post.id, overlays: [] })
                .catch((err) => {
                    console.error('Postni story\'ga qo\'yib bo\'lmadi:', err.message);
                    return null;
                });
        }

        res.status(201).json({ post, story });
    } catch (err) {
        handleError(res, err);
    }
}

// GET /posts/feed?mode=for_you|following — lenta.
//  - for_you (standart): tavsiya lentasi; session — lenta ochilishi
//    identifikatori (berilmasa server yangisini yaratadi va javobda
//    qaytaradi). Keyingi sahifalar shu session bilan so'raladi — ko'rsatilgan
//    postlar takrorlanmaydi.
//  - following: faqat kuzatilayotganlar postlari, eng yangisidan (cursor).
async function getFeed(req, res) {
    try {
        if (req.query.mode === 'following') {
            const posts = await postsService.getFollowingFeed({
                viewerId: req.userId,
                limit: req.query.limit,
                cursor: req.query.cursor,
            });
            return res.json({ posts, mode: 'following' });
        }

        const session = req.query.session || crypto.randomUUID();
        const posts = await postsService.getForYouFeed({
            viewerId: req.userId,
            sessionId: session,
            limit: req.query.limit,
        });
        res.json({ posts, mode: 'for_you', session });
    } catch (err) {
        handleError(res, err);
    }
}

// POST /posts/views — { events: [{ postId, watchMs, durationMs?, progress?, source? }] }
// Ilova ko'rishlarni to'plab, guruh bilan yuboradi (tavsiya signallari va
// ko'rishlar soni shundan).
async function views(req, res) {
    try {
        res.json(await recordViews(req.userId, req.body.events));
    } catch (err) {
        handleError(res, err);
    }
}

// PATCH /posts/:id — caption va sozlamalarni o'zgartirish (faqat muallif)
async function update(req, res) {
    try {
        const post = await postsService.updatePost(req.userId, req.params.id, {
            caption: req.body.caption,
            visibility: req.body.visibility || undefined,
            commentsEnabled: parseBool(req.body.commentsEnabled),
            hideLikeCount: parseBool(req.body.hideLikeCount),
            allowDownloads: parseBool(req.body.allowDownloads),
        });
        res.json({ post });
    } catch (err) {
        handleError(res, err);
    }
}

// GET /posts/tags?q= — caption yozilayotganda heshteg takliflari
async function tags(req, res) {
    try {
        const rows = await postsService.suggestTags({ q: req.query.q, limit: req.query.limit });
        res.json({ tags: rows.map((r) => ({ tag: r.tag, postsCount: r.posts_count })) });
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
    views,
    update,
    tags,
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
