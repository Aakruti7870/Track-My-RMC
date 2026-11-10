-- Central Admin Phase 2: additive, fail-closed review controls and consent CRM.
-- Neither creating a contact nor reviewing a campaign sends any message.
-- Existing approved plants retain DIRECT intake until Central Admin changes it.
CREATE TABLE plant_admin_controls (
    plant_id UUID PRIMARY KEY REFERENCES rmc_plants(id) ON DELETE CASCADE,
    order_intake_mode VARCHAR(20) NOT NULL DEFAULT 'DIRECT'
        CHECK (order_intake_mode IN ('DIRECT','ADMIN_REVIEW','RFQ_ONLY','DISABLED')),
    changed_by UUID NOT NULL REFERENCES users(id),
    change_reason VARCHAR(500) NOT NULL CHECK (char_length(btrim(change_reason)) >= 10),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE plant_trust_reviews (
    plant_id UUID PRIMARY KEY REFERENCES rmc_plants(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('VERIFIED','REVOKED')),
    valid_until DATE,
    reviewed_by UUID NOT NULL REFERENCES users(id),
    review_reason VARCHAR(500) NOT NULL CHECK (char_length(btrim(review_reason)) >= 10),
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT verified_requires_expiry CHECK
        (status <> 'VERIFIED' OR valid_until IS NOT NULL)
);
CREATE INDEX idx_plant_trust_reviews_status ON plant_trust_reviews(status,valid_until);

CREATE TABLE admin_marketing_segments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL CHECK (char_length(btrim(name)) BETWEEN 3 AND 100),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ux_admin_marketing_segments_name ON admin_marketing_segments(lower(btrim(name)));

CREATE TABLE admin_marketing_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_e164 VARCHAR(16) NOT NULL UNIQUE CHECK (phone_e164 ~ '^[+][1-9][0-9]{7,14}$'),
    display_name VARCHAR(120) NOT NULL DEFAULT '',
    source_label VARCHAR(100) NOT NULL DEFAULT 'provided_csv',
    consent_status VARCHAR(16) NOT NULL DEFAULT 'UNVERIFIED'
        CHECK (consent_status IN ('UNVERIFIED','OPTED_IN','OPTED_OUT')),
    consent_evidence VARCHAR(500),
    consent_recorded_at TIMESTAMPTZ,
    last_changed_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT opted_in_requires_evidence CHECK
        (consent_status <> 'OPTED_IN' OR
         (consent_evidence IS NOT NULL AND length(btrim(consent_evidence)) >= 12 AND consent_recorded_at IS NOT NULL))
);
CREATE INDEX idx_admin_marketing_contacts_consent ON admin_marketing_contacts(consent_status);

CREATE TABLE admin_marketing_memberships (
    segment_id UUID NOT NULL REFERENCES admin_marketing_segments(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES admin_marketing_contacts(id) ON DELETE CASCADE,
    PRIMARY KEY (segment_id,contact_id)
);

CREATE TABLE admin_marketing_campaign_drafts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    segment_id UUID NOT NULL REFERENCES admin_marketing_segments(id) ON DELETE RESTRICT,
    name VARCHAR(120) NOT NULL,
    whatsapp_template VARCHAR(120) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status='DRAFT'),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE admin_marketing_campaign_drafts IS
    'DRAFT ONLY. This migration intentionally implements no sending, approval or provider side effects.';
