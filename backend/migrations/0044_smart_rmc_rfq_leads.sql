-- Smart RMC enquiries: retain customer-submitted data separately from Google Places content.
-- Google Place ID is the only Google listing value persisted for unapproved suppliers.
-- Verified plant RFQs continue to use customer_quotation_requests and plant_quotations.
CREATE TABLE IF NOT EXISTS rmc_rfq_leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_key UUID NOT NULL,
    google_place_id VARCHAR(256),
    plant_id UUID REFERENCES rmc_plants(id) ON DELETE SET NULL,
    canonical_request_id UUID UNIQUE REFERENCES customer_quotation_requests(id) ON DELETE SET NULL,
    customer_name VARCHAR(160) NOT NULL,
    customer_email VARCHAR(254),
    customer_gstin VARCHAR(15),
    grade VARCHAR(30) NOT NULL,
    quantity_m3 NUMERIC(10,2) NOT NULL CHECK (quantity_m3 > 0 AND quantity_m3 <= 10000),
    site_address TEXT NOT NULL,
    site_lat DOUBLE PRECISION,
    site_lng DOUBLE PRECISION,
    delivery_date DATE NOT NULL,
    pump_required BOOLEAN NOT NULL DEFAULT FALSE,
    site_contact_phone VARCHAR(20) NOT NULL,
    sharing_consent_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(40) NOT NULL CHECK (status IN (
        'PENDING_SUPPLIER','REQUESTED','MATCHED_RECONFIRMATION_REQUIRED','CLOSED'
    )),
    outreach_status VARCHAR(24) NOT NULL DEFAULT 'NOT_CONTACTED' CHECK (
        outreach_status IN ('NOT_CONTACTED','INVITATION_SHARED','CONTACTED','DECLINED')
    ),
    outreach_notes VARCHAR(1000),
    outreach_updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    outreach_updated_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT rmc_rfq_source_present CHECK (google_place_id IS NOT NULL OR plant_id IS NOT NULL),
    CONSTRAINT rmc_rfq_site_lat_pair CHECK ((site_lat IS NULL) = (site_lng IS NULL)),
    CONSTRAINT rmc_rfq_site_lat_range CHECK (site_lat IS NULL OR site_lat BETWEEN -90 AND 90),
    CONSTRAINT rmc_rfq_site_lng_range CHECK (site_lng IS NULL OR site_lng BETWEEN -180 AND 180),
    CONSTRAINT rmc_rfq_customer_key_unique UNIQUE(customer_id,request_key)
);

CREATE INDEX IF NOT EXISTS idx_rmc_rfq_leads_customer ON rmc_rfq_leads(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rmc_rfq_leads_admin ON rmc_rfq_leads(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rmc_rfq_leads_place ON rmc_rfq_leads(google_place_id) WHERE google_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rmc_rfq_leads_plant ON rmc_rfq_leads(plant_id, created_at DESC) WHERE plant_id IS NOT NULL;
