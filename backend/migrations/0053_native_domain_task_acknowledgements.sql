-- 0053: Acknowledgement of internal tasks is not operational approval.
-- Baseline revisions for newly introduced static domain templates.
ALTER TABLE native_automation_domain_tasks
    DROP CONSTRAINT native_automation_domain_tasks_status_check;
ALTER TABLE native_automation_domain_tasks
    ADD CONSTRAINT native_automation_domain_tasks_status_check
    CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED','CANCELLED'));

INSERT INTO native_automation_template_revisions
    (template_key,version,published,globally_paused,conditions,changed_by)
SELECT t.template_key,t.version,t.published,t.globally_paused,t.conditions,t.updated_by
FROM native_automation_templates t
ON CONFLICT (template_key,version) DO NOTHING;
