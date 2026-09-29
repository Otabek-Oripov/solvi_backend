const callManager = require('./call-manager');

// Omegle uslubidagi tasodifiy 1:1 video/audio chat — navbat xotirada
// saqlanadi (xuddi qo'ng'iroqlar kabi), juftlashtirilgach mavjud mesh
// WebRTC qo'ng'iroq infratuzilmasi (call-manager/call-socket) qayta
// ishlatiladi — signalizatsiya xuddi oddiy qo'ng'iroqdagidek `call:signal`
// orqali boradi, faqat "kim kimga qo'ng'iroq qildi" bosqichi yo'q.

// { userId, video, reportedPartnerIds: Set<string> }
const queue = [];

function removeFromQueue(userId) {
    const idx = queue.findIndex((q) => q.userId === userId);
    if (idx !== -1) queue.splice(idx, 1);
}

function registerRandomChatHandlers(io, socket) {
    const userId = socket.userId;

    socket.on('random:join-queue', ({ video } = {}, ack) => {
        try {
            const isVideo = !!video;
            if (queue.some((q) => q.userId === userId)) {
                return ack?.({ ok: true, queued: true });
            }
            const matchIndex = queue.findIndex((q) => q.video === isVideo && q.userId !== userId);
            if (matchIndex === -1) {
                queue.push({ userId, video: isVideo });
                return ack?.({ ok: true, queued: true });
            }
            const [partner] = queue.splice(matchIndex, 1);
            const call = callManager.createDirectCall({
                userAId: partner.userId,
                userBId: userId,
                video: isVideo,
            });
            // Navbatda oldin kutgan tomon — javob kutadi (offer yubormaydi),
            // hozir qo'shilgan tomon — offer yaratadi (glare bo'lmasligi uchun).
            io.to(`user:${partner.userId}`).emit('random:matched', {
                callId: call.id,
                peerId: userId,
                isOfferer: false,
                video: call.video,
            });
            ack?.({
                ok: true,
                matched: true,
                callId: call.id,
                peerId: partner.userId,
                isOfferer: true,
                video: call.video,
            });
        } catch (err) {
            ack?.({ error: err.message });
        }
    });

    socket.on('random:leave-queue', () => {
        removeFromQueue(userId);
    });
}

module.exports = { registerRandomChatHandlers, removeFromQueue };
