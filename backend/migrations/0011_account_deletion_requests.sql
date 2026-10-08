-- Account deletion requests are queued for reviewed completion; requests never hard-delete statutory records.
CREATE TABLE IF NOT EXISTS account_deletion_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Preserve the request/audit record if the user row is later removed.
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'CANCELLED', 'COMPLETED', 'REJECTED')),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_user_created
    ON account_deletion_requests(user_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_deletion_requests_one_pending_per_user
    ON account_deletion_requests(user_id)
    WHERE status = 'PENDING';
