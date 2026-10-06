// Post sozlamalari: kim ko'ra oladi (visibility).
//  - public    — hamma;
//  - followers — muallif va uning kuzatuvchilari;
//  - private   — faqat muallif.
const VISIBILITIES = ['public', 'followers', 'private'];

// SQL sharti: `alias` posti `viewer` (SQL parametr, masalan '$1'; NULL
// bo'lishi mumkin) ga ko'rinadimi. Lenta, profil, bitta post, layk/izoh va
// hokazo — hammasida shu bitta qoida ishlatiladi.
function visibleToViewerSql(viewer = '$1', alias = 'p') {
    return `(${alias}.visibility = 'public'
             OR ${alias}.user_id = ${viewer}
             OR (${alias}.visibility = 'followers' AND EXISTS(
                 SELECT 1 FROM follows vf
                 WHERE vf.follower_id = ${viewer} AND vf.following_id = ${alias}.user_id)))`;
}

// multipart (satr) yoki JSON (boolean) qiymatidan boolean; berilmasa undefined.
function parseBool(value) {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    return !['false', '0', 'no', 'off'].includes(String(value).toLowerCase());
}

module.exports = { VISIBILITIES, visibleToViewerSql, parseBool };
