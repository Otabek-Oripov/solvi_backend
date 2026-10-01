const callManager = require('./call-manager');
const usersService = require('./../services/users.service');

// Omegle uslubidagi tasodifiy 1:1 video/audio chat — navbat xotirada
// saqlanadi (xuddi qo'ng'iroqlar kabi), juftlashtirilgach mavjud mesh
// WebRTC qo'ng'iroq infratuzilmasi (call-manager/call-socket) qayta
// ishlatiladi — signalizatsiya xuddi oddiy qo'ng'iroqdagidek `call:signal`
// orqali boradi, faqat "kim kimga qo'ng'iroq qildi" bosqichi yo'q.

// { userId, video, excludeUserId }
const queue = [];

function removeFromQueue(userId) {
    const idx = queue.findIndex((q) => q.userId === userId);
    if (idx !== -1) queue.splice(idx, 1);
}

function toPeerInfo(user) {
    if (!user) return null;
    return { id: user.id, username: user.username, fullName: user.full_name, avatarUrl: user.avatar_url };
}

function registerRandomChatHandlers(io, socket) {
    const userId = socket.userId;

    // excludeUserId — foydalanuvchi hozirgina ajralgan ("Keyingisi" bosilgan)
    // sherik. Usiz ikkalasi ham navbatga qaytgach, darhol yana bir-biriga
    // tushib qolardi.
    socket.on('random:join-queue', async ({ video, excludeUserId } = {}, ack) => {
        try {
            const isVideo = !!video;
            const exclude = typeof excludeUserId === 'string' ? excludeUserId : null;
            if (queue.some((q) => q.userId === userId)) {
                return ack?.({ ok: true, queued: true });
            }
            const matchIndex = queue.findIndex(
                (q) =>
                    q.video === isVideo &&
                    q.userId !== userId &&
                    q.userId !== exclude &&
                    q.excludeUserId !== userId
            );
            if (matchIndex === -1) {
                queue.push({ userId, video: isVideo, excludeUserId: exclude });
                return ack?.({ ok: true, queued: true });
            }
            const [partner] = queue.splice(matchIndex, 1);
            const call = callManager.createDirectCall({
                userAId: partner.userId,
                userBId: userId,
                video: isVideo,
            });
            const [myInfo, partnerInfo] = await Promise.all([
                usersService.getPublicSummary(userId),
                usersService.getPublicSummary(partner.userId),
            ]);
            // Navbatda oldin kutgan tomon — javob kutadi (offer yubormaydi),
            // hozir qo'shilgan tomon — offer yaratadi (glare bo'lmasligi uchun).
            io.to(`user:${partner.userId}`).emit('random:matched', {
                callId: call.id,
                peerId: userId,
                peer: toPeerInfo(myInfo),
                isOfferer: false,
                video: call.video,
            });
            ack?.({
                ok: true,
                matched: true,
                callId: call.id,
                peerId: partner.userId,
                peer: toPeerInfo(partnerInfo),
                isOfferer: true,
                video: call.video,
            });
        } catch (err) {
            console.error('[random] join-queue error:', err);
            ack?.({ error: 'Server xatosi' });
        }
    });

    socket.on('random:leave-queue', () => {
        removeFromQueue(userId);
    });
}

module.exports = { registerRandomChatHandlers, removeFromQueue };
