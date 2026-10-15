-- Additive order provenance; no historical records or prices are rewritten.
ALTER TABLE orders ADD COLUMN idempotency_key VARCHAR(128);
ALTER TABLE orders ADD COLUMN request_payload JSONB;
ALTER TABLE orders ADD COLUMN quotation_id UUID REFERENCES plant_quotations(id);
ALTER TABLE orders ADD COLUMN pricing_snapshot JSONB;
ALTER TABLE orders ADD COLUMN delivery_mode VARCHAR(20) NOT NULL DEFAULT 'DELIVERY';
CREATE UNIQUE INDEX uq_order_customer_request ON orders(customer_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX uq_order_quotation ON orders(quotation_id) WHERE quotation_id IS NOT NULL;
-- Manual addresses must not acquire invented map coordinates.
ALTER TABLE customer_sites ALTER COLUMN latitude DROP NOT NULL;
ALTER TABLE customer_sites ALTER COLUMN longitude DROP NOT NULL;
ALTER TABLE customer_sites ALTER COLUMN address_line TYPE VARCHAR(500);
CREATE TABLE customer_order_intents (
    token_hash CHAR(64) PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES users(id),
    request_payload JSONB NOT NULL,
    preview JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    confirmed_order_id UUID REFERENCES orders(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_order_intents_customer ON customer_order_intents(customer_id,expires_at);
