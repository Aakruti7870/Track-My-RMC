-- Order status automation queue and callback attempts.
-- Added separately to preserve the checksum of migration 0017 already applied in production.

-- 15. Order Status Automation Queue & Callbacks
CREATE TABLE IF NOT EXISTS order_automation_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    event_type VARCHAR(64) NOT NULL DEFAULT 'ORDER_STATUS_CHANGED',
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'PROCESSING', 'RETRY', 'COMPLETED', 'DEAD_LETTER'
    routing_key VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    worker_id VARCHAR(128),
    lease_token VARCHAR(256),
    lease_expires_at TIMESTAMPTZ,
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auto_events_status ON order_automation_events(status, lease_expires_at);

CREATE TABLE IF NOT EXISTS order_automation_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES order_automation_events(id) ON DELETE CASCADE,
    action VARCHAR(64) NOT NULL,
    provider VARCHAR(64),
    provider_id VARCHAR(256),
    status VARCHAR(64) NOT NULL,
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
