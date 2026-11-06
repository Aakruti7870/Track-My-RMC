-- 0048_plant_profile_sections.sql
-- A plant's public profile is separate from its invoicing identity.
-- Owners/staff prepare drafts; only a dedicated MFA Central Admin can publish.
-- Historical public content stays unchanged while a new draft is reviewed.
CREATE TABLE IF NOT EXISTS plant_profile_sections (
    plant_id UUID NOT NULL REFERENCES rmc_plants(id) ON DELETE CASCADE,
    section_key VARCHAR(40) NOT NULL CHECK (section_key IN (
        'identification','certifications','specifications','materials','quality','fleet'
    )),
    draft_data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(draft_data) = 'object'),
    submitted_data JSONB CHECK (submitted_data IS NULL OR jsonb_typeof(submitted_data) = 'object'),
    published_data JSONB CHECK (published_data IS NULL OR jsonb_typeof(published_data) = 'object'),
    status VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','pending_review','published','rejected')),
    draft_revision BIGINT NOT NULL DEFAULT 0,
    submitted_revision BIGINT,
    reviewed_revision BIGINT,
    edited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    review_note VARCHAR(500),
    PRIMARY KEY (plant_id, section_key)
);
CREATE INDEX IF NOT EXISTS idx_plant_profile_pending
    ON plant_profile_sections (submitted_at DESC)
    WHERE status = 'pending_review';
