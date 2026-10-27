-- Pre-AAB: record an owner's preferred subscription duration without charging,
-- pricing, provisioning an entitlement or changing any live Cashfree credentials.
ALTER TABLE plant_listing_requests
  ADD COLUMN IF NOT EXISTS preferred_plan_months SMALLINT;
ALTER TABLE plant_listing_requests
  ADD CONSTRAINT plant_listing_requests_preferred_plan_months_valid
    CHECK (preferred_plan_months IS NULL OR preferred_plan_months IN (1, 3, 6, 12));

-- Versioned post-auth introduction for all authenticated roles and reviewer fixtures.
-- Existing version-1 consent data remains valid with camera set to "manual".
-- Camera OS permission remains contextual (POD/document capture), not auto-requested.
ALTER TABLE user_permission_consent
  ADD COLUMN IF NOT EXISTS camera_choice TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE user_permission_consent
  ADD CONSTRAINT user_permission_consent_camera_choice_valid
    CHECK (camera_choice IN ('granted','denied','manual','unavailable','undetermined'));

COMMENT ON COLUMN plant_listing_requests.preferred_plan_months IS
  'Non-billable owner plan interest only. Actual pricing and payment require separate written approval.';
COMMENT ON COLUMN user_permission_consent.camera_choice IS
  'In-app camera choice. OS camera runtime permission is requested only at a feature-use gesture.';
