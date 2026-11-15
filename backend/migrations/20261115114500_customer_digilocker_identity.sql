-- Mark first-time WhatsApp accounts whose name came from signup, including existing customers.
ALTER TABLE user_profiles ADD COLUMN needs_kyc_name BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE user_profiles AS profile
SET needs_kyc_name = TRUE
FROM users AS account
WHERE account.id = profile.user_id
    AND account.role = 'customer'
    AND account.full_name = 'RMC Customer'
    AND account.email IS NULL
    AND account.phone IS NOT NULL
    AND profile.kyc_status = 'unverified'
    AND NULLIF(BTRIM(profile.verified_name), '') IS NULL;

ALTER TABLE customer_digilocker_sessions
    DROP CONSTRAINT customer_digilocker_sessions_failure_reason_check;

ALTER TABLE customer_digilocker_sessions
    ADD CONSTRAINT customer_digilocker_sessions_failure_reason_check
    CHECK (failure_reason IS NULL OR failure_reason IN (
        'identity_mismatch', 'name_mismatch', 'mobile_mismatch', 'profile_incomplete',
        'aadhaar_not_consented', 'document_access_denied'
    ));
