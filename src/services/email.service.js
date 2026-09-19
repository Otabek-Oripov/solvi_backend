const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'Solvi <onboarding@resend.dev>';

// Umumiy email yuborish funksiyasi — Resend REST API orqali.
// Node 18+ ichida fetch tayyor, qo'shimcha paket kerak emas.
async function sendEmail({ to, subject, html }) {
    if (!RESEND_API_KEY) {
        throw new Error('RESEND_API_KEY .env faylda sozlanmagan');
    }

    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
    });

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error('Email yuborilmadi: ' + (body.message || res.statusText));
    }
}

module.exports = { sendEmail };
