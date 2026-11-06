-- Staged customer order payment preferences and plant-approved commercial terms.
-- No payment gateway intent, ledger posting, settlement or production activation is performed here.
-- Important: this migration must be reviewed against the production migration history BEFORE merging.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS preferred_payment_mode VARCHAR(32);
ALTER TABLE orders
    ADD CONSTRAINT orders_preferred_payment_mode_check
    CHECK (preferred_payment_mode IS NULL OR preferred_payment_mode IN
        ('FULL_ADVANCE','PARTIAL_ADVANCE','ON_DELIVERY','APPROVED_CREDIT'));

CREATE TABLE IF NOT EXISTS order_payment_offers (
    order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE RESTRICT,
    mode VARCHAR(32) NOT NULL CHECK (mode IN
        ('FULL_ADVANCE','PARTIAL_ADVANCE','ON_DELIVERY','APPROVED_CREDIT')),
    total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount > 0),
    advance_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (advance_amount >= 0),
    status VARCHAR(32) NOT NULL DEFAULT 'OFFERED' CHECK (status IN
        ('OFFERED','AWAITING_PAYMENT','READY_FOR_PRODUCTION','CANCELLED')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    expires_at TIMESTAMPTZ NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    customer_accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT order_payment_advance_consistency CHECK (
        (mode='FULL_ADVANCE' AND advance_amount=total_amount) OR
        (mode='PARTIAL_ADVANCE' AND advance_amount > 0 AND advance_amount < total_amount) OR
        (mode IN ('ON_DELIVERY','APPROVED_CREDIT') AND advance_amount=0)
    )
);
CREATE INDEX IF NOT EXISTS idx_order_payment_offers_expires
    ON order_payment_offers(expires_at) WHERE status='OFFERED';

-- Backstop against legacy endpoints bypassing new-order commercial acceptance.
-- Only applies to orders that opted into the new preferred-payment workflow.
CREATE OR REPLACE FUNCTION guard_preferred_payment_order_release()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.preferred_payment_mode IS NOT NULL
        AND OLD.status = 'pending'
        AND NEW.status IS DISTINCT FROM OLD.status
        AND NEW.status NOT IN ('pending','cancelled','rejected')
        AND NOT EXISTS (
            SELECT 1 FROM order_payment_offers p
            WHERE p.order_id = OLD.id AND p.status = 'READY_FOR_PRODUCTION'
        )
    THEN
        RAISE EXCEPTION 'Order commercial terms and verified payment authorization are incomplete'
            USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_guard_preferred_payment_order_release
    BEFORE UPDATE OF status ON orders
    FOR EACH ROW EXECUTE FUNCTION guard_preferred_payment_order_release();
