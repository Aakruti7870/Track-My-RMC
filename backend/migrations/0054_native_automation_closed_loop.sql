-- 0054: Closed-loop owner review tasks. Additive, defaults are inert until
-- NATIVE_AUTOMATION_WORKER_ENABLED=true and a template is explicitly opted into.
ALTER TABLE native_automation_plant_rules
    ADD COLUMN sla_minutes INTEGER NOT NULL DEFAULT 60
    CHECK (sla_minutes BETWEEN 15 AND 1440);

ALTER TABLE native_automation_domain_tasks
    ADD COLUMN acknowledged_at TIMESTAMPTZ,
    ADD COLUMN acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN next_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN next_escalation_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '60 minutes'),
    ADD COLUMN escalation_count INTEGER NOT NULL DEFAULT 0
        CHECK (escalation_count BETWEEN 0 AND 2),
    ADD COLUMN resolution_reason VARCHAR(64);

-- Prior ACKNOWLEDGED tasks used resolved_at as a proxy for "seen".
-- Correct that semantic mistake without closing an unresolved operational issue.
UPDATE native_automation_domain_tasks
SET acknowledged_at=resolved_at, resolved_at=NULL, updated_at=NOW()
WHERE status='ACKNOWLEDGED' AND acknowledged_at IS NULL;

CREATE INDEX idx_native_domain_tasks_reconcile
    ON native_automation_domain_tasks(next_check_at,id)
    WHERE status IN ('OPEN','ACKNOWLEDGED');

-- Append-only technical audit. Automated transitions must not impersonate
-- an owner in the operational audit_logs actor field.
CREATE TABLE native_automation_domain_task_events (
    id BIGSERIAL PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES native_automation_domain_tasks(id) ON DELETE CASCADE,
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    event_type VARCHAR(32) NOT NULL
        CHECK (event_type IN ('ACKNOWLEDGED','SLA_ESCALATED','SOURCE_RESOLVED','SOURCE_CANCELLED')),
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(details)='object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_native_domain_task_events_lookup
    ON native_automation_domain_task_events(plant_id,task_id,created_at DESC);
