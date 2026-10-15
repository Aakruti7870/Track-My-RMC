-- Preserve existing credentials and require each staff login TOTP step once.
ALTER TABLE user_totp_credentials ADD COLUMN last_login_totp_step BIGINT;
