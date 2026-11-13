-- Standard invoice workflow. Never modify issued historical invoices in place.
CREATE TABLE invoice_buyers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plant_id UUID NOT NULL REFERENCES rmc_plants(id),
  customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  company_name VARCHAR(200) NOT NULL,
  gstin VARCHAR(15),
  billing_address TEXT NOT NULL,
  delivery_address TEXT,
  state_code VARCHAR(2) NOT NULL,
  phone VARCHAR(30),
  email VARCHAR(254),
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invoice_buyer_name_nonempty CHECK (length(trim(company_name)) > 0),
  CONSTRAINT invoice_buyer_address_nonempty CHECK (length(trim(billing_address)) > 0),
  CONSTRAINT invoice_buyer_state_code_format CHECK (state_code ~ '^[0-9]{2}$'),
  CONSTRAINT invoice_buyer_gstin_format CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z0-9]{13}$')
);
CREATE UNIQUE INDEX invoice_buyers_plant_gstin_uq ON invoice_buyers(plant_id,gstin) WHERE gstin IS NOT NULL;
CREATE INDEX invoice_buyers_plant_name_idx ON invoice_buyers(plant_id, company_name);

CREATE TABLE invoice_drafts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plant_id UUID NOT NULL REFERENCES rmc_plants(id),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id),
  customer_id UUID NOT NULL REFERENCES users(id),
  buyer_id UUID REFERENCES invoice_buyers(id),
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  manual_invoice_number VARCHAR(16),
  seller_name VARCHAR(200) NOT NULL,
  seller_gstin VARCHAR(15),
  seller_address TEXT NOT NULL,
  seller_state_code VARCHAR(2),
  buyer_name VARCHAR(200) NOT NULL,
  buyer_gstin VARCHAR(15),
  buyer_address TEXT NOT NULL,
  buyer_state_code VARCHAR(2),
  place_of_supply VARCHAR(2),
  challan_display_reference TEXT,
  note TEXT NOT NULL DEFAULT '',
  lines JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(lines) = 'array'),
  version INT NOT NULL DEFAULT 1 CHECK (version > 0),
  status VARCHAR(12) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ISSUED')),
  issued_invoice_id UUID UNIQUE REFERENCES plant_invoices(id),
  updated_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT invoice_drafts_state CHECK (
    (status='DRAFT' AND issued_invoice_id IS NULL)
    OR (status='ISSUED' AND issued_invoice_id IS NOT NULL)
  )
);
CREATE INDEX invoice_drafts_plant_idx ON invoice_drafts (plant_id, updated_at DESC);

CREATE TABLE invoice_sequences (
  plant_id UUID NOT NULL REFERENCES rmc_plants(id),
  fiscal_year_start SMALLINT NOT NULL,
  last_number INTEGER NOT NULL CHECK (last_number BETWEEN 0 AND 999999),
  PRIMARY KEY (plant_id, fiscal_year_start)
);
CREATE TABLE invoice_documents (
  invoice_id UUID PRIMARY KEY REFERENCES plant_invoices(id),
  plant_id UUID NOT NULL REFERENCES rmc_plants(id),
  draft_id UUID NOT NULL UNIQUE REFERENCES invoice_drafts(id),
  payload JSONB NOT NULL,
  document_html TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE invoice_challan_links (
  invoice_id UUID NOT NULL REFERENCES plant_invoices(id),
  challan_id UUID NOT NULL UNIQUE REFERENCES challans(id),
  PRIMARY KEY (invoice_id, challan_id)
);

CREATE OR REPLACE FUNCTION block_issued_invoice_document_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Issued invoice documents are immutable';
END;
$$;
CREATE TRIGGER invoice_documents_immutable
BEFORE UPDATE OR DELETE ON invoice_documents
FOR EACH ROW EXECUTE FUNCTION block_issued_invoice_document_mutation();

CREATE OR REPLACE FUNCTION block_issued_invoice_challan_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Issued invoice challan links are immutable';
END;
$$;
CREATE TRIGGER invoice_challan_links_immutable
BEFORE UPDATE OR DELETE ON invoice_challan_links
FOR EACH ROW EXECUTE FUNCTION block_issued_invoice_challan_mutation();

-- The platform cannot infer an RMC business's e-invoicing eligibility.
-- Final invoices require owner-recorded applicability before issuance.
CREATE TABLE invoice_compliance_declarations (
    plant_id UUID PRIMARY KEY REFERENCES rmc_plants(id),
    e_invoice_required BOOLEAN NOT NULL,
    confirmed_by UUID NOT NULL REFERENCES users(id),
    confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
