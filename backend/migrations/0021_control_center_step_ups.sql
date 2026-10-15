-- Session-bound, expiring authenticator step-up state for privileged Control Center mutations.
-- Never store bearer tokens or authenticator codes; only the SHA-256 token fingerprint.
-- New migration: do not modify checksummed migration 0017 or 0018.
CREATE TABLE IF NOT EXISTS control_center_step_ups (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, token_hash)
);

CREATE INDEX IF NOT EXISTS idx_control_center_step_ups_expiry
    ON control_center_step_ups (expires_at);
