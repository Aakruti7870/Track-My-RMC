-- Native Rust automation foundation (opt-in, internal actions only).
-- Additive migration: do not modify or re-checksum the legacy 0018 automation queue.
CREATE TABLE IF NOT EXISTS native_automation_templates (
    template_key VARCHAR(80) PRIMARY KEY,
    label VARCHAR(120) NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    action_type VARCHAR(40) NOT NULL CHECK (action_type IN ('IN_APP_NOTIFICATION')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    published BOOLEAN NOT NULL DEFAULT FALSE,
    globally_paused BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO native_automation_templates(template_key,label,event_type,action_type)
VALUES
 ('ORDER_ACCEPTED_NOTICE','Customer order acceptance notice','ORDER_ACCEPTED','IN_APP_NOTIFICATION'),
 ('ORDER_REJECTED_NOTICE','Customer order rejection notice','ORDER_REJECTED','IN_APP_NOTIFICATION')
ON CONFLICT (template_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS native_automation_plant_rules (
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    template_key VARCHAR(80) NOT NULL REFERENCES native_automation_templates(template_key),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (plant_id,template_key)
);

CREATE TABLE IF NOT EXISTS native_automation_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_key VARCHAR(180) NOT NULL UNIQUE,
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    template_key VARCHAR(80) NOT NULL REFERENCES native_automation_templates(template_key),
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
      CHECK (status IN ('PENDING','RETRY','COMPLETED','SKIPPED','DEAD_LETTER')),
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
    last_error TEXT,
    notification_id UUID REFERENCES notifications(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_native_automation_due
  ON native_automation_jobs (available_at,id)
  WHERE status IN ('PENDING','RETRY');
CREATE INDEX IF NOT EXISTS idx_native_automation_plant
  ON native_automation_jobs (plant_id,created_at DESC);

CREATE TABLE IF NOT EXISTS native_automation_attempts (
    id BIGSERIAL PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES native_automation_jobs(id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL,
    outcome VARCHAR(20) NOT NULL
      CHECK (outcome IN ('COMPLETED','SKIPPED','RETRY','DEAD_LETTER')),
    detail TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_native_automation_attempts_job
  ON native_automation_attempts (job_id,created_at DESC);

CREATE TABLE IF NOT EXISTS native_automation_worker_heartbeat (
    worker_name VARCHAR(100) PRIMARY KEY,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_success_at TIMESTAMPTZ,
    last_error TEXT
);
