-- Cashfree sandbox-only customer RMC prepaid intent and physical-supplier split evidence.
-- This migration creates no payments or vendors. Provider/financial operations remain disabled.
-- Requires review of the proposed 20261106010000_order_payment_offers.sql predecessor.
CREATE TABLE plant_cashfree_vendor_accounts (
    plant_id UUID PRIMARY KEY REFERENCES rmc_plants(id) ON DELETE RESTRICT,
    cashfree_vendor_id VARCHAR(100) NOT NULL UNIQUE
        CHECK (cashfree_vendor_id ~ '^[A-Za-z0-9_-]{3,100}$'),
    provider_environment VARCHAR(12) NOT NULL CHECK (provider_environment='sandbox'),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','ACTIVE','SUSPENDED')),
    verified_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    verified_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT vendor_activation_requires_verification CHECK (
        status<>'ACTIVE' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)
    )
);

CREATE TABLE cashfree_rmc_prepaid_intents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    offer_version INTEGER NOT NULL CHECK (offer_version > 0),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE RESTRICT,
    vendor_id VARCHAR(100) NOT NULL,
    request_key VARCHAR(100) NOT NULL CHECK (length(request_key) BETWEEN 8 AND 100),
    gateway_order_id VARCHAR(100) NOT NULL UNIQUE,
    payment_session_id TEXT,
    amount NUMERIC(12,2) NOT NULL CHECK (amount BETWEEN 1 AND 10000000),
    currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency='INR'),
    payment_mode VARCHAR(32) NOT NULL CHECK (payment_mode IN ('FULL_ADVANCE','PARTIAL_ADVANCE')),
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','VERIFIED','HOLD_REFUND_REVIEW')),
    provider_payment_id VARCHAR(100),
    provider_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT cashfree_prepaid_one_checkout_per_accepted_offer UNIQUE (order_id,offer_version),
    CONSTRAINT cashfree_prepaid_customer_retry_key UNIQUE (customer_id,request_key)
);
CREATE UNIQUE INDEX cashfree_prepaid_provider_payment_unique
    ON cashfree_rmc_prepaid_intents(provider_payment_id)
    WHERE provider_payment_id IS NOT NULL;
CREATE INDEX cashfree_prepaid_pending_index
    ON cashfree_rmc_prepaid_intents(order_id,created_at)
    WHERE status='PENDING';

CREATE TABLE cashfree_rmc_prepaid_webhook_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    intent_id UUID NOT NULL REFERENCES cashfree_rmc_prepaid_intents(id) ON DELETE RESTRICT,
    event_digest VARCHAR(64) NOT NULL UNIQUE,
    event_kind VARCHAR(60) NOT NULL,
    provider_status VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
