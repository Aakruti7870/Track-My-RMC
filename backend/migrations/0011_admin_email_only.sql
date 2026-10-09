-- Allow the primary administrator to authenticate by registered email without a phone number.
-- Existing non-admin users retain their phone values; no user records are rewritten.
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;

-- Preserve the uniqueness guarantee for any supplied phone number.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique_nonnull
    ON users (phone)
    WHERE phone IS NOT NULL;
