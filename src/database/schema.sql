-- =====================================================================
-- Solvi — auth moduli uchun schema (Otabekning original dizayni asosida)
-- Ishga tushirish:  npm run db:migrate   (bo'sh bazaga shu faylni o'rnatadi,
--                   mavjud bazaga esa yangi migratsiyalarni qo'llaydi)
--             yoki: pgAdmin -> File -> Open -> shu fayl -> Run (F5)
--
-- Bu fayl har doim JORIY to'liq sxemani aks ettiradi: yangi migratsiya
-- (src/database/migrations/) qo'shilganda shu fayl ham yangilanadi.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE,
    phone           VARCHAR(20) UNIQUE,
    password_hash   VARCHAR(255),           -- OAuth-only userlarda NULL bo'ladi
    username        VARCHAR(50) UNIQUE NOT NULL,
    full_name       VARCHAR(150),
    avatar_url      TEXT,
    bio             TEXT,
    birth_date      DATE,
    gender          VARCHAR(20),
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    is_verified     BOOLEAN DEFAULT FALSE,
    is_active       BOOLEAN DEFAULT TRUE,
    status          VARCHAR(20) DEFAULT 'offline',
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    -- Kengaytirilgan profil (swap/match card'i uchun) — barchasi ixtiyoriy
    goal                VARCHAR(50),
    work                VARCHAR(150),
    school              VARCHAR(150),
    location_country    VARCHAR(100),
    location_city       VARCHAR(100),
    height_cm           SMALLINT,
    weight_kg           SMALLINT,
    star_sign           VARCHAR(20),
    exercise            VARCHAR(30),
    education_level     VARCHAR(50),
    marital_status      VARCHAR(30),
    has_kids            VARCHAR(30),
    drinking            VARCHAR(30),
    smoking             VARCHAR(30),
    pets                VARCHAR(50),
    religion            VARCHAR(50),
    core_values         VARCHAR(50),
    interests           TEXT[] NOT NULL DEFAULT '{}',
    languages_known     TEXT[] NOT NULL DEFAULT '{}',

    CONSTRAINT chk_email_or_phone CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS auth_providers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider            VARCHAR(20) NOT NULL,       -- 'google' | 'facebook' | 'apple' | 'email'
    provider_user_id    VARCHAR(255) NOT NULL,      -- Google 'sub', Facebook 'id' va h.k.
    email_at_provider   VARCHAR(255),
    access_token        TEXT,
    refresh_token       TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uniq_provider_account UNIQUE (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash        VARCHAR(255) NOT NULL,   -- xom tokenni emas, SHA-256 hash saqlang
    device_info       VARCHAR(255),
    expires_at        TIMESTAMPTZ NOT NULL,
    revoked           BOOLEAN DEFAULT FALSE,
    replaced_by_hash  VARCHAR(255),            -- rotation zanjiri (o'g'irlikni aniqlash)
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS otp_codes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    phone_or_email  VARCHAR(255) NOT NULL,
    code_hash       VARCHAR(255) NOT NULL,
    purpose         VARCHAR(30) NOT NULL,    -- 'register' | 'login' | 'reset_password'
    expires_at      TIMESTAMPTZ NOT NULL,
    used            BOOLEAN DEFAULT FALSE,
    attempts        SMALLINT NOT NULL DEFAULT 0,  -- noto'g'ri urinishlar (max 5)
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Avatardan tashqari, profil kartasida ko'rsatiladigan qo'shimcha rasmlar
-- (max 9 dona, backend darajasida cheklanadi).
CREATE TABLE IF NOT EXISTS user_photos (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url        TEXT NOT NULL,
    position   SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Follow tizimi (SRS 2.2)
CREATE TABLE IF NOT EXISTS follows (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    follower_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uniq_follow UNIQUE (follower_id, following_id),
    CONSTRAINT chk_no_self_follow CHECK (follower_id <> following_id)
);

-- Reels/Posts moduli (SRS 2.3)
CREATE TABLE IF NOT EXISTS posts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_url       TEXT,
    media_type      VARCHAR(10) CHECK (media_type IN ('photo', 'video')),
    caption         TEXT,
    thumbnail_url   TEXT,
    duration        SMALLINT,
    views_count     INTEGER NOT NULL DEFAULT 0,
    likes_count     INTEGER NOT NULL DEFAULT 0,
    comments_count  INTEGER NOT NULL DEFAULT 0,
    reposts_count   INTEGER NOT NULL DEFAULT 0,
    -- post_tags qaysi qoidalar versiyasi bilan ajratilgani (0 — hali ajratilmagan)
    tags_version    SMALLINT NOT NULL DEFAULT 0,
    -- Sozlamalar: kim ko'ra oladi (hamma / kuzatuvchilar / faqat muallif),
    -- izohlar, layklar sonini yashirish, yuklab olishga ruxsat
    visibility       VARCHAR(10) NOT NULL DEFAULT 'public',
    comments_enabled BOOLEAN NOT NULL DEFAULT true,
    hide_like_count  BOOLEAN NOT NULL DEFAULT false,
    allow_downloads  BOOLEAN NOT NULL DEFAULT true,
    edited_at        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_posts_visibility CHECK (visibility IN ('public', 'followers', 'private'))
);

-- Postni (o'zinikini ham) o'z profiliga "repost" qilish (hammaga ochiq).
-- thought — repost qilgan odam avatari ustidagi qisqa fikr ("Add a thought").
CREATE TABLE IF NOT EXISTS reposts (
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    thought    VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (post_id, user_id)
);

-- Saqlangan (bookmark) postlar — faqat egasiga ko'rinadi
CREATE TABLE IF NOT EXISTS saved_posts (
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS likes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uniq_like UNIQUE (post_id, user_id)
);

-- Bitta postda bir nechta media (rasm/video) — carousel postlar uchun.
-- posts.media_url/media_type birinchi elementning nusxasi (tezkor ko'rsatish uchun).
CREATE TABLE IF NOT EXISTS post_media (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id       UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    media_url     TEXT NOT NULL,
    media_type    VARCHAR(10) NOT NULL CHECK (media_type IN ('photo', 'video')),
    thumbnail_url TEXT,
    duration      SMALLINT,
    position      SMALLINT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content    VARCHAR(500) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Javob qaysi izohga yozilgani (Instagram uslubida faqat BITTA daraja —
    -- javobga javob ham yuqori darajadagi izohga bog'lanadi).
    parent_id     UUID REFERENCES comments(id) ON DELETE CASCADE,
    likes_count   INTEGER NOT NULL DEFAULT 0,
    replies_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS comment_likes (
    comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (comment_id, user_id)
);

-- ------------------------------------------------ "Siz uchun" tavsiyalari
-- Post mavzulari: caption'dagi #hashtag'lar (og'irligi 1) va kalit so'zlar (0.4)
CREATE TABLE IF NOT EXISTS post_tags (
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tag     VARCHAR(50) NOT NULL,
    weight  REAL NOT NULL DEFAULT 1,

    PRIMARY KEY (post_id, tag)
);

-- Kim qaysi postni qancha ko'rgani (oxirigacha ko'rdimi, tez o'tkazib yubordimi)
CREATE TABLE IF NOT EXISTS post_views (
    post_id        UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    view_count     INTEGER NOT NULL DEFAULT 1,
    total_watch_ms BIGINT NOT NULL DEFAULT 0,
    max_progress   REAL NOT NULL DEFAULT 0,
    completed      BOOLEAN NOT NULL DEFAULT false,
    skipped        BOOLEAN NOT NULL DEFAULT false,
    first_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_viewed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (post_id, user_id)
);

-- Foydalanuvchining mavzu ('tag') va muallif ('author') bo'yicha qiziqish bali
-- (vaqt o'tishi bilan so'nadi — 14 kunda yarmi)
CREATE TABLE IF NOT EXISTS user_interests (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       VARCHAR(10) NOT NULL CHECK (kind IN ('tag', 'author')),
    key        TEXT NOT NULL,
    score      REAL NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, kind, key)
);

-- Bitta lenta sessiyasida allaqachon ko'rsatilgan postlar (2 kundan keyin tozalanadi)
CREATE TABLE IF NOT EXISTS feed_impressions (
    session_id UUID NOT NULL,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    served_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (session_id, post_id)
);

-- Story'lar (Instagram uslubida; odatda 24 soat yashaydi, joylashda
-- foydalanuvchi 1 daqiqadan 7 kungacha o'zi tanlashi mumkin — expires_at
-- shunda backend tomonidan yoziladi). source_post_id — story
-- postdan yaratilgan bo'lsa; owns_media — fayl shu story uchun yuklangan
-- (o'chirilganda fayl ham o'chadi). overlays — ustidagi matn/emoji'lar.
CREATE TABLE IF NOT EXISTS stories (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_url      TEXT NOT NULL,
    media_type     VARCHAR(10) NOT NULL CHECK (media_type IN ('photo', 'video')),
    thumbnail_url  TEXT,
    duration_ms    INTEGER,
    source_post_id UUID REFERENCES posts(id) ON DELETE SET NULL,
    owns_media     BOOLEAN NOT NULL DEFAULT false,
    overlays       JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at     TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

-- Story'ni kim ko'rgani va layk bosgani
CREATE TABLE IF NOT EXISTS story_views (
    story_id  UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    viewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    liked     BOOLEAN NOT NULL DEFAULT false,
    viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (story_id, viewer_id)
);

-- Stiker to'plamlari (Telegram uslubida). To'plam ochiq: kimdir chatda shu
-- to'plamdagi stikerni olsa, uni bosib butun to'plamni o'ziga qo'sha oladi.
CREATE TABLE IF NOT EXISTS sticker_packs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- To'plam ichidagi stikerlar: PNG/WEBP — oddiy, GIF — animatsion; emoji —
-- stikerning "ma'nosi" (chatda shu emoji yozilganda taklif qilinadi).
CREATE TABLE IF NOT EXISTS stickers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_id     UUID NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
    media_url   TEXT NOT NULL,
    is_animated BOOLEAN NOT NULL DEFAULT false,
    emoji       VARCHAR(16),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Foydalanuvchi o'z paneliga qo'shgan to'plamlar (o'zi yaratganlari ham)
CREATE TABLE IF NOT EXISTS user_sticker_packs (
    user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pack_id  UUID NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id, pack_id)
);

-- "Saqlangan GIFlar": tashqi manbadan (KLIPY/GIPHY) saqlanganlari va
-- foydalanuvchining o'zi yasaganlari (is_own — fayl bizning serverda).
CREATE TABLE IF NOT EXISTS saved_gifs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    preview_url TEXT,
    width       INTEGER,
    height      INTEGER,
    is_own      BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_saved_gifs_user_url UNIQUE (user_id, url)
);

-- direct_key — 1:1 suhbatda "<kichik user id>:<katta user id>". UNIQUE
-- bo'lgani uchun bir juftlik orasida faqat bitta suhbat bo'la oladi
-- (guruh suhbatlarida NULL).
CREATE TABLE IF NOT EXISTS conversations (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_group   BOOLEAN NOT NULL DEFAULT false,
    direct_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id         UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content                 TEXT NOT NULL,
    media_url               TEXT,
    type                    VARCHAR(10) NOT NULL DEFAULT 'text'
                            CONSTRAINT chk_messages_type CHECK (type IN ('text', 'image', 'video', 'voice', 'gif', 'post', 'sticker')),
    status                  VARCHAR(10) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read')),
    reply_to_id             UUID REFERENCES messages(id) ON DELETE SET NULL,
    is_pinned               BOOLEAN NOT NULL DEFAULT false,
    edited_at               TIMESTAMPTZ,
    deleted_for_everyone    BOOLEAN NOT NULL DEFAULT false,
    is_forwarded            BOOLEAN NOT NULL DEFAULT false,
    forwarded_from_username VARCHAR(50),
    group_id                TEXT,
    duration_ms             INTEGER,
    waveform                TEXT,
    -- type = 'post' — chatda do'stga yuborilgan post (post o'chirilsa NULL)
    shared_post_id          UUID REFERENCES posts(id) ON DELETE SET NULL,
    -- story'ga javob sifatida yozilgan xabar (story o'chsa NULL)
    story_id                UUID REFERENCES stories(id) ON DELETE SET NULL,
    -- type = 'sticker' — qaysi stiker yuborilgani (to'plamni ochish uchun;
    -- stiker o'chirilsa NULL, rasmi esa media_url'da qoladi)
    sticker_id              UUID REFERENCES stickers(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "O'zim uchun o'chirish" — faqat shu foydalanuvchining ro'yxatidan
-- yashiradi, xabarning o'zi (va boshqa ishtirokchi uchun) o'zgarmaydi.
CREATE TABLE IF NOT EXISTS message_deletions (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (message_id, user_id)
);

-- Xabarga emoji reaksiya — foydalanuvchi boshiga bitta emoji qo'ya oladi
-- (qayta bosilsa o'chadi, boshqasi tanlansa almashadi).
CREATE TABLE IF NOT EXISTS message_reactions (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (message_id, user_id)
);

-- Bumble-style swipe va match tizimi (SRS 2.6)
CREATE TABLE IF NOT EXISTS swipes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    swiper_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action     VARCHAR(10) NOT NULL CHECK (action IN ('like', 'pass')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uniq_swipe UNIQUE (swiper_id, target_id),
    CONSTRAINT chk_no_self_swipe CHECK (swiper_id <> target_id)
);

-- user_a_id har doim user_b_id'dan kichik (UUID taqqoslash bo'yicha) — shu
-- tufayli (A,B) va (B,A) uchun ikkita alohida qator hosil bo'lmaydi.
CREATE TABLE IF NOT EXISTS matches (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    matched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uniq_match UNIQUE (user_a_id, user_b_id),
    CONSTRAINT chk_match_order CHECK (user_a_id < user_b_id)
);

-- Tezkor qidiruv uchun indekslar
CREATE INDEX IF NOT EXISTS idx_auth_providers_user_id ON auth_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_otp_codes_phone_or_email ON otp_codes(phone_or_email);
CREATE INDEX IF NOT EXISTS idx_user_photos_user_id ON user_photos(user_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower  ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_likes_post_id ON likes(post_id);
CREATE INDEX IF NOT EXISTS idx_likes_user_id ON likes(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comment_likes_user ON comment_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_reposts_user ON reposts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_posts_user ON saved_posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stories_user_expires ON stories(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);
CREATE INDEX IF NOT EXISTS idx_story_views_viewer ON story_views(viewer_id);
CREATE INDEX IF NOT EXISTS idx_post_media_post_id ON post_media(post_id);
CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag);
CREATE INDEX IF NOT EXISTS idx_post_tags_tag_prefix ON post_tags(tag text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_post_views_user ON post_views(user_id, last_viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_interests_top ON user_interests(user_id, kind, score DESC);
CREATE INDEX IF NOT EXISTS idx_feed_impressions_served ON feed_impressions(served_at);
CREATE INDEX IF NOT EXISTS idx_posts_user_created ON posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sticker_packs_owner ON sticker_packs(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stickers_pack ON stickers(pack_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stickers_media_url ON stickers(media_url);
CREATE INDEX IF NOT EXISTS idx_user_sticker_packs_pack ON user_sticker_packs(pack_id);
CREATE INDEX IF NOT EXISTS idx_saved_gifs_user ON saved_gifs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_gifs_url ON saved_gifs(url);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON conversation_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created   ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_sender    ON messages(conversation_id, sender_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to    ON messages(reply_to_id);
CREATE INDEX IF NOT EXISTS idx_messages_pinned      ON messages(conversation_id, is_pinned) WHERE is_pinned = true;
CREATE INDEX IF NOT EXISTS idx_messages_group_id    ON messages(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_sticker     ON messages(sticker_id) WHERE sticker_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_media_url   ON messages(media_url) WHERE media_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_deletions_user ON message_deletions(user_id);
CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_swipes_swiper ON swipes(swiper_id);
CREATE INDEX IF NOT EXISTS idx_swipes_target ON swipes(target_id);
CREATE INDEX IF NOT EXISTS idx_matches_user_a ON matches(user_a_id);
CREATE INDEX IF NOT EXISTS idx_matches_user_b ON matches(user_b_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conversations_direct_key ON conversations(direct_key);

-- ---------------------------------------------------------- Triggerlar

-- users.updated_at — har yangilanishda avtomatik
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Ishtirokchi o'chirilganda (masalan user o'chirilishi bilan CASCADE orqali)
-- 1:1 suhbatning o'zi ham o'chiriladi — aks holda u ishtirokchisiz, hech
-- kim ko'rmaydigan holda qolib ketardi.
CREATE OR REPLACE FUNCTION delete_orphaned_conversation() RETURNS trigger AS $$
BEGIN
    DELETE FROM conversations c
    WHERE c.id = OLD.conversation_id
      AND (
          c.is_group = false
          OR NOT EXISTS (
              SELECT 1 FROM conversation_participants p WHERE p.conversation_id = c.id
          )
      );
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_conversation_participant_removed ON conversation_participants;
CREATE TRIGGER trg_conversation_participant_removed
    AFTER DELETE ON conversation_participants
    FOR EACH ROW EXECUTE FUNCTION delete_orphaned_conversation();
