-- 0006_account_deletion_and_pending_otp.sql
-- Support provider-safe OTP delivery and verified account-deletion requests.
-- Existing OTP records default to active (not pending), preserving login behavior.
ALTER TABLE otp_verifications
    ADD COLUMN IF NOT EXISTS is_pending BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS account_deletion_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    identifier_hash VARCHAR(64) NOT NULL,
    reason VARCHAR(1000),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'CANCELLED', 'COMPLETED')),
    requested_via VARCHAR(30) NOT NULL
        CHECK (requested_via IN ('signed_in', 'public_verified')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_deletion_pending_user
    ON account_deletion_requests(user_id)
    WHERE status = 'PENDING' AND user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_account_deletion_status_created
    ON account_deletion_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_deletion_identifier_hash
    ON account_deletion_requests(identifier_hash);
