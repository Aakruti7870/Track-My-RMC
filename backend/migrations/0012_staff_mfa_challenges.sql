-- Short-lived, single-use challenge issued only after staff email OTP verification.
-- Store only a SHA-256 digest of the opaque challenge token.
CREATE TABLE IF NOT EXISTS staff_mfa_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    purpose VARCHAR(24) NOT NULL CHECK (purpose IN ('login', 'enrollment')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_mfa_challenges_user_active
    ON staff_mfa_challenges(user_id, expires_at)
    WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_staff_mfa_challenges_expiry
    ON staff_mfa_challenges(expires_at);