-- Preserve historical values without certifying their provenance. New records carry explicit engineer evidence.
ALTER TABLE cube_tests ALTER COLUMN expected_strength_mpa DROP NOT NULL;
ALTER TABLE cube_tests ALTER COLUMN actual_strength_mpa DROP NOT NULL;
ALTER TABLE cube_tests ALTER COLUMN passed DROP NOT NULL;
ALTER TABLE cube_tests ALTER COLUMN test_interval_days DROP NOT NULL;
ALTER TABLE cube_tests ALTER COLUMN result DROP DEFAULT;
ALTER TABLE cube_tests ADD COLUMN record_source TEXT NOT NULL DEFAULT 'LEGACY_UNVERIFIED';
ALTER TABLE cube_tests ADD COLUMN temperature_celsius NUMERIC(5,2);
ALTER TABLE cube_tests ADD COLUMN visual_inspection TEXT;
ALTER TABLE cube_tests ADD COLUMN request_id TEXT;
ALTER TABLE cube_tests ADD COLUMN request_payload JSONB;
CREATE UNIQUE INDEX cube_tests_engineer_request ON cube_tests(order_id, tested_by, request_id) WHERE request_id IS NOT NULL;
CREATE INDEX cube_tests_latest_inspection ON cube_tests(order_id, created_at DESC, id DESC);
