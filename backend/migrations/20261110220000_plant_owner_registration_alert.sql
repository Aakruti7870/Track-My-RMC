-- Contact-only intake. Do not auto-create an Owner or geocode an address.
-- Full plant verification/approval remains the existing plant-onboarding flow.
CREATE SEQUENCE IF NOT EXISTS plant_owner_registration_seq START WITH 1 INCREMENT BY 1;
CREATE TABLE IF NOT EXISTS plant_owner_registration_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_number VARCHAR(32) NOT NULL UNIQUE
        DEFAULT ('TMRMC-REG-' || LPAD(nextval('plant_owner_registration_seq')::TEXT, 6, '0')),
    owner_name VARCHAR(120) NOT NULL,
    business_name VARCHAR(160) NOT NULL,
    business_address VARCHAR(500) NOT NULL,
    email VARCHAR(254) NOT NULL,
    whatsapp_number VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'CONTACTED', 'CLOSED')),
    alert_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (alert_status IN ('PENDING', 'SENDING', 'ACCEPTED', 'UNCERTAIN', 'FAILED')),
    alert_attempts INTEGER NOT NULL DEFAULT 0,
    alert_attempted_at TIMESTAMPTZ,
    alert_accepted_at TIMESTAMPTZ,
    alert_provider_id VARCHAR(200),
    alert_error VARCHAR(64),
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_reason VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_owner_registration_pending_email
    ON plant_owner_registration_requests(LOWER(email)) WHERE status = 'PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS uq_owner_registration_pending_whatsapp
    ON plant_owner_registration_requests(whatsapp_number) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_owner_registration_status
    ON plant_owner_registration_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_owner_registration_alert_pending
    ON plant_owner_registration_requests(created_at) WHERE alert_status = 'PENDING';
