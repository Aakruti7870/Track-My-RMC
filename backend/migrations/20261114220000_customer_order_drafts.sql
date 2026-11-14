-- Editable customer drafts are not operational orders or reservations.
CREATE TABLE customer_order_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    form JSONB NOT NULL CHECK (jsonb_typeof(form) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_customer_order_drafts_owner ON customer_order_drafts(customer_id, updated_at DESC);

-- A provisional request is nonbinding and cannot enter the order lifecycle.
CREATE TABLE customer_provisional_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    draft_id UUID REFERENCES customer_order_drafts(id) ON DELETE SET NULL,
    plant_id UUID NOT NULL REFERENCES rmc_plants(id),
    snapshot JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING_KYC' CHECK (status IN ('PENDING_KYC','CONVERTED')),
    plant_response TEXT,
    reminded_at TIMESTAMPTZ,
    order_id UUID UNIQUE REFERENCES orders(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(customer_id,draft_id)
);
CREATE INDEX idx_provisional_plant ON customer_provisional_requests(plant_id,created_at DESC);

-- Preserve legacy orders while binding all newly submitted customer orders
-- to a current KYC check at later commercial and fulfillment transitions.
ALTER TABLE orders ADD COLUMN kyc_guard_required BOOLEAN NOT NULL DEFAULT FALSE;

-- Bind each new consent attempt to the latest privileged decision visible at start.
ALTER TABLE customer_digilocker_sessions ADD COLUMN review_baseline_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE customer_digilocker_sessions ADD COLUMN failure_reason TEXT
    CHECK (failure_reason IS NULL OR failure_reason IN ('identity_mismatch'));
UPDATE customer_digilocker_sessions d
SET review_baseline_id=COALESCE((SELECT MAX(a.id) FROM audit_logs a
  WHERE a.resource_type='customer' AND a.resource_id=d.user_id::text
    AND a.action IN ('authority.kyc.review','control_center.kyc.review')
    AND a.created_at < d.created_at),0);
