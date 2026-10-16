// Post sozlamalari: kim ko'ra oladi (visibility).
//  - public    — hamma;
//  - followers — muallif va uning kuzatuvchilari;
//  - private   — faqat muallif;
//  - custom    — muallif va u tanlagan odamlar (post_audience; tanlov
//                muallifning kuzatuvchilari va kuzatganlari orasidan).
const VISIBILITIES = ['public', 'followers', 'private', 'custom'];

// Bitta postga tanlanadigan odamlar soni chegarasi.
const MAX_AUDIENCE = 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// SQL sharti: `alias` posti `viewer` (SQL parametr, masalan '$1'; NULL
// bo'lishi mumkin) ga ko'rinadimi. Lenta, profil, bitta post, layk/izoh va
// hokazo — hammasida shu bitta qoida ishlatiladi.
function visibleToViewerSql(viewer = '$1', alias = 'p') {
    return `(${alias}.visibility = 'public'
             OR ${alias}.user_id = ${viewer}
             OR (${alias}.visibility = 'followers' AND EXISTS(
                 SELECT 1 FROM follows vf
                 WHERE vf.follower_id = ${viewer} AND vf.following_id = ${alias}.user_id))
             OR (${alias}.visibility = 'custom' AND EXISTS(
                 SELECT 1 FROM post_audience va
                 WHERE va.post_id = ${alias}.id AND va.user_id = ${viewer})))`;
}

// multipart (satr) yoki JSON (boolean) qiymatidan boolean; berilmasa undefined.
function parseBool(value) {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
}

// "Tanlash" ro'yxati: JSON massiv (tahrirlashda), multipart'da JSON satr
// ('["id1","id2"]') yoki vergul bilan ajratilgan satr. Berilmasa undefined;
// noto'g'ri bo'lsa — null (validator xato qaytaradi).
function parseAudience(value) {
    if (value === undefined || value === null || value === '') return undefined;
    let list = value;
    if (typeof value === 'string') {
        const text = value.trim();
        if (text.startsWith('[')) {
            try {
                list = JSON.parse(text);
            } catch {
                return null;
            }
        } else {
            list = text.split(',').map((s) => s.trim()).filter(Boolean);
        }
    }
    if (!Array.isArray(list) || list.length > MAX_AUDIENCE) return null;
    if (!list.every((id) => typeof id === 'string' && UUID_RE.test(id))) return null;
    return [...new Set(list.map((id) => id.toLowerCase()))];
}

module.exports = { VISIBILITIES, MAX_AUDIENCE, visibleToViewerSql, parseBool, parseAudience };
