# Sandbox.co.in DigiLocker customer KYC — test-mode implementation

## Security / release status
Feature branch implementation only. **Do not merge or deploy without reviewing pending customer_digilocker_sessions.sql migration and completing provider/device acceptance.** No production credentials, payments, or live database were changed by this PR. DigiLocker session initiation stays **disabled by default** and cannot use Sandbox's production host.

Provider API contracts (26 Oct 2026):
- POST `https://test-api.sandbox.co.in/authenticate` with server-only `x-api-key` and `x-api-secret`.
- POST `/kyc/digilocker/sessions/init` with `@entity=in.co.sandbox.kyc.digilocker.session.request`, `flow=signin`, `doc_types=["aadhaar"]` and registered `redirect_url=https://trackmyrmc.com/kyc/return`.
- GET `/kyc/digilocker/sessions/{session_id}/status`; GET `/kyc/digilocker/sessions/{session_id}/documents/aadhaar` and GET `/kyc/digilocker/sessions/{session_id}/user/profile` after explicit completed consent. Document metadata must attest UIDAI issuer; no file download.

Docs:
- https://developer.sandbox.co.in/api-reference/authenticate
- https://developer.sandbox.co.in/api-reference/kyc/digilocker/endpoints/initiate_session
- https://developer.sandbox.co.in/api-reference/kyc/digilocker/endpoints/session_status
- https://developer.sandbox.co.in/api-reference/kyc/digilocker/endpoints/user_profile
- https://developer.sandbox.co.in/api-reference/kyc/digilocker/endpoints/fetch_document

## Required environment (server-only; NO EXPO_PUBLIC_ values)
- `TRACKMYRMC_KYC_ENABLED=true` (default absent => closed)
- `TRACKMYRMC_KYC_ENV=sandbox` (only accepted value; fixed test-api host)
- `SANDBOX_KYC_API_KEY` (Sandbox dashboard test-environment credential)
- `SANDBOX_KYC_API_SECRET` (Sandbox dashboard test-environment credential)

**Never** paste credentials into GitHub, app bundles, docs, CI logs or issue comments. Secrets must come from approved secret storage. In the current release do not set these fields on the production instance without approval. Register the exact public callback origin with Sandbox in the test workspace.

## Flow and trust boundaries
1. Authenticated active Customer starts `POST /api/customer/kyc/start`. Acquire customer row lock, allow one session in progress, enforce 65s retry cooldown, and persist a session owner before contacting provider.
2. Authenticate server-to-server, create test DigiLocker session, validate provider-supplied HTTPS authorization URL against DigiLocker host allowlist; return URL to browser without exposing server credentials.
3. DigiLocker returns to the existing informational `/kyc/return` deep-link trampoline. It **never** accepts query parameters as evidence of consent or verification.
4. Only authenticated owner `GET /api/customer/kyc` polls the recorded provider session ID (not a user-supplied ID). Unknown/failed provider statuses do **not** confirm identity.
5. After explicit provider consent, verify that Aadhaar is among consented documents by checking UIDAI issuer metadata (without downloading the document), then retrieve profile. Enforce `eaadhaar=true` and exact normalized name match to registered account, plus matching 10-digit Indian mobile. Save only `verified_name`, minimal session status, provider session ID and audit metadata; never store Aadhaar, address, photo, XML or raw provider response.
6. This sets `PENDING`, **not VERIFIED**. The already-approved `/api/staff/customers/:customer_id/kyc/approve` Authority session gate (PR #110) remains mandatory. Normal customer order KYC enforcement remains server-side.
7. Failed/mismatched consent returns `REQUIRES_REVERIFICATION`. Existing approved users remain approved (provider polling never downgrades a verified profile).

## Prior-to-merge checklist
- Review ops/pending-migrations/customer_digilocker_sessions.sql and only after approval assign the next free SQLx version. Test on an isolated Postgres database and verify rollback.
- Run Backend CI Postgres 16/18 including Rust tests, Frontend CI, Android builds, and security lint. Run negative tests for concurrent start, provider timeout, consent denial, mismatch, replay, and cross-customer read.
- Obtain approval to configure test credentials and perform an authorized DigiLocker sandbox session with a consenting test identity. Provider may use different demo fields/status names; confirm against actual contracted responses before enabling.
- Check browser and Android App Link return and `/kyc` refresh. Confirm Authority review records audit and only after approval can customer place order.
- Do not switch to `api.sandbox.co.in` or make live identity verification requests in this PR. Production integration needs separate explicit approval and a privacy/data-retention review.

## Known limitation
No signed provider callback is processed; vendor's documented, authenticated **session-status polling** is authoritative. Browser return is only navigation. Live provider acceptance, test subscription entitlements and callback registration were not exercised by this change.

The draft PR intentionally stores DDL in `ops/pending-migrations/customer_digilocker_sessions.sql`. Existing production PostgreSQL schema is unchanged. **The test feature cannot be enabled until the DDL is reviewed, versioned and applied to an isolated test DB.**
