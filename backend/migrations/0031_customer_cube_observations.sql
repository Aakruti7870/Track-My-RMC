ALTER TABLE customer_receiving_records ADD COLUMN cube_sample_ids TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE customer_receiving_records ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE cube_test_results ADD COLUMN recorded_by UUID REFERENCES users(id);
ALTER TABLE cube_test_results ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
