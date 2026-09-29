ALTER TABLE users
    ADD COLUMN IF NOT EXISTS auth_revoked_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_users_auth_revoked_at
    ON users (auth_revoked_at);

COMMENT ON COLUMN users.auth_revoked_at IS
    'Revokes all previously issued application JWTs when set; a token is valid only if iat is newer than this timestamp.';
