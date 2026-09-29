const { randomUUID } = require('crypto');

const MAX_PARTICIPANTS = 4;

// callId -> { id, conversationId, callerId, video, participants: Map<userId, { status }> }
const calls = new Map();

function createCall({ conversationId, callerId, calleeIds, video }) {
    const participants = new Map();
    participants.set(callerId, { status: 'joined' });
    for (const calleeId of calleeIds) participants.set(calleeId, { status: 'invited' });
    const call = {
        id: randomUUID(),
        conversationId,
        callerId,
        video: !!video,
        participants,
        createdAt: Date.now(),
    };
    calls.set(call.id, call);
    return call;
}

// Tasodifiy (random) juftlashtirish uchun — ikkala foydalanuvchi ham
// darhol "joined" holatida boshlanadi (taklif/qabul bosqichi yo'q).
function createDirectCall({ userAId, userBId, video }) {
    const call = createCall({ conversationId: null, callerId: userAId, calleeIds: [userBId], video });
    markJoined(call, userBId);
    return call;
}

function getCall(callId) {
    return calls.get(callId);
}

function joinedParticipantIds(call) {
    return [...call.participants.entries()]
        .filter(([, p]) => p.status === 'joined')
        .map(([id]) => id);
}

function markJoined(call, userId) {
    const p = call.participants.get(userId);
    if (p) p.status = 'joined';
}

function removeParticipant(call, userId) {
    call.participants.delete(userId);
}

function removeCall(callId) {
    calls.delete(callId);
}

function findActiveCallsForUser(userId) {
    return [...calls.values()].filter((c) => c.participants.has(userId));
}

module.exports = {
    MAX_PARTICIPANTS,
    createCall,
    createDirectCall,
    getCall,
    joinedParticipantIds,
    markJoined,
    removeParticipant,
    removeCall,
    findActiveCallsForUser,
};
