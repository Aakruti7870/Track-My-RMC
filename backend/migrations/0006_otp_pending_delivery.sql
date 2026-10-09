-- Keep WhatsApp OTPs un-verifiable until delivery is accepted.
ALTER TABLE otp_verifications
ADD COLUMN IF NOT EXISTS is_pending BOOLEAN NOT NULL DEFAULT FALSE;
