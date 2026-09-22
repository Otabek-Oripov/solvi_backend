const { Server } = require('socket.io');
const pool = require('../config/db');
const { verifyAccessToken } = require('../utils/jwt');
const messagingService = require('../services/messaging.service');

// Bitta foydalanuvchi bir nechta qurilmadan (socket) ulangan bo'lishi mumkin —
// "online" holatini faqat ENG OXIRGI socket uzilganda "offline"ga o'zgartiramiz.
const userSockets = new Map(); // userId -> Set<socketId>

async function setUserStatus(userId, status) {
    await pool.query('UPDATE users SET status = $1 WHERE id = $2', [status, userId]);
}

// Har ishtirokchining SHAXSIY xonasiga yuboradi (ular chat ekranida bo'lsa
// ham, chat ro'yxatida tursa ham — har doim shu xonaga ulangan) — shu
// sababli ro'yxat ekrani ham qo'lda yangilanmasdan real-time o'zgaradi.
// (conversation:<id> xonasiga alohida yuborish shart emas — ishtirokchi
// bo'lsa, u har doim o'zining user:<id> xonasida ham bor.)
async function emitToParticipants(io, conversationId, event, payload) {
    const participantIds = await messagingService.listParticipantIds(conversationId);
    for (const id of participantIds) {
        io.to(`user:${id}`).emit(event, payload);
    }
}

function initSocket(httpServer) {
    const io = new Server(httpServer, {
        cors: { origin: process.env.CORS_ORIGIN || '*' },
    });

    io.use((socket, next) => {
        try {
            const token = socket.handshake.auth?.token;
            if (!token) throw new Error('Token topilmadi');
            const payload = verifyAccessToken(token);
            socket.userId = payload.userId;
            next();
        } catch {
            next(new Error('Token yaroqsiz yoki muddati o\'tgan'));
        }
    });

    io.on('connection', (socket) => {
        const userId = socket.userId;

        // Har bir foydalanuvchining shaxsiy xonasi — xabarlar shu xonaga
        // yuboriladi, shuning uchun foydalanuvchi chat ichida bo'lmasa ham
        // (masalan chat ro'yxatida tursa) yangi xabarni darhol oladi.
        socket.join(`user:${userId}`);

        if (!userSockets.has(userId)) userSockets.set(userId, new Set());
        const wasOffline = userSockets.get(userId).size === 0;
        userSockets.get(userId).add(socket.id);
        if (wasOffline) setUserStatus(userId, 'online').catch(() => {});

        // Foydalanuvchi ochgan suhbat ekraniga real-time xabarlarni olish uchun
        // shu suhbatning socket.io xonasiga qo'shiladi. Ruxsat serverda
        // tekshiriladi — clientning o'zi boshqa suhbat xabarlarini tinglay olmaydi.
        socket.on('conversation:join', async (conversationId, ack) => {
            try {
                if (!(await messagingService.isParticipant(conversationId, userId))) {
                    return ack?.({ error: 'Ruxsat yo\'q' });
                }
                socket.join(`conversation:${conversationId}`);
                ack?.({ ok: true });
            } catch (err) {
                ack?.({ error: err.message });
            }
        });

        socket.on('conversation:leave', (conversationId) => {
            socket.leave(`conversation:${conversationId}`);
        });

        socket.on('message:send', async ({ conversationId, content } = {}, ack) => {
            try {
                const message = await messagingService.sendMessage(conversationId, userId, content);
                await emitToParticipants(io, conversationId, 'message:new', message);
                ack?.({ message });
            } catch (err) {
                ack?.({ error: err.message });
            }
        });

        socket.on('message:read', async ({ conversationId } = {}, ack) => {
            try {
                const messageIds = await messagingService.markConversationRead(conversationId, userId);
                if (messageIds.length > 0) {
                    await emitToParticipants(io, conversationId, 'message:read', {
                        conversationId,
                        messageIds,
                        readerId: userId,
                    });
                }
                ack?.({ ok: true });
            } catch (err) {
                ack?.({ error: err.message });
            }
        });

        socket.on('disconnect', () => {
            const sockets = userSockets.get(userId);
            sockets?.delete(socket.id);
            if (sockets && sockets.size === 0) {
                userSockets.delete(userId);
                setUserStatus(userId, 'offline').catch(() => {});
            }
        });
    });

    return io;
}

module.exports = { initSocket, emitToParticipants };
