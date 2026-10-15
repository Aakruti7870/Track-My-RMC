ALTER TABLE customer_sites ADD COLUMN notes TEXT;
ALTER TABLE customer_sites ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customer_sites ALTER COLUMN address_line TYPE VARCHAR(1000);
ALTER TABLE customer_sites ALTER COLUMN contact_person TYPE VARCHAR(160);
CREATE UNIQUE INDEX uq_customer_default_site ON customer_sites(customer_id) WHERE is_default;
