-- DigiLocker sessions are bound to the authenticated customer and never contain identity documents.
-- Pending migration: choose the next free version after checking all live and source migrations; never apply before approval. Do not run on production without approval.
CREATE TABLE IF NOT EXISTS customer_digilocker_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_session_id UUID UNIQUE,
    status TEXT NOT NULL DEFAULT 'STARTING'
        CHECK(status IN ('STARTING','IN_PROGRESS','PENDING','REJECTED','EXPIRED','FAILED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '65 minutes'),
    verified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_customer_digilocker_user_latest
    ON customer_digilocker_sessions(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_digilocker_single_active
    ON customer_digilocker_sessions(user_id) WHERE status IN ('STARTING','IN_PROGRESS');
