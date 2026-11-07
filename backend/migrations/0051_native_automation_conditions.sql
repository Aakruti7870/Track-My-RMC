-- 0051: centrally governed, bounded conditional execution.
-- Condition records are data (not executable code, SQL, scripts or webhooks).
ALTER TABLE native_automation_templates
    ADD COLUMN IF NOT EXISTS conditions JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(conditions)='object');

CREATE TABLE IF NOT EXISTS native_automation_template_revisions (
    template_key VARCHAR(80) NOT NULL REFERENCES native_automation_templates(template_key),
    version INTEGER NOT NULL CHECK (version > 0),
    published BOOLEAN NOT NULL,
    globally_paused BOOLEAN NOT NULL,
    conditions JSONB NOT NULL CHECK (jsonb_typeof(conditions)='object'),
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (template_key,version)
);

-- Preserve the initial revision even if this migration runs after an initial
-- template was already published or modified during branch testing.
INSERT INTO native_automation_template_revisions
    (template_key,version,published,globally_paused,conditions,changed_by)
SELECT template_key,version,published,globally_paused,conditions,updated_by
FROM native_automation_templates
ON CONFLICT (template_key,version) DO NOTHING;
