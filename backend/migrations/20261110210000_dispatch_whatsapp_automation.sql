-- Separate, opt-in transactional WhatsApp dispatch and app promotion.
-- Existing customer/order identity, payments and internal automations unchanged.
CREATE TABLE dispatch_whatsapp_plant_settings (
    plant_id UUID PRIMARY KEY REFERENCES rmc_plants(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    marketing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A customer's app push notification permission is NOT WhatsApp consent.
CREATE TABLE dispatch_whatsapp_contacts (
    order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    phone_e164 VARCHAR(16) NOT NULL CHECK (phone_e164 ~ '^[+][1-9][0-9]{9,14}$'),
    opted_in BOOLEAN NOT NULL DEFAULT FALSE,
    marketing_opted_in BOOLEAN NOT NULL DEFAULT FALSE,
    marketing_consent_recorded_at TIMESTAMPTZ,
    consent_source VARCHAR(32) NOT NULL CHECK (
        consent_source IN ('customer_app','written_order','customer_phone','in_person')
    ),
    consent_actor_id UUID NOT NULL REFERENCES users(id),
    consent_recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At challan preparation: waiting_dispatch. At actual dispatch: pending
-- or needs_consent. A load's primary key is the exact-once outbox identity.
CREATE TABLE dispatch_whatsapp_events (
    load_id UUID PRIMARY KEY REFERENCES order_loads(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    status VARCHAR(24) NOT NULL DEFAULT 'waiting_dispatch' CHECK (status IN (
        'waiting_dispatch','needs_consent','pending','sending','accepted',
        'sent','delivered','read','failed','uncertain','cancelled'
    )),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
    provider_message_id TEXT UNIQUE,
    last_error VARCHAR(120),
    attempted_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_dispatch_whatsapp_events_queue
    ON dispatch_whatsapp_events (created_at,load_id) WHERE status='pending';
CREATE INDEX idx_dispatch_whatsapp_events_owner
    ON dispatch_whatsapp_events (plant_id,created_at DESC);

-- Independent approved MARKETING message, one event per order.
CREATE TABLE dispatch_whatsapp_marketing_events (
    order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    status VARCHAR(24) NOT NULL DEFAULT 'waiting_dispatch' CHECK (status IN (
        'waiting_dispatch','needs_consent','pending','sending','accepted',
        'sent','delivered','read','failed','uncertain','skipped','cancelled'
    )),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
    provider_message_id TEXT UNIQUE,
    last_error VARCHAR(120),
    attempted_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_dispatch_whatsapp_marketing_queue
    ON dispatch_whatsapp_marketing_events (created_at,order_id) WHERE status='pending';
CREATE INDEX idx_dispatch_whatsapp_marketing_owner
    ON dispatch_whatsapp_marketing_events (plant_id,created_at DESC);

-- Reservation is atomic across Rust workers; no repeat marketing in 30 days.
CREATE TABLE dispatch_whatsapp_marketing_cooldowns (
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    phone_e164 VARCHAR(16) NOT NULL,
    reserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (plant_id,phone_e164)
);
