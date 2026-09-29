const callManager = require('./call-manager');
const messagingService = require('../services/messaging.service');
const usersService = require('../services/users.service');

// Audio/video qo'ng'iroqlar mesh (P2P) tarzida ishlaydi: server faqat SDP/ICE
// signalini ishtirokchilar orasida uzatadi, media to'g'ridan-to'g'ri
// qurilmalar orasida oqadi. Max 4 ishtirokchi (har biri qolgan 3 tasi bilan
// to'g'ridan-to'g'ri ulanadi) — shu hajmda mesh SFU serversiz yetarli.

function leaveCall(io, callId, userId) {
    const call = callManager.getCall(callId);
    if (!call) return;
    callManager.removeParticipant(call, userId);
    for (const [peerId] of call.participants) {
        io.to(`user:${peerId}`).emit('call:peer-left', { callId, userId });
    }
    if (call.participants.size <= 1) {
        for (const [peerId] of call.participants) {
            io.to(`user:${peerId}`).emit('call:ended', { callId });
        }
        callManager.removeCall(callId);
    }
}

function registerCallHandlers(io, socket) {
    const userId = socket.userId;

    socket.on('call:invite', async ({ conversationId, calleeIds, video } = {}, ack) => {
        try {
            if (!Array.isArray(calleeIds) || calleeIds.length === 0) {
                throw new Error('Kimga qo\'ng\'iroq qilishni tanlang');
            }
            if (calleeIds.length + 1 > callManager.MAX_PARTICIPANTS) {
                throw new Error(`Bir qo'ng'iroqqa max ${callManager.MAX_PARTICIPANTS} kishi qo'shilishi mumkin`);
            }
            if (!(await messagingService.isParticipant(conversationId, userId))) {
                throw new Error('Ruxsat yo\'q');
            }
            // Izoh: V1'da suhbatlar faqat 2 kishilik (is_group=false), shuning
            // uchun qo'ng'iroqqa qo'shiladigan har bir kishi shu SUHBATNING
            // ishtirokchisi bo'lishi shart emas — istalgan mavjud/faol
            // foydalanuvchini chaqirish mumkin (masalan "+" bilan guruh
            // qo'ng'irog'iga qo'shish uchun).
            for (const calleeId of calleeIds) {
                if (!(await usersService.userExists(calleeId))) {
                    throw new Error('Foydalanuvchi topilmadi');
                }
            }
            const call = callManager.createCall({ conversationId, callerId: userId, calleeIds, video });
            for (const calleeId of calleeIds) {
                io.to(`user:${calleeId}`).emit('call:incoming', {
                    callId: call.id,
                    conversationId,
                    callerId: userId,
                    video: call.video,
                });
            }
            ack?.({ callId: call.id });
        } catch (err) {
            ack?.({ error: err.message });
        }
    });

    // Mavjud qo'ng'iroqqa yana kimnidir taklif qilish ("+" tugmasi) — max 4 kishigacha.
    socket.on('call:invite-more', async ({ callId, calleeIds } = {}, ack) => {
        try {
            const call = callManager.getCall(callId);
            if (!call || !call.participants.has(userId)) throw new Error('Qo\'ng\'iroq topilmadi');
            if (!Array.isArray(calleeIds) || calleeIds.length === 0) {
                throw new Error('Kimni taklif qilishni tanlang');
            }
            if (call.participants.size + calleeIds.length > callManager.MAX_PARTICIPANTS) {
                throw new Error(`Bir qo'ng'iroqqa max ${callManager.MAX_PARTICIPANTS} kishi qo'shilishi mumkin`);
            }
            for (const calleeId of calleeIds) {
                if (!(await usersService.userExists(calleeId))) {
                    throw new Error('Foydalanuvchi topilmadi');
                }
                if (!call.participants.has(calleeId)) call.participants.set(calleeId, { status: 'invited' });
            }
            for (const calleeId of calleeIds) {
                io.to(`user:${calleeId}`).emit('call:incoming', {
                    callId,
                    conversationId: call.conversationId,
                    callerId: call.callerId,
                    video: call.video,
                });
            }
            ack?.({ ok: true });
        } catch (err) {
            ack?.({ error: err.message });
        }
    });

    socket.on('call:accept', ({ callId } = {}, ack) => {
        try {
            const call = callManager.getCall(callId);
            if (!call || !call.participants.has(userId)) throw new Error('Qo\'ng\'iroq topilmadi');

            // Yangi qo'shilgan ishtirokchi mavjud har bir kishi bilan OFFER
            // yaratadi — shu tartib bilan ikki tomon bir vaqtda offer
            // yubormaydi ("glare" bo'lmaydi).
            const existingPeers = callManager.joinedParticipantIds(call);
            callManager.markJoined(call, userId);

            for (const peerId of existingPeers) {
                io.to(`user:${peerId}`).emit('call:new-peer', { callId, userId });
            }
            ack?.({ ok: true, peers: existingPeers });
        } catch (err) {
            ack?.({ error: err.message });
        }
    });

    socket.on('call:reject', ({ callId } = {}) => {
        const call = callManager.getCall(callId);
        if (!call) return;
        for (const [peerId] of call.participants) {
            if (peerId !== userId) io.to(`user:${peerId}`).emit('call:rejected', { callId, userId });
        }
        // Rad etish — qo'ng'iroqdan "chiqib ketish" bilan bir xil: agar
        // shundan keyin 1 yoki 0 kishi qolsa, qolganiga call:ended yuborilib,
        // xotiradagi qo'ng'iroq holati tozalanadi.
        leaveCall(io, callId, userId);
    });

    socket.on('call:cancel', ({ callId } = {}) => {
        const call = callManager.getCall(callId);
        if (!call || call.callerId !== userId) return;
        for (const [peerId] of call.participants) {
            if (peerId !== userId) io.to(`user:${peerId}`).emit('call:cancelled', { callId });
        }
        callManager.removeCall(callId);
    });

    // SDP offer/answer va ICE candidate'larni ishtirokchilar orasida
    // to'g'ridan-to'g'ri (relay orqali) uzatish uchun umumiy kanal.
    socket.on('call:signal', ({ callId, toUserId, data } = {}) => {
        const call = callManager.getCall(callId);
        if (!call || !call.participants.has(userId) || !call.participants.has(toUserId)) return;
        io.to(`user:${toUserId}`).emit('call:signal', { callId, fromUserId: userId, data });
    });

    socket.on('call:leave', ({ callId } = {}) => {
        leaveCall(io, callId, userId);
    });
}

// Foydalanuvchining OXIRGI socket'i uzilganda (butunlay offline bo'lganda)
// chaqiriladi — ishtirok etayotgan barcha qo'ng'iroqlardan chiqib ketadi.
function handleUserFullyOffline(io, userId) {
    for (const call of callManager.findActiveCallsForUser(userId)) {
        leaveCall(io, call.id, userId);
    }
}

module.exports = { registerCallHandlers, handleUserFullyOffline };
