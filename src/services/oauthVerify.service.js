const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

// Android -> Web client ID (serverClientId), iOS -> iOS client ID.
// Shuning uchun bir nechta ID vergul bilan beriladi.
const GOOGLE_CLIENT_IDS = (process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const FB_APP_ID = process.env.FACEBOOK_APP_ID;
const FB_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const FB_API = 'https://graph.facebook.com/v21.0';

const googleClient = new OAuth2Client();

function authError(message) {
    const err = new Error(message);
    err.status = 401;
    return err;
}

// ------------------------------------------------------------- Google
async function verifyGoogleToken(idToken) {
    if (GOOGLE_CLIENT_IDS.length === 0) {
        throw new Error('GOOGLE_CLIENT_IDS .env faylda sozlanmagan');
    }

    let payload;
    try {
        const ticket = await googleClient.verifyIdToken({
            idToken,
            audience: GOOGLE_CLIENT_IDS,
        });
        payload = ticket.getPayload();
    } catch (_) {
        throw authError('Google tokeni yaroqsiz');
    }

    if (!payload || !payload.sub) throw authError('Google tokeni yaroqsiz');
    if (payload.email && payload.email_verified === false) {
        throw authError('Google emaili tasdiqlanmagan');
    }

    return {
        providerUserId: payload.sub,
        email: payload.email ? payload.email.toLowerCase() : null,
        fullName: payload.name || null,
        avatarUrl: payload.picture || null,
    };
}

// ----------------------------------------------------------- Facebook
function appSecretProof(accessToken) {
    return crypto.createHmac('sha256', FB_APP_SECRET).update(accessToken).digest('hex');
}

async function fbGet(path, params) {
    const url = new URL(FB_API + path);
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }

    const res = await fetch(url);
    const json = await res.json().catch(() => ({}));

    if (!res.ok || json.error) {
        throw authError((json.error && json.error.message) || 'Facebook so\'rovi muvaffaqiyatsiz');
    }
    return json;
}

async function verifyFacebookToken(accessToken) {
    if (!FB_APP_ID || !FB_APP_SECRET) {
        throw new Error('FACEBOOK_APP_ID / FACEBOOK_APP_SECRET sozlanmagan');
    }

    // 1) Token haqiqatan ham BIZNING app uchun berilganini tekshiramiz.
    //    Busiz — boshqa ilovaning tokeni bilan ham kirib bo'lardi.
    const debug = await fbGet('/debug_token', {
        input_token: accessToken,
        access_token: FB_APP_ID + '|' + FB_APP_SECRET,
    });

    const data = debug.data || {};
    if (!data.is_valid || String(data.app_id) !== String(FB_APP_ID)) {
        throw authError('Facebook tokeni yaroqsiz');
    }

    // 2) Profil ma'lumotlari
    const me = await fbGet('/me', {
        fields: 'id,name,email,picture.type(large)',
        access_token: accessToken,
        appsecret_proof: appSecretProof(accessToken),
    });

    return {
        providerUserId: me.id,
        email: me.email ? me.email.toLowerCase() : null,
        fullName: me.name || null,
        avatarUrl: (me.picture && me.picture.data && me.picture.data.url) || null,
    };
}

module.exports = { verifyGoogleToken, verifyFacebookToken };
