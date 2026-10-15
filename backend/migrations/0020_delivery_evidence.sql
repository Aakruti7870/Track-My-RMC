-- Preserve existing metadata; missing historical file bytes remain NULL.
ALTER TABLE stored_files ADD COLUMN IF NOT EXISTS file_data BYTEA;
ALTER TABLE proof_of_deliveries ADD COLUMN IF NOT EXISTS delivered_quantity NUMERIC(10,3)
    CHECK (delivered_quantity > 0);

ALTER TABLE stored_files ADD COLUMN IF NOT EXISTS load_id UUID REFERENCES order_loads(id);
