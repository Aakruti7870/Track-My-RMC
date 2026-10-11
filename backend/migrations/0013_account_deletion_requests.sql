-- 0013_account_deletion_requests.sql
-- Record auditable deletion requests; never delete user or transaction data automatically.
CREATE TABLE IF NOT EXISTS account_deletion_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    identifier_hash CHAR(64) NOT NULL,
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'IN_REVIEW', 'COMPLETED', 'REJECTED', 'CANCELLED')),
    requested_via VARCHAR(24) NOT NULL
        CHECK (requested_via IN ('signed_in', 'public_verified')),
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    review_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_deletion_pending_user
    ON account_deletion_requests(user_id)
    WHERE status = 'PENDING' AND user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_account_deletion_status_created
    ON account_deletion_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_account_deletion_user_created
    ON account_deletion_requests(user_id, created_at DESC);
