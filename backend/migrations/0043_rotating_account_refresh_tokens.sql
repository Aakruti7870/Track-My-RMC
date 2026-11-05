-- One rotating refresh credential per account; never store plaintext credentials.
-- Migration is additive and leaves existing authenticated sessions untouched.
CREATE TABLE account_refresh_tokens (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token_id UUID NOT NULL UNIQUE,
    token_hash TEXT NOT NULL CHECK (length(token_hash) = 64),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    rotated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX idx_account_refresh_tokens_expiration ON account_refresh_tokens(expires_at);
