# DigiLocker Aadhaar document 403 remediation — 2026-11-15

## Verified production evidence
- Live environment credentials are configured; authentication, session initialization and
  session status can succeed. This **does not** demonstrate the document endpoint is entitled.
- An existing Live session returned `data.status=succeeded` and
  `data.documents_consented`. The previous adapter ignored the latter.
- AWS logs show HTTP 403 at `AADHAAR_DOCUMENT`. Sandbox transaction history
  showed two successful and numerous forbidden document requests.
- The exact upstream 403 denial reason (consent, account entitlement, quota, or
  permission) remains **unconfirmed**; a code patch cannot guarantee access.

## Scope
- Explicitly require consented Aadhaar in the provider session-status response.
- Send `x-api-version: 1.0.0` on legacy authenticated DigiLocker API requests,
  based on official Postman examples and a read-only Live status call.
- Persist a terminal failure for **the specific attempt** after document HTTP 403,
  stop polling/repeating the forbidden GET, and show an actionable UI message.
- Preserve UIDAI issuer check, strict account name/mobile matching, Live approval
  audit checks, revoked-approval handling, and all order/payment/dispatch guards.
- No identity documents, access tokens, authorization URLs or provider response
  bodies are logged. No browser redirect may authorize KYC.

## Remaining provider acceptance gate
1. Open a failing Sandbox transaction and obtain its non-PII provider error
   code and access explanation. Compare with a successful document transaction.
2. Verify product **Live document retrieval** entitlement, wallet/billing,
   consented doc type, session expiry, account scope and required API version.
3. With explicit customer consent, execute one new Live end-to-end test:
   successful session + Aadhaar in `documents_consented` + permitted document
   response with UIDAI issuer + exact profile name/mobile match + effective
   VERIFIED + authorized order guard.
4. Negative tests: missing/malformed consent, 403, expired session, denied
   consent, mismatch, revocation and duplicate polling. Validate SQL migration
   and rollback in staging before production deployment.

## Security release gate
Do **not** treat this patch as proof the provider 403 is eliminated. Do not
merge/deploy while required checks fail. Do not weaken `LIVE_APPROVAL_SQL`,
force a user profile to VERIFIED, or skip document evidence to hide the error.

Sources:
- https://sandbox-docs.readme.io/reference/digilocker-api-session-status
- https://www.postman.com/in-co-sandbox/sandbox-api/documentation/t61ohmi/kyc
- https://sandbox.co.in/digital-locker
