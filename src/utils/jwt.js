const jwt = require('jsonwebtoken');

function generateAccessToken(userId) {
    return jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET, {
        expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
    });
}

function verifyAccessToken(token) {
    return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

// Refresh token o'zi JWT emas, tasodifiy string sifatida generatsiya qilinadi
// (auth.service.js ichida crypto.randomBytes bilan) va DB'da hash holida saqlanadi.
// Bu yerda faqat access token bilan ishlaymiz.

module.exports = { generateAccessToken, verifyAccessToken };