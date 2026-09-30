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

CREATE INDEX IF NOT EXISTS idx_swipes_swiper ON swipes(swiper_id);
CREATE INDEX IF NOT EXISTS idx_swipes_target ON swipes(target_id);
CREATE INDEX IF NOT EXISTS idx_matches_user_a ON matches(user_a_id);
CREATE INDEX IF NOT EXISTS idx_matches_user_b ON matches(user_b_id);
