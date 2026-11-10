-- Separate, opt-in transactional WhatsApp dispatch automation.
-- No existing order/customer identity, payment or legacy automation schema is changed.
CREATE TABLE dispatch_whatsapp_plant_settings (
    plant_id UUID PRIMARY KEY REFERENCES rmc_plants(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Do not confuse Android notification permission with WhatsApp opt-in.
CREATE TABLE dispatch_whatsapp_contacts (
    order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
    phone_e164 VARCHAR(16) NOT NULL CHECK (phone_e164 ~ '^[+][1-9][0-9]{9,14}),
    opted_in BOOLEAN NOT NULL DEFAULT FALSE,
    consent_source VARCHAR(32) NOT NULL CHECK (
        consent_source IN ('customer_app', 'written_order', 'customer_phone', 'in_person')
    ),
    consent_actor_id UUID NOT NULL REFERENCES users(id),
    consent_recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The load is the idempotency key: preparing a challan records an unsent event.
-- Only actual dispatch promotes the event to the sending queue.
-- SENDING is deliberately not automatically reclaimed: an interrupted HTTP
-- request may have reached Meta, so blind retries could double-send.
CREATE TABLE dispatch_whatsapp_events (
    load_id UUID PRIMARY KEY REFERENCES order_loads(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    status VARCHAR(24) NOT NULL DEFAULT 'needs_consent'
        CHECK (status IN (
            'waiting_dispatch', 'needs_consent', 'pending', 'sending',
            'sent', 'delivered', 'read', 'failed', 'uncertain', 'cancelled'
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
    ON dispatch_whatsapp_events (created_at, load_id) WHERE status = 'pending';
CREATE INDEX idx_dispatch_whatsapp_events_owner
    ON dispatch_whatsapp_events (plant_id, created_at DESC);
),
    opted_in BOOLEAN NOT NULL DEFAULT FALSE,
    consent_source VARCHAR(32) NOT NULL CHECK (
        consent_source IN ('customer_app', 'written_order', 'customer_phone', 'in_person')
    ),
    consent_actor_id UUID NOT NULL REFERENCES users(id),
    consent_recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The load is the idempotency key: preparing a challan never queues a send.
-- SENDING is deliberately not automatically reclaimed: an interrupted HTTP
-- request may have reached Meta, so blind retries could double-send.
CREATE TABLE dispatch_whatsapp_events (
    load_id UUID PRIMARY KEY REFERENCES order_loads(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    status VARCHAR(24) NOT NULL DEFAULT 'needs_consent'
        CHECK (status IN (
            'needs_consent', 'pending', 'sending', 'accepted',
            'sent', 'delivered', 'read', 'failed', 'uncertain', 'cancelled'
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
    ON dispatch_whatsapp_events (created_at, load_id) WHERE status = 'pending';
CREATE INDEX idx_dispatch_whatsapp_events_owner
    ON dispatch_whatsapp_events (plant_id, created_at DESC);
