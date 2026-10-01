// Xato bilan ishlash uchun umumiy yordamchilar — barcha controller'lar shu
// yerdagi handleError'dan foydalanadi (har birida alohida nusxa bo'lmasin).

// `code` — klient (Flutter) matnga qarab emas, shu kalit bo'yicha maxsus
// holatni aniqlashi uchun (masalan 'EMAIL_NOT_VERIFIED').
function httpError(message, status, code) {
    const err = new Error(message);
    err.status = status;
    if (code) err.appCode = code;
    return err;
}

// status berilmagan har qanday xato — kutilmagan (DB, kod xatosi va h.k.).
// Uning matni hech qachon klientga ketmaydi, faqat serverda loglanadi.
function handleError(res, err) {
    const status = err.status || 500;
    if (status >= 500) {
        console.error(err);
        return res.status(status).json({ error: 'Server xatosi' });
    }
    const body = { error: err.message || 'Xato' };
    if (err.appCode) body.code = err.appCode;
    res.status(status).json(body);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
    return typeof value === 'string' && UUID_RE.test(value);
}

module.exports = { httpError, handleError, isUuid };
