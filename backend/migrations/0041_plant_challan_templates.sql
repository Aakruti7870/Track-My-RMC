-- Plant-specific, owner-managed delivery challan templates. Existing challans remain untouched.
-- The universal A4 two-copy template is a runtime fallback: no mass backfill.
CREATE TABLE plant_challan_templates (
    plant_id UUID PRIMARY KEY REFERENCES rmc_plants(id) ON DELETE CASCADE,
    title VARCHAR(100) NOT NULL DEFAULT 'DELIVERY CHALLAN',
    accent_color CHAR(7) NOT NULL DEFAULT '#17313A'
        CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
    header_note VARCHAR(140) NOT NULL DEFAULT '',
    footer_note VARCHAR(200) NOT NULL DEFAULT 'Acknowledgement subject to on-site verification.',
    logo_data_uri TEXT,
    show_po BOOLEAN NOT NULL DEFAULT TRUE,
    show_slump BOOLEAN NOT NULL DEFAULT TRUE,
    show_batch BOOLEAN NOT NULL DEFAULT TRUE,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_by UUID NOT NULL REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (length(title) BETWEEN 1 AND 100),
    CHECK (logo_data_uri IS NULL OR length(logo_data_uri) <= 500000)
);

-- Audit only metadata/changed values; do not duplicate images or secrets.
CREATE TABLE plant_challan_template_audit (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL REFERENCES users(id),
    action VARCHAR(12) NOT NULL CHECK (action IN ('save', 'reset')),
    previous_version INTEGER,
    new_version INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_challan_template_audit ON plant_challan_template_audit(plant_id, created_at DESC);
CREATE FUNCTION reject_challan_template_audit_change() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Challan template audit is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER challan_template_audit_immutable
  BEFORE UPDATE OR DELETE ON plant_challan_template_audit
  FOR EACH ROW EXECUTE FUNCTION reject_challan_template_audit_change();
