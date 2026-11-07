-- 0052: Cross-domain native workflow jobs; additive, tenant-scoped and fail closed.
-- Previous order jobs remain unchanged. Domain source identifiers are never joined
-- to a different plant, and actions cannot mutate operational source records.
ALTER TABLE native_automation_jobs ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE native_automation_jobs ADD COLUMN domain_entity_id UUID;
ALTER TABLE native_automation_jobs
    ADD CONSTRAINT native_job_exactly_one_source
    CHECK ((order_id IS NOT NULL AND domain_entity_id IS NULL) OR
           (order_id IS NULL AND domain_entity_id IS NOT NULL));

ALTER TABLE native_automation_templates
    DROP CONSTRAINT native_automation_templates_action_type_check;
ALTER TABLE native_automation_templates
    ADD CONSTRAINT native_automation_templates_action_type_check
    CHECK (action_type IN ('IN_APP_NOTIFICATION','CREATE_APPROVAL_TASK','CREATE_DOMAIN_REVIEW'));

INSERT INTO native_automation_templates
    (template_key,label,event_type,action_type)
VALUES
    ('DISPATCH_UNASSIGNED_LOAD','Unassigned load follow-up','DISPATCH_LOAD_UNASSIGNED','CREATE_DOMAIN_REVIEW'),
    ('RFQ_PENDING_PLANT','Pending approved-plant RFQ','RFQ_PENDING','CREATE_DOMAIN_REVIEW'),
    ('QUALITY_INSPECTION_FAILED','Failed engineer inspection review','QUALITY_INSPECTION_FAILED','CREATE_DOMAIN_REVIEW'),
    ('INVENTORY_BELOW_MIN','Low material stock review','INVENTORY_BELOW_MIN','CREATE_DOMAIN_REVIEW'),
    ('WORKFORCE_LEAVE_PENDING','Pending staff leave review','WORKFORCE_LEAVE_PENDING','CREATE_DOMAIN_REVIEW')
ON CONFLICT (template_key) DO NOTHING;

CREATE TABLE native_automation_domain_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_job_id UUID NOT NULL UNIQUE REFERENCES native_automation_jobs(id) ON DELETE CASCADE,
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    domain_entity_id UUID NOT NULL,
    template_key VARCHAR(80) NOT NULL REFERENCES native_automation_templates(template_key),
    assigned_to UUID NOT NULL REFERENCES users(id),
    status VARCHAR(16) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','RESOLVED','CANCELLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_native_domain_tasks_plant
    ON native_automation_domain_tasks(plant_id,status,created_at DESC);
CREATE INDEX idx_native_domain_jobs_due
    ON native_automation_jobs(available_at,id)
    WHERE domain_entity_id IS NOT NULL AND status IN ('PENDING','RETRY');
