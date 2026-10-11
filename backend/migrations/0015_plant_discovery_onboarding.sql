-- 0015_plant_discovery_onboarding.sql
-- One PostgreSQL review queue for public plant onboarding and discovered places.
CREATE SEQUENCE IF NOT EXISTS plant_onboarding_request_seq START WITH 1 INCREMENT BY 1;

ALTER TABLE rmc_plants
    ADD COLUMN IF NOT EXISTS google_place_id VARCHAR(256);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rmc_plants_google_place_id
    ON rmc_plants(google_place_id)
    WHERE google_place_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS plant_listing_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_number VARCHAR(32) NOT NULL UNIQUE
        DEFAULT ('TMRMC-ONB-' || LPAD(nextval('plant_onboarding_request_seq')::TEXT, 6, '0')),
    source VARCHAR(40) NOT NULL DEFAULT 'self_onboarding'
        CHECK (source IN ('self_onboarding', 'google_places_authority_bulk')),
    google_place_id VARCHAR(256),
    name VARCHAR(160) NOT NULL,
    address VARCHAR(500) NOT NULL,
    city VARCHAR(100),
    taluka VARCHAR(100),
    district VARCHAR(100),
    state VARCHAR(100),
    lat DOUBLE PRECISION NOT NULL CHECK (lat >= -90 AND lat <= 90),
    lng DOUBLE PRECISION NOT NULL CHECK (lng >= -180 AND lng <= 180),
    contact_phone VARCHAR(20),
    google_maps_uri TEXT,
    business_status VARCHAR(50),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
    requested_role VARCHAR(50),
    claim_requested BOOLEAN NOT NULL DEFAULT FALSE,
    applicant_owner_name VARCHAR(120),
    applicant_email VARCHAR(254),
    applicant_mobile VARCHAR(32),
    plant_id UUID REFERENCES rmc_plants(id) ON DELETE SET NULL,
    reject_reason VARCHAR(500),
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    support_notification JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plant_listing_status_updated
    ON plant_listing_requests(status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_plant_listing_active_google_place
    ON plant_listing_requests(google_place_id)
    WHERE google_place_id IS NOT NULL AND status IN ('PENDING', 'APPROVED');

CREATE UNIQUE INDEX IF NOT EXISTS uq_plant_onboarding_pending_email
    ON plant_listing_requests(LOWER(applicant_email))
    WHERE source = 'self_onboarding'
      AND status = 'PENDING'
      AND applicant_email IS NOT NULL;
