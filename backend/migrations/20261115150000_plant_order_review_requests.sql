CREATE TABLE plant_order_review_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_key UUID NOT NULL,
    plant_id UUID REFERENCES rmc_plants(id) ON DELETE SET NULL,
    google_place_id VARCHAR(256),
    customer_name VARCHAR(160) NOT NULL,
    customer_email VARCHAR(254),
    customer_gstin VARCHAR(15),
    grade VARCHAR(30) NOT NULL,
    quantity_m3 NUMERIC(8,2) NOT NULL CHECK (quantity_m3 > 0 AND quantity_m3 <= 10000),
    site_address VARCHAR(500) NOT NULL,
    site_lat DOUBLE PRECISION,
    site_lng DOUBLE PRECISION,
    delivery_date DATE NOT NULL,
    pump_required BOOLEAN NOT NULL,
    site_contact_phone VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (customer_id, request_key)
);

CREATE INDEX idx_plant_order_review_customer ON plant_order_review_requests(customer_id, created_at DESC);
CREATE INDEX idx_plant_order_review_queue ON plant_order_review_requests(created_at DESC, id DESC);
