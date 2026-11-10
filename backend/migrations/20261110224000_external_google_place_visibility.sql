-- A distinct exact-ID moderation override for Google Places discovery inside TrackMyRMC.
-- Never purges Google data or alters external Google Maps.
CREATE TABLE google_plant_visibility_exclusions (
    place_id VARCHAR(256) PRIMARY KEY,
    is_visible BOOLEAN NOT NULL DEFAULT FALSE,
    changed_by UUID NOT NULL REFERENCES users(id),
    change_reason VARCHAR(500) NOT NULL CHECK (char_length(btrim(change_reason)) >= 10),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_google_plant_visibility_exclusions_held
    ON google_plant_visibility_exclusions(updated_at DESC) WHERE is_visible=FALSE;
