-- 0050: Pure Rust/PostgreSQL advanced automation: bounded reminders and human tasks.
-- Migration 0049 remains immutable for the existing PR/release checksum chain.
-- Only static, centrally reviewed action kinds are allowed.
ALTER TABLE native_automation_templates
    DROP CONSTRAINT IF EXISTS native_automation_templates_action_type_check;
ALTER TABLE native_automation_templates
    ADD CONSTRAINT native_automation_templates_action_type_check
    CHECK (action_type IN ('IN_APP_NOTIFICATION','CREATE_APPROVAL_TASK'));

INSERT INTO native_automation_templates
    (template_key,label,event_type,action_type)
VALUES
    ('ORDER_SUBMITTED_TASK','Owner order review task','ORDER_SUBMITTED','CREATE_APPROVAL_TASK'),
    ('ORDER_PENDING_REMINDER','Pending order review reminder','ORDER_PENDING','IN_APP_NOTIFICATION')
ON CONFLICT (template_key) DO NOTHING;

ALTER TABLE native_automation_plant_rules
    ADD COLUMN IF NOT EXISTS reminder_after_minutes INTEGER NOT NULL DEFAULT 60
    CHECK (reminder_after_minutes BETWEEN 15 AND 1440);

CREATE TABLE IF NOT EXISTS native_automation_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_job_id UUID NOT NULL UNIQUE REFERENCES native_automation_jobs(id) ON DELETE CASCADE,
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    assigned_to UUID NOT NULL REFERENCES users(id),
    task_kind VARCHAR(40) NOT NULL CHECK (task_kind IN ('REVIEW_ORDER')),
    status VARCHAR(16) NOT NULL DEFAULT 'OPEN'
      CHECK (status IN ('OPEN','RESOLVED','CANCELLED')),
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_native_automation_tasks_plant
    ON native_automation_tasks (plant_id,status,created_at DESC);

-- Supports bounded, indexed scheduling for pending approval follow-ups.
CREATE INDEX IF NOT EXISTS idx_orders_native_pending_review
    ON orders (created_at,id) WHERE status='pending';
