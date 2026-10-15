-- Add retry provenance and internal-note separation without rewriting history.
ALTER TABLE support_cases ADD COLUMN request_id VARCHAR(128);
ALTER TABLE support_cases ADD COLUMN request_payload JSONB;
ALTER TABLE support_cases ADD COLUMN case_number VARCHAR(50);
UPDATE support_cases SET case_number='SUP-' || REPLACE(id::text,'-','') WHERE case_number IS NULL;
ALTER TABLE support_cases ALTER COLUMN case_number SET NOT NULL;
CREATE UNIQUE INDEX support_case_number_unique ON support_cases(case_number);
CREATE UNIQUE INDEX support_case_retry_unique ON support_cases(user_id,request_id) WHERE request_id IS NOT NULL;
ALTER TABLE support_case_replies ADD COLUMN internal BOOLEAN NOT NULL DEFAULT FALSE;
