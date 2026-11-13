# TOTP credential encryption rollout

The backend uses a dedicated AES-256-GCM keyring. The ciphertext includes a format version and key ID, uses a fresh nonce per write and is authenticated against the credential owner. PostgreSQL keeps the same column and recovery-code hashes. Login, enrollment, step-up and recovery use the same keyring.

## Provision and verify

1. On an authorized secret-management workstation, generate a dedicated random 32-byte key. Store the comma-separated `id=64-hex-digits` entries under `TOTP_ENCRYPTION_KEYS` and the active entry ID under `TOTP_ENCRYPTION_ACTIVE_KEY_ID`. Keep the keyring separate from the OTP pepper and the database backup.
2. Verify both fields in isolated staging. Confirm every running instance can decrypt the keys in use. Take an encrypted, access-restricted database backup and independently verify its restore with the associated keyring. Inventory existing credential rows without selecting seed values into logs.
3. Drain instances running the plaintext-only binary before starting an encryption-enabled binary. Startup migrates legacy rows and rewraps older envelopes in one transaction before accepting traffic. A missing key, corrupted envelope or invalid legacy seed blocks startup and rolls back the sweep. The same transaction enables a PostgreSQL constraint that rejects plaintext inserts and replacements, including writes by pre-encryption binaries.
4. In staging, verify pending enrollment, staff sign-in and recovery, Authority password and TOTP, Central Admin enrollment and recovery, step-up and OTP-only customer registration. Confirm all credential rows are encrypted and verify boot time against the actual row count. Verify the release can be rolled back with an encryption-capable binary and matching keyring.

## Rotate and roll back

1. Distribute the new key alongside the old one on every instance before switching the active ID. Then drain instances that still write with the old active ID before running the rewrap. Retain historical keys for supported restore points and prove a restore before removing any historical key from archival custody.
2. To reverse a key rotation, start an encryption-capable build with both keys and the previous active ID. Verify rewrap and sign-in before allowing traffic.
3. A plaintext-only binary cannot read the encrypted rows. Do not use it against the migrated database. Before first production rollout, rehearse the approved recovery path with the pre-change snapshot and document how writes since the snapshot will be preserved. Treat pre-migration snapshots and historical database storage containing plaintext seeds as sensitive until their retention expires.

## Release governance

Protect `main` with required pull requests, an independent approval, dismissal of stale approvals and blocked force pushes/deletions. Verify branch rules through GitHub after enabling them. Keep required checks compatible with path filtering, or remove the filter before making that check globally required. Require the exact candidate SHA and its successful jobs at deployment. Gitleaks history matches require private review and documented disposition before release.
