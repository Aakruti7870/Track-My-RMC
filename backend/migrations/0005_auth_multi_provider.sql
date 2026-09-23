-- 0005_auth_multi_provider.sql
-- Multi-provider authentication: Secure OTP sessions (WhatsApp & Email), TOTP Authenticator, and WebAuthn Passkeys

CREATE TABLE IF NOT EXISTS otp_verifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    destination VARCHAR(255) NOT NULL, -- phone (E.164) or email
    channel VARCHAR(50) NOT NULL,       -- 'whatsapp' | 'email'
    purpose VARCHAR(50) NOT NULL,       -- 'login' | 'driver_login' | 'staff_login' | 'verify'
    hashed_otp VARCHAR(255) NOT NULL,
    salt VARCHAR(64) NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_lookup ON otp_verifications (destination, channel, purpose, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_otp_rate_limit ON otp_verifications (destination, created_at DESC);

CREATE TABLE IF NOT EXISTS user_totp_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    secret_key VARCHAR(255) NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    backup_codes TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_totp_user ON user_totp_credentials(user_id);

CREATE TABLE IF NOT EXISTS user_passkeys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id VARCHAR(255) NOT NULL UNIQUE,
    public_key TEXT NOT NULL,
    counter BIGINT NOT NULL DEFAULT 0,
    device_name VARCHAR(150),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_passkeys_user ON user_passkeys(user_id);
