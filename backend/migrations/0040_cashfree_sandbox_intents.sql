-- Cashfree sandbox payment staging. Inert until explicit configuration and pricing approval.
-- Applies only when reviewed/merged; this PR never runs migration against production.
CREATE TABLE IF NOT EXISTS cashfree_sandbox_intents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    requester_id UUID NOT NULL REFERENCES users(id),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id),
    invoice_id UUID REFERENCES plant_invoices(id),
    kind VARCHAR(12) NOT NULL CHECK (kind IN ('PLAN','INVOICE')),
    sku VARCHAR(50),
    duration_days INTEGER,
    request_key VARCHAR(100) NOT NULL,
    gateway_order_id VARCHAR(100) NOT NULL UNIQUE,
    session_id TEXT,
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 1),
    currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency='INR'),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','VERIFIED','EXPIRED','REFUND_PENDING','REFUNDED','REVIEW_REQUIRED')),
    gateway_payment_id VARCHAR(100),
    verified_at TIMESTAMPTZ,
    fulfilled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT cashfree_intent_target CHECK (
        (kind='PLAN' AND invoice_id IS NULL AND sku IS NOT NULL AND duration_days IS NOT NULL)
        OR (kind='INVOICE' AND invoice_id IS NOT NULL AND sku IS NULL AND duration_days IS NULL)
    ),
    CONSTRAINT cashfree_idempotency UNIQUE (requester_id, request_key)
);
-- Prevent overlapping checkouts from charging the same invoice balance twice.
-- Reconciliation/retry must reuse the original intent until review or expiry is final.
CREATE UNIQUE INDEX IF NOT EXISTS cashfree_one_open_invoice_checkout
    ON cashfree_sandbox_intents(invoice_id)
    WHERE invoice_id IS NOT NULL
      AND status IN ('PENDING','VERIFIED','REFUND_PENDING','REVIEW_REQUIRED');
CREATE INDEX IF NOT EXISTS cashfree_intent_invoice_lookup ON cashfree_sandbox_intents(invoice_id);
CREATE INDEX IF NOT EXISTS cashfree_intent_plant_lookup ON cashfree_sandbox_intents(plant_id, status);
CREATE TABLE IF NOT EXISTS cashfree_approved_plan_prices (
    sku VARCHAR(50) PRIMARY KEY,
    duration_days INTEGER NOT NULL CHECK (duration_days > 0),
    price_inr NUMERIC(12,2) NOT NULL CHECK (price_inr >= 1),
    approved_by UUID NOT NULL REFERENCES users(id),
    approved_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE
);
-- Deliberately NO seed prices. Business owner must approve a catalog in a reviewed change.
CREATE TABLE IF NOT EXISTS cashfree_sandbox_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    intent_id UUID NOT NULL REFERENCES cashfree_sandbox_intents(id),
    event_digest VARCHAR(64) NOT NULL UNIQUE,
    event_kind VARCHAR(60) NOT NULL,
    provider_status VARCHAR(30) NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Refunds are tracked separately from original payment intents; never imply completion without provider verification.
CREATE TABLE IF NOT EXISTS cashfree_sandbox_refunds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    intent_id UUID NOT NULL REFERENCES cashfree_sandbox_intents(id),
    refund_key VARCHAR(100) NOT NULL UNIQUE,
    provider_refund_id VARCHAR(100),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    status VARCHAR(24) NOT NULL DEFAULT 'REVIEW_REQUIRED'
        CHECK (status IN ('REVIEW_REQUIRED','PENDING','SUCCESS','FAILED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
