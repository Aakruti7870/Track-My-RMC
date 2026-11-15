-- A DigiLocker document grant may be absent or the provider may deny access.
-- Preserve both terminal states without treating either as identity rejection.
-- The existing identity/provider approval guards remain unchanged.
ALTER TABLE customer_digilocker_sessions
    DROP CONSTRAINT customer_digilocker_sessions_failure_reason_check;

ALTER TABLE customer_digilocker_sessions
    ADD CONSTRAINT customer_digilocker_sessions_failure_reason_check
    CHECK (
        failure_reason IS NULL
        OR failure_reason IN (
            'identity_mismatch',
            'aadhaar_not_consented',
            'document_access_denied'
        )
    );
