const messagingService = require('../services/messaging.service');
const { emitToParticipants } = require('../realtime/socket');

function handleError(res, err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message || 'Server xatosi' });
}

// GET /conversations — foydalanuvchining barcha suhbatlari
async function listConversations(req, res) {
    try {
        const conversations = await messagingService.listConversations(req.userId, {
            limit: req.query.limit,
        });
        res.json({ conversations });
    } catch (err) {
        handleError(res, err);
    }
}

// POST /conversations — { userId } bilan 1:1 suhbatni topadi yoki yaratadi
async function createConversation(req, res) {
    try {
        const conversation = await messagingService.getOrCreateDirectConversation(
            req.userId,
            req.body.userId
        );
        res.status(201).json({ conversation });
    } catch (err) {
        handleError(res, err);
    }
}

// GET /conversations/:id/messages — xabarlar tarixi
async function listMessages(req, res) {
    try {
        const messages = await messagingService.listMessages(req.params.id, req.userId, {
            limit: req.query.limit,
            cursor: req.query.cursor,
        });
        res.json({ messages });
    } catch (err) {
        handleError(res, err);
    }
}

// POST /conversations/:id/messages — REST orqali yuborish. Matnli xabar uchun
// Socket.io ulanmagan holatlar uchun zaxira yo'l; rasm/video xabar uchun esa
// bu — YAGONA yo'l (fayl multipart/form-data bilan keladi, "media" maydoni).
// GIF (masalan Giphy) uchun esa fayl yuklanmaydi — JSON body'da tayyor
// mediaUrl + type:'gif' keladi. Yuborilgan xabar boshqa ishtirokchiga
// socket orqali darhol yetkaziladi.
function toUrl(req, filename) {
    return `${req.protocol}://${req.get('host')}/uploads/${filename}`;
}

async function sendMessage(req, res) {
    try {
        const file = req.file;
        let mediaUrl, type;
        if (file) {
            mediaUrl = toUrl(req, file.filename);
            type = file.mimetype.startsWith('video/') ? 'video' : 'image';
        } else if (req.body.mediaUrl) {
            mediaUrl = req.body.mediaUrl;
            type = req.body.type === 'gif' ? 'gif' : 'image';
        }

        const message = await messagingService.sendMessage(
            req.params.id,
            req.userId,
            req.body.content,
            { mediaUrl, type, replyToId: req.body.replyToId || null }
        );
        const io = req.app.get('io');
        if (io) await emitToParticipants(io, req.params.id, 'message:new', message);
        res.status(201).json({ message });
    } catch (err) {
        handleError(res, err);
    }
}

// PATCH /conversations/:id/messages/:messageId — matnni tahrirlash
async function editMessage(req, res) {
    try {
        const message = await messagingService.editMessage(
            req.params.messageId,
            req.userId,
            req.body.content
        );
        const io = req.app.get('io');
        if (io) await emitToParticipants(io, message.conversation_id, 'message:edited', message);
        res.json({ message });
    } catch (err) {
        handleError(res, err);
    }
}

// DELETE /conversations/:id/messages/:messageId?forEveryone=true|false
async function deleteMessage(req, res) {
    try {
        if (req.query.forEveryone === 'true') {
            const message = await messagingService.deleteForEveryone(req.params.messageId, req.userId);
            const io = req.app.get('io');
            if (io) await emitToParticipants(io, message.conversation_id, 'message:deleted', message);
            return res.json({ message });
        }
        const result = await messagingService.deleteForMe(req.params.messageId, req.userId);
        res.json({ conversationId: result.conversationId });
    } catch (err) {
        handleError(res, err);
    }
}

// POST /conversations/:id/messages/:messageId/pin
async function pinMessage(req, res) {
    try {
        const message = await messagingService.setPinned(req.params.messageId, req.userId, true);
        const io = req.app.get('io');
        if (io) await emitToParticipants(io, message.conversation_id, 'message:pin_changed', message);
        res.json({ message });
    } catch (err) {
        handleError(res, err);
    }
}

// DELETE /conversations/:id/messages/:messageId/pin
async function unpinMessage(req, res) {
    try {
        const message = await messagingService.setPinned(req.params.messageId, req.userId, false);
        const io = req.app.get('io');
        if (io) await emitToParticipants(io, message.conversation_id, 'message:pin_changed', message);
        res.json({ message });
    } catch (err) {
        handleError(res, err);
    }
}

// GET /conversations/:id/pinned
async function getPinnedMessage(req, res) {
    try {
        const message = await messagingService.getPinnedMessage(req.params.id, req.userId);
        res.json({ message });
    } catch (err) {
        handleError(res, err);
    }
}

// POST /conversations/:id/messages/:messageId/forward — body { targetConversationId }
async function forwardMessage(req, res) {
    try {
        const message = await messagingService.forwardMessage(
            req.params.messageId,
            req.body.targetConversationId,
            req.userId
        );
        const io = req.app.get('io');
        if (io) await emitToParticipants(io, message.conversation_id, 'message:new', message);
        res.status(201).json({ message });
    } catch (err) {
        handleError(res, err);
    }
}

// POST /conversations/:id/read — barcha o'qilmagan xabarlarni "o'qildi" qilish
async function markRead(req, res) {
    try {
        const messageIds = await messagingService.markConversationRead(req.params.id, req.userId);
        if (messageIds.length > 0) {
            const io = req.app.get('io');
            if (io) {
                await emitToParticipants(io, req.params.id, 'message:read', {
                    conversationId: req.params.id,
                    messageIds,
                    readerId: req.userId,
                });
            }
        }
        res.json({ messageIds });
    } catch (err) {
        handleError(res, err);
    }
}

module.exports = {
    listConversations,
    createConversation,
    listMessages,
    sendMessage,
    editMessage,
    deleteMessage,
    pinMessage,
    unpinMessage,
    getPinnedMessage,
    forwardMessage,
    markRead,
};
