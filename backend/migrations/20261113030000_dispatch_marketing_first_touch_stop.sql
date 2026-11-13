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

-- Preserve historical attempts: adding the ledger must not send a second
-- "first" promotion to a number previously reached by the old worker.
INSERT INTO dispatch_whatsapp_marketing_first_touch
    (phone_e164,order_id,plant_id,reserved_at)
SELECT DISTINCT ON (c.phone_e164)
    c.phone_e164,m.order_id,m.plant_id,COALESCE(m.attempted_at,m.created_at)
FROM dispatch_whatsapp_marketing_events m
JOIN dispatch_whatsapp_contacts c ON c.order_id=m.order_id
WHERE m.attempts > 0
  AND m.status IN ('sending','accepted','sent','delivered','read','failed','uncertain')
ORDER BY c.phone_e164,COALESCE(m.attempted_at,m.created_at),m.order_id
ON CONFLICT(phone_e164) DO NOTHING;

-- Existing CRM opt-outs and explicit STOP cancellation records remain honored
-- immediately after upgrading the schema.
INSERT INTO whatsapp_marketing_opt_outs(phone_e164,source)
SELECT DISTINCT c.phone_e164,'admin_consent'
FROM admin_marketing_contacts c WHERE c.consent_status='OPTED_OUT'
ON CONFLICT(phone_e164) DO NOTHING;

INSERT INTO whatsapp_marketing_opt_outs(phone_e164,source)
SELECT DISTINCT c.phone_e164,'whatsapp_stop'
FROM dispatch_whatsapp_contacts c
JOIN dispatch_whatsapp_marketing_events e ON e.order_id=c.order_id
WHERE e.last_error='recipient_opted_out'
ON CONFLICT(phone_e164) DO NOTHING;
