-- Isolate privileged challenges from the shared staff and Authority endpoints.
ALTER TABLE staff_mfa_challenges DROP CONSTRAINT staff_mfa_challenges_purpose_check;
ALTER TABLE staff_mfa_challenges ADD CONSTRAINT staff_mfa_challenges_purpose_check
    CHECK (purpose IN ('login', 'enrollment', 'admin_login', 'admin_enrollment', 'admin_recovery'));
