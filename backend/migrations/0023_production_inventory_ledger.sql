-- Additive production ledger; historical measurements stay unchanged.
ALTER TABLE plant_materials ALTER COLUMN current_stock TYPE NUMERIC(18,6);
ALTER TABLE plant_material_adjustments ALTER COLUMN quantity_change TYPE NUMERIC(18,6);
CREATE TABLE production_batches (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 order_id UUID NOT NULL REFERENCES orders(id),
 plant_id UUID NOT NULL REFERENCES rmc_plants(id),
 batcher_id UUID NOT NULL REFERENCES users(id),
 quantity NUMERIC(14,6) NOT NULL CHECK(quantity>0),
 load_id UUID UNIQUE REFERENCES order_loads(id),
 request_id VARCHAR(128),
 request_payload JSONB NOT NULL,
 mix_design_id UUID REFERENCES plant_mix_designs(id),
 mix_design_version INT,
 batch_reference VARCHAR(160),
 remarks TEXT,
 material_consumption JSONB NOT NULL DEFAULT '[]',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(order_id,request_id)
);
CREATE INDEX production_batches_order ON production_batches(order_id,created_at);
CREATE TABLE production_stock_movements (
 id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 batch_id UUID NOT NULL REFERENCES production_batches(id),
 material_id UUID NOT NULL REFERENCES plant_materials(id),
 actor_id UUID NOT NULL REFERENCES users(id),
 quantity_change NUMERIC(18,6) NOT NULL CHECK(quantity_change<0),
 stock_unit VARCHAR(20) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(batch_id,material_id)
);
