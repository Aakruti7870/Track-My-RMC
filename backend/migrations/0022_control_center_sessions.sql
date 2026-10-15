-- No existing administrator is promoted or approved by this migration.
CREATE TABLE IF NOT EXISTS control_center_access (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    approved BOOLEAN NOT NULL DEFAULT FALSE,
    permissions TEXT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS control_center_sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    step_up_attempts INTEGER NOT NULL DEFAULT 0,
    step_up_window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_control_center_sessions_user ON control_center_sessions(user_id);
CREATE TABLE IF NOT EXISTS control_center_login_limits (
    identifier_hash CHAR(64) PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_totp_step BIGINT
);
