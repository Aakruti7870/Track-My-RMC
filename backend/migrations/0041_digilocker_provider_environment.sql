-- Store the provider environment with each DigiLocker session to prevent
-- a previously granted test consent from being interpreted as live KYC.
-- Existing sessions, if any, were created in sandbox-only mode.
ALTER TABLE customer_digilocker_sessions
    ADD COLUMN provider_environment TEXT NOT NULL DEFAULT 'sandbox'
    CHECK (provider_environment IN ('sandbox', 'live'));

CREATE INDEX idx_customer_digilocker_environment_latest
    ON customer_digilocker_sessions(user_id, provider_environment, created_at DESC);
