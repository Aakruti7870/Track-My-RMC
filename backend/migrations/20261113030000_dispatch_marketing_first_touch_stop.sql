-- One TrackMyRMC first-dispatch promotion per phone, not one per plant.
-- This ledger is not marketing consent: separate verified consent is mandatory.
CREATE TABLE dispatch_whatsapp_marketing_first_touch (
    phone_e164 VARCHAR(16) PRIMARY KEY
        CHECK (phone_e164 ~ '^[+][1-9][0-9]{7,14}$'),
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    plant_id UUID REFERENCES rmc_plants(id) ON DELETE SET NULL,
    reserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- All verified STOP/opt-out requests suppress BOTH dispatch-linked and
-- Central Admin CRM marketing. Never revoke transactional dispatch consent.
-- Only documented new positive consent can remove this suppression.
CREATE TABLE whatsapp_marketing_opt_outs (
    phone_e164 VARCHAR(16) PRIMARY KEY
        CHECK (phone_e164 ~ '^[+][1-9][0-9]{7,14}$'),
    opted_out_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source VARCHAR(32) NOT NULL
        CHECK (source IN ('whatsapp_stop','customer_app','admin_consent')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX whatsapp_marketing_opt_outs_changed_at
    ON whatsapp_marketing_opt_outs(opted_out_at DESC);

COMMENT ON TABLE dispatch_whatsapp_marketing_first_touch IS
    'Exactly one automatic first-dispatch app promotion attempt per E.164 phone across all plants. Not authorization to send without independent opt-in.';
COMMENT ON TABLE whatsapp_marketing_opt_outs IS
    'Durable WhatsApp marketing STOP/opt-out suppression for dispatch-linked and Admin CRM campaigns; order Utility messages unaffected.';
