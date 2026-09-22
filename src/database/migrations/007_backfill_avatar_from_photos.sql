-- =====================================================================
-- Bir martalik ma'lumot tuzatishi: alohida avatar tayinlanmagan, lekin
-- rasm(lar) yuklagan mavjud foydalanuvchilar uchun avatar_url'ni ularning
-- birinchi (position=0) profil rasmiga tenglashtiradi.
-- =====================================================================

UPDATE users u
SET avatar_url = sub.url
FROM (
    SELECT DISTINCT ON (user_id) user_id, url
    FROM user_photos
    ORDER BY user_id, position ASC
) sub
WHERE u.id = sub.user_id AND u.avatar_url IS NULL;
