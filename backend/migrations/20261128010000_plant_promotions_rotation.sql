-- Enquiry-based plant promotions with Super Admin custom visibility radius
-- and deterministic 2-minute cyclic top-listing rotation.

CREATE TABLE IF NOT EXISTS plant_promotion_enquiries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_radius_km INTEGER NOT NULL DEFAULT 30 CHECK (requested_radius_km BETWEEN 1 AND 250),
    preferred_duration_days INTEGER NOT NULL DEFAULT 30 CHECK (preferred_duration_days BETWEEN 1 AND 365),
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'CONTACTED', 'ACTIVATED', 'REJECTED')),
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    review_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plant_promotion_enquiries_plant_created
    ON plant_promotion_enquiries (plant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_plant_promotion_enquiries_status_created
    ON plant_promotion_enquiries (status, created_at DESC);

CREATE TABLE IF NOT EXISTS plant_promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plant_id UUID NOT NULL UNIQUE REFERENCES rmc_plants(id) ON DELETE CASCADE,
    enquiry_id UUID REFERENCES plant_promotion_enquiries(id) ON DELETE SET NULL,
    radius_km INTEGER NOT NULL DEFAULT 30 CHECK (radius_km BETWEEN 1 AND 250),
    status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'PAUSED', 'EXPIRED', 'REVOKED')),
    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ends_at TIMESTAMPTZ,
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    audit_reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plant_promotions_active_order
    ON plant_promotions (status, activated_at ASC, plant_id ASC);
