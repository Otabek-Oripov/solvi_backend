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

// POST /conversations/:id/messages — REST orqali yuborish (Socket.io ulanmagan
// holatlar uchun zaxira yo'l; asosiy real-time yetkazish socket orqali bo'ladi,
// lekin bu yerdan yuborilgan xabar ham boshqa ishtirokchiga socket orqali
// darhol yetkaziladi).
async function sendMessage(req, res) {
    try {
        const message = await messagingService.sendMessage(
            req.params.id,
            req.userId,
            req.body.content
        );
        const io = req.app.get('io');
        if (io) await emitToParticipants(io, req.params.id, 'message:new', message);
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
    markRead,
};
