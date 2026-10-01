const callManager = require('./call-manager');
const messagingService = require('../services/messaging.service');
const usersService = require('../services/users.service');
const { isUuid } = require('../utils/http');

// Audio/video qo'ng'iroqlar mesh (P2P) tarzida ishlaydi: server faqat SDP/ICE
// signalini ishtirokchilar orasida uzatadi, media to'g'ridan-to'g'ri
// qurilmalar orasida oqadi. Max 4 ishtirokchi (har biri qolgan 3 tasi bilan
// to'g'ridan-to'g'ri ulanadi) — shu hajmda mesh SFU serversiz yetarli.

// Bu yerdagi xatolar — foydalanuvchiga ko'rsatiladigan tayyor matnlar.
function callError(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

function ackError(err) {
    if (err.status && err.status < 500) return err.message;
    console.error('[call]', err);
    return 'Server xatosi';
}

function leaveCall(io, callId, userId) {
    const call = callManager.getCall(callId);
    if (!call || !call.participants.has(userId)) return;
    callManager.removeParticipant(call, userId);
    for (const [peerId] of call.participants) {
        io.to(`user:${peerId}`).emit('call:peer-left', { callId, userId });
    }

    // Qo'ng'iroqda hech kim qolmagan bo'lsa (faqat hali javob bermagan
    // taklif qilinganlar qolgan) — ularning "jiringlayotgan" ekrani
    // yopilishi kerak, qo'ng'iroq esa tugaydi.
    if (callManager.joinedParticipantIds(call).length === 0) {
        for (const [peerId] of call.participants) {
            io.to(`user:${peerId}`).emit('call:cancelled', { callId });
        }
        callManager.removeCall(callId);
        return;
    }

    if (call.participants.size <= 1) {
        for (const [peerId] of call.participants) {
            io.to(`user:${peerId}`).emit('call:ended', { callId });
        }
        callManager.removeCall(callId);
    }
}

// Taklif qilingan kishi RING_TIMEOUT_MS ichida javob bermadi.
function handleNoAnswer(io, callId, userId) {
    const call = callManager.getCall(callId);
    if (!call || !callManager.isInvited(call, userId)) return;
    io.to(`user:${userId}`).emit('call:cancelled', { callId });
    for (const [peerId] of call.participants) {
        if (peerId !== userId) {
            io.to(`user:${peerId}`).emit('call:rejected', { callId, userId, reason: 'no-answer' });
        }
    }
    leaveCall(io, callId, userId);
}

function ringCallee(io, call, calleeId) {
    io.to(`user:${calleeId}`).emit('call:incoming', {
        callId: call.id,
        conversationId: call.conversationId,
        callerId: call.callerId,
        video: call.video,
    });
    callManager.startRingTimer(call, calleeId, () => handleNoAnswer(io, call.id, calleeId));
}

function parseCalleeIds(calleeIds, emptyMessage) {
    if (!Array.isArray(calleeIds) || calleeIds.length === 0) throw callError(emptyMessage);
    if (!calleeIds.every(isUuid)) throw callError('Foydalanuvchi topilmadi');
    return [...new Set(calleeIds.map((id) => id.toLowerCase()))];
}

function registerCallHandlers(io, socket) {
    const userId = socket.userId;

    socket.on('call:invite', async ({ conversationId, calleeIds, video } = {}, ack) => {
        try {
            const ids = parseCalleeIds(calleeIds, 'Kimga qo\'ng\'iroq qilishni tanlang').filter(
                (id) => id !== userId
            );
            if (ids.length === 0) throw callError('Kimga qo\'ng\'iroq qilishni tanlang');
            if (ids.length + 1 > callManager.MAX_PARTICIPANTS) {
                throw callError(`Bir qo'ng'iroqqa max ${callManager.MAX_PARTICIPANTS} kishi qo'shilishi mumkin`);
            }
            if (!isUuid(conversationId)) throw callError('Ruxsat yo\'q');

            // Qo'ng'iroq shu SUHBAT ichidan boshlanadi — faqat shu suhbat
            // ishtirokchilarini chaqirish mumkin. Aks holda istalgan odam
            // o'ziga notanish har qanday foydalanuvchiga qo'ng'iroq qila olardi.
            const participantIds = await messagingService.listParticipantIds(conversationId);
            if (!participantIds.includes(userId)) throw callError('Ruxsat yo\'q');
            if (!ids.every((id) => participantIds.includes(id))) {
                throw callError('Faqat shu suhbat ishtirokchisiga qo\'ng\'iroq qilish mumkin');
            }

            const call = callManager.createCall({ conversationId, callerId: userId, calleeIds: ids, video });
            for (const calleeId of ids) ringCallee(io, call, calleeId);
            ack?.({ callId: call.id });
        } catch (err) {
            ack?.({ error: ackError(err) });
        }
    });

    // Mavjud qo'ng'iroqqa yana kimnidir taklif qilish ("+" tugmasi) — max 4
    // kishigacha. Bu yerda suhbat ishtirokchisi bo'lish shart emas (V1'da
    // suhbatlar faqat 2 kishilik) — istalgan faol foydalanuvchini guruh
    // qo'ng'irog'iga qo'shish mumkin, lekin faqat qo'ng'iroqqa allaqachon
    // QO'SHILGAN kishi taklif qila oladi.
    socket.on('call:invite-more', async ({ callId, calleeIds } = {}, ack) => {
        try {
            const call = callManager.getCall(callId);
            if (!call || call.participants.get(userId)?.status !== 'joined') {
                throw callError('Qo\'ng\'iroq topilmadi');
            }
            const ids = parseCalleeIds(calleeIds, 'Kimni taklif qilishni tanlang').filter(
                (id) => !call.participants.has(id)
            );
            if (ids.length === 0) throw callError('Bu foydalanuvchi allaqachon qo\'ng\'iroqda');
            if (call.participants.size + ids.length > callManager.MAX_PARTICIPANTS) {
                throw callError(`Bir qo'ng'iroqqa max ${callManager.MAX_PARTICIPANTS} kishi qo'shilishi mumkin`);
            }
            for (const calleeId of ids) {
                if (!(await usersService.userExists(calleeId))) throw callError('Foydalanuvchi topilmadi');
            }
            // Yuqoridagi await'lar davomida qo'ng'iroq tugab qolgan bo'lishi mumkin
            if (callManager.getCall(callId) !== call) throw callError('Qo\'ng\'iroq topilmadi');

            for (const calleeId of ids) {
                call.participants.set(calleeId, { status: 'invited' });
                ringCallee(io, call, calleeId);
            }
            ack?.({ ok: true });
        } catch (err) {
            ack?.({ error: ackError(err) });
        }
    });

    socket.on('call:accept', ({ callId } = {}, ack) => {
        try {
            const call = callManager.getCall(callId);
            if (!call || !call.participants.has(userId)) throw callError('Qo\'ng\'iroq topilmadi');

            // Yangi qo'shilgan ishtirokchi mavjud har bir kishi bilan OFFER
            // yaratadi — shu tartib bilan ikki tomon bir vaqtda offer
            // yubormaydi ("glare" bo'lmaydi).
            const existingPeers = callManager.joinedParticipantIds(call).filter((id) => id !== userId);
            callManager.markJoined(call, userId);

            for (const peerId of existingPeers) {
                io.to(`user:${peerId}`).emit('call:new-peer', { callId, userId });
            }
            ack?.({ ok: true, peers: existingPeers });
        } catch (err) {
            ack?.({ error: ackError(err) });
        }
    });

    socket.on('call:reject', ({ callId } = {}) => {
        const call = callManager.getCall(callId);
        if (!call || !call.participants.has(userId)) return;
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

    // Qo'ng'iroq davomidagi matnli xabar (masalan tasodifiy chatda) — shu
    // qo'ng'iroqning boshqa ishtirokchilariga relay qilinadi, saqlanmaydi.
    socket.on('call:message', ({ callId, text } = {}) => {
        const call = callManager.getCall(callId);
        if (!call || !call.participants.has(userId)) return;
        const trimmed = typeof text === 'string' ? text.trim().slice(0, 1000) : '';
        if (!trimmed) return;
        for (const [peerId] of call.participants) {
            if (peerId !== userId) {
                io.to(`user:${peerId}`).emit('call:message', {
                    callId,
                    fromUserId: userId,
                    text: trimmed,
                    at: Date.now(),
                });
            }
        }
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
