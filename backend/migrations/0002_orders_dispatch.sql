-- 0002_orders_dispatch.sql
-- Transit Mixers, Orders, Multi-load Delivery, Challans, POD, Quality Cube Tests

CREATE TABLE IF NOT EXISTS transit_mixers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    registration_number VARCHAR(50) NOT NULL UNIQUE,
    capacity_m3 NUMERIC(5,2) NOT NULL DEFAULT 6.00,
    driver_id UUID REFERENCES users(id),
    status VARCHAR(50) NOT NULL DEFAULT 'idle',
    last_latitude DOUBLE PRECISION,
    last_longitude DOUBLE PRECISION,
    last_ping_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mixers_plant ON transit_mixers(plant_id);
CREATE INDEX IF NOT EXISTS idx_mixers_driver ON transit_mixers(driver_id);

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number VARCHAR(60) NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES users(id),
    plant_id UUID NOT NULL REFERENCES rmc_plants(id),
    site_id UUID NOT NULL REFERENCES customer_sites(id),
    concrete_grade VARCHAR(30) NOT NULL,
    total_quantity_m3 NUMERIC(10,2) NOT NULL,
    delivery_date DATE NOT NULL,
    delivery_time_slot VARCHAR(50) NOT NULL,
    pump_required BOOLEAN NOT NULL DEFAULT FALSE,
    special_instructions TEXT,
    total_amount NUMERIC(12,2) NOT NULL,
    tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    payment_status VARCHAR(50) NOT NULL DEFAULT 'unpaid',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_plant ON orders(plant_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(delivery_date);

CREATE TABLE IF NOT EXISTS order_loads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    load_number INT NOT NULL,
    mixer_id UUID REFERENCES transit_mixers(id),
    driver_id UUID REFERENCES users(id),
    quantity_m3 NUMERIC(5,2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'planned',
    batch_started_at TIMESTAMPTZ,
    batch_completed_at TIMESTAMPTZ,
    dispatched_at TIMESTAMPTZ,
    arrived_at TIMESTAMPTZ,
    pour_started_at TIMESTAMPTZ,
    pour_completed_at TIMESTAMPTZ,
    returned_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(order_id, load_number)
);

CREATE INDEX IF NOT EXISTS idx_order_loads_order ON order_loads(order_id);
CREATE INDEX IF NOT EXISTS idx_order_loads_mixer ON order_loads(mixer_id);
CREATE INDEX IF NOT EXISTS idx_order_loads_driver ON order_loads(driver_id);

CREATE TABLE IF NOT EXISTS challans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    load_id UUID NOT NULL REFERENCES order_loads(id) ON DELETE CASCADE UNIQUE,
    challan_number VARCHAR(60) NOT NULL UNIQUE,
    plant_code VARCHAR(50) NOT NULL,
    customer_name VARCHAR(150) NOT NULL,
    site_address TEXT NOT NULL,
    concrete_grade VARCHAR(30) NOT NULL,
    quantity_m3 NUMERIC(5,2) NOT NULL,
    slump_mm INT NOT NULL DEFAULT 120,
    water_cement_ratio NUMERIC(4,2) NOT NULL DEFAULT 0.45,
    batch_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    mixer_number VARCHAR(50) NOT NULL,
    driver_name VARCHAR(150) NOT NULL,
    digital_signature TEXT,
    receiver_name VARCHAR(150),
    receiver_phone VARCHAR(20),
    status VARCHAR(50) NOT NULL DEFAULT 'generated',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proof_of_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    load_id UUID NOT NULL REFERENCES order_loads(id) ON DELETE CASCADE UNIQUE,
    receiver_name VARCHAR(150) NOT NULL,
    receiver_phone VARCHAR(20) NOT NULL,
    signature_url TEXT,
    photo_url TEXT,
    notes TEXT,
    delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cube_tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    load_id UUID REFERENCES order_loads(id),
    sample_date DATE NOT NULL,
    test_interval_days INT NOT NULL,
    test_date DATE NOT NULL,
    expected_strength_mpa NUMERIC(6,2) NOT NULL,
    actual_strength_mpa NUMERIC(6,2) NOT NULL,
    passed BOOLEAN NOT NULL,
    certificate_url TEXT,
    remarks TEXT,
    tested_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cube_tests_order ON cube_tests(order_id);
