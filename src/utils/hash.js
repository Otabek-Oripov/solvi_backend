const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

async function hashPassword(password) {
    return bcrypt.hash(password, SALT_ROUNDS);
}

async function comparePassword(password, passwordHash) {
    return bcrypt.compare(password, passwordHash);
}

// Refresh token JWT emas — tasodifiy 64 baytli string.
function generateRandomToken() {
    return crypto.randomBytes(64).toString('hex');
}

// DB'ga faqat hash yoziladi: baza sizib chiqsa ham tokenlar ishlamaydi.
function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { hashPassword, comparePassword, generateRandomToken, hashToken };
