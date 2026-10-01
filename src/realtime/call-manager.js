const { randomUUID } = require('crypto');

const MAX_PARTICIPANTS = 4;
// Taklif qilingan kishi shu vaqt ichida javob bermasa — taklif o'zi bekor
// bo'ladi (aks holda qo'ng'iroq holati xotirada abadiy qolib ketardi).
const RING_TIMEOUT_MS = 45 * 1000;

// callId -> { id, conversationId, callerId, video,
//             participants: Map<userId, { status }>, ringTimers: Map<userId, Timeout> }
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
        ringTimers: new Map(),
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

function isInvited(call, userId) {
    return call.participants.get(userId)?.status === 'invited';
}

function clearRingTimer(call, userId) {
    const timer = call.ringTimers.get(userId);
    if (timer) clearTimeout(timer);
    call.ringTimers.delete(userId);
}

// `onTimeout` — RING_TIMEOUT_MS o'tgach, kishi hali ham javob bermagan
// bo'lsagina chaqiriladi.
function startRingTimer(call, userId, onTimeout) {
    clearRingTimer(call, userId);
    const timer = setTimeout(() => {
        call.ringTimers.delete(userId);
        if (calls.get(call.id) === call && isInvited(call, userId)) onTimeout();
    }, RING_TIMEOUT_MS);
    // Kutilayotgan qo'ng'iroq taymeri serverni yopilishdan ushlab turmasin.
    timer.unref();
    call.ringTimers.set(userId, timer);
}

function markJoined(call, userId) {
    const p = call.participants.get(userId);
    if (p) p.status = 'joined';
    clearRingTimer(call, userId);
}

function removeParticipant(call, userId) {
    call.participants.delete(userId);
    clearRingTimer(call, userId);
}

function removeCall(callId) {
    const call = calls.get(callId);
    if (call) {
        for (const timer of call.ringTimers.values()) clearTimeout(timer);
        call.ringTimers.clear();
    }
    calls.delete(callId);
}

function findActiveCallsForUser(userId) {
    return [...calls.values()].filter((c) => c.participants.has(userId));
}

module.exports = {
    MAX_PARTICIPANTS,
    RING_TIMEOUT_MS,
    createCall,
    createDirectCall,
    getCall,
    joinedParticipantIds,
    isInvited,
    startRingTimer,
    markJoined,
    removeParticipant,
    removeCall,
    findActiveCallsForUser,
};
