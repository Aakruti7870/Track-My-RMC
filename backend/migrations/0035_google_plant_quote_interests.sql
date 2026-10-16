-- Customer quotation interest for unregistered businesses discovered through Google Places.
-- Keep only the permanent Google Place ID: never copy Google Places names,
-- addresses, coordinates, reviews, phone numbers or map content into the DB.
-- This is NOT an RFQ to a supplier until that supplier is verified/onboarded.
CREATE TABLE IF NOT EXISTS google_plant_quote_interests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    google_place_id VARCHAR(256) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING_PARTNER'
        CHECK (status IN ('PENDING_PARTNER', 'MATCHED', 'CLOSED')),
    matched_plant_id UUID REFERENCES rmc_plants(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_google_quote_interest_customer_place UNIQUE (customer_id, google_place_id),
    CONSTRAINT ck_google_quote_interest_place_id CHECK (
        length(btrim(google_place_id)) BETWEEN 1 AND 256
    )
);
CREATE INDEX IF NOT EXISTS idx_google_quote_interest_status
    ON google_plant_quote_interests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_google_quote_interest_place_id
    ON google_plant_quote_interests(google_place_id);
