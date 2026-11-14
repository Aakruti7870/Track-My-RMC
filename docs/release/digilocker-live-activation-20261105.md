# DigiLocker live KYC — release and activation contract

**Status:** Live activation requires separate operational approval. This code path automatically completes KYC after verified Live consent and strict identity match; deployment and Android signing remain separate.

## Provider and environment

Sandbox distinguishes **Test** and **Live** API keys and hosts:

| Setting | Test | Live |
| --- | --- | --- |
| Base URL | `https://test-api.sandbox.co.in` | `https://api.sandbox.co.in` |
| API key in AWS | `SANDBOX_KYC_API_KEY` | `LIVE_KYC_API_KEY` |
| API secret in AWS | `SANDBOX_KYC_API_SECRET` | `LIVE_KYC_API_SECRET` |
| Mode | `TRACKMYRMC_KYC_ENV=sandbox` | `TRACKMYRMC_KYC_ENV=live` |
| Additional approval | n/a | `TRACKMYRMC_KYC_LIVE_APPROVED=true` |

Both modes additionally require `TRACKMYRMC_KYC_ENABLED=true`. The default is OFF, and missing or mixed keys cause closed failure. **Legacy** `KYC_API_KEY` and `KYC_API_SECRET` are never used as fallback. Do not re-label Test credentials as Live keys. Refer to official provider docs:
- https://help.sandbox.co.in/portal/en/kb/articles/generate-your-api-keys
- https://help.sandbox.co.in/portal/en/kb/articles/sandbox-test-environment
- https://developer.sandbox.co.in/api-reference/kyc/digilocker/endpoints/initiate_session

Only the server reads credentials from existing Secrets Manager `trackmyrmc/app-runtime`. No `EXPO_PUBLIC_` key, GitHub secret, browser key, mobile key, or credential in user-visible logs.

## Pre-release evidence, required before live KYC is enabled

1. Confirm Sandbox subscription and **DigiLocker Live** entitlement, API wallet and charges. Do not create payment transactions as part of this readiness check.
2. Confirm the correct Live API key pair in Sandbox Console → Settings → API Keys → **Live**. Save to `LIVE_KYC_API_KEY` and `LIVE_KYC_API_SECRET` in Secrets Manager. Preserve existing Test keys and do not copy Test keys into Live fields.
3. Authenticate against `https://api.sandbox.co.in/authenticate` using Live credentials. Require HTTP 200, JSON `code=200` and nonempty `data.access_token`. Do **not** print token or response. A successful Test-authentication call does not satisfy this step.
4. Confirm the exact consent return URL `https://trackmyrmc.com/kyc/return` in provider Live workspace. It is a browser navigation trampoline, never evidence of identity verification.
5. Verify production database backups, migration `0040`, and reviewed additive migration `0041_digilocker_provider_environment.sql` in a staging database. Existing historical sessions default to `sandbox`.
6. Run Backend CI on PostgreSQL 16 and 18, frontend/typecheck/browser CI, negative KYC tests, and security review. Do not bypass failed release checks.
7. Deploy a SHA-pinned release **with the KYC feature switch OFF**; verify /health, /kyc/return, auth guard, SQLx migration and release marker.
   - Live activation deployments now run the reviewed, redacted `verify-digilocker-credentials.py` against the fixed Live authentication endpoint **before** swapping backend binaries, runtime configuration, or restarting systemd. Missing/invalid Live credentials or provider outage abort the activation deployment. This is a non-identity authentication check; a valid token does not prove DigiLocker plan entitlements or a successful customer consent journey.
8. Only after steps 1–7 pass, activate `TRACKMYRMC_KYC_ENABLED=true`, `TRACKMYRMC_KYC_ENV=live`, and `TRACKMYRMC_KYC_LIVE_APPROVED=true` in Secrets Manager and perform a controlled backend redeploy to load that config. Do not silently do this through an Android AAB.
9. Perform an authorized, explicit-consent customer session from a real device: authenticated `POST /api/customer/kyc/start`; DigiLocker consent; authenticated `GET /api/customer/kyc`; UIDAI-issued Aadhaar metadata; profile name/mobile match; automatic **VERIFIED** status after a server-confirmed UIDAI document and exact customer name/mobile match; order eligibility. Confirm the older PENDING session upgrade only with its original matching server-generated consent audit. Confirm denial, stale session, mismatch, timeout, duplicate initiation, invalid API key and cross-user isolation. Do not log or persist identity documents or bearer tokens.
10. Record evidence for launch issue #106. This is the test of actual Live user verification; until complete, do not mark KYC production-ready.

## Implementation safety

- The backend uses fixed, reviewed HTTPS hosts; no client-controlled URL.
- `customer_digilocker_sessions.provider_environment` binds each session to its origin so an old Test session cannot be polled by the Live backend.
- Browser redirects do **not** update KYC status. Successful Live consent with UIDAI-issued Aadhaar metadata and strict customer name/mobile match creates an auditable automatic KYC approval in one database transaction; sandbox sessions remain review-pending. Earlier Live PENDING sessions are promoted only when their exact server-generated consent audit is present and no later reviewer decision exists. Reviewers retain rejection/reset authority, which invalidates automatic approval. Verification and order authorization still check the latest environment-matched audit. A provider error or identity mismatch never auto-approves.
- User profile names/phone numbers and consent records are sensitive. Never expose Aadhaar documents, presigned file URLs, OTPs, API keys, JWTs, or full responses in CI or production logs.
- Rollback: turn `TRACKMYRMC_KYC_ENABLED=false` in Secrets Manager, perform controlled backend deploy to read updated flag, confirm `/api/customer/kyc` returns stored status with `provider=unavailable`. Leave additive SQL migration in place; do not erase the audit trail.
