# TrackMyRMC Production Audit and Remediation Plan

Audit baseline: 2026-10-10
Repository: `Aakruti7870/Track-My-RMC`
Production region: `ap-south-1`
Production EC2: `i-0598aad6e6d729c69`
Production database: RDS PostgreSQL `trackmyrmc-postgres`

## Execution flow

```mermaid
flowchart TD
    A[Inventory repository and AWS resources] --> B[Capture read-only production baseline]
    B --> C{Origin API and DB healthy over HTTP?}
    C -- No --> D[Diagnose service, DB connectivity, migrations]
    C -- Yes --> E[Fix TLS and reverse-proxy configuration in deployment script]
    D --> E
    E --> F[Preserve DB target; verify migration gate]
    F --> G[Run Rust, frontend, admin, security and contract checks]
    G --> H{All CI checks pass?}
    H -- No --> I[Fix failing code/tests on remediation branch]
    I --> G
    H -- Yes --> J[Review diff and production release gates]
    J --> K[Deploy via GitHub OIDC and SSM]
    K --> L[Verify HTTPS apex, API health, frontend assets; check www/Render separately]
    L --> M[Verify OTP delivery and role-based auth end-to-end]
    M --> N[Audit module parity and data migration evidence]
    N --> O{All release gates pass?}
    O -- No --> I
    O -- Yes --> P[Document evidence, rollback path, and release status]
```

## Baseline confirmed so far

- Local Windows checkout and GitHub CLI authentication are working; local `main` matches remote `main` at `38fc9fc824d711d0fafe9dbd9e26d4d4de371259`.
- Production EC2 is running in Mumbai region (`ap-south-1`), SSM reports the instance online, and the artifact bucket exists.
- RDS PostgreSQL is available, private, encrypted, has deletion protection enabled, and has a seven-day backup retention period.
- EC2-local HTTP health returns `status=ok`, `database=connected`. This is not proof of correct database selection or data parity.
- The current deployment script writes an Nginx HTTP-only server block. No origin certificate was found under the checked Let's Encrypt/SSL paths; public HTTPS previously returned Cloudflare 521.
- Cloudflare DNS currently points apex `trackmyrmc.com` to EC2 `13.203.215.125` (proxied), but `www.trackmyrmc.com` is a proxied CNAME to `trackmyrmc-frontend.onrender.com`. The deployment must not assume apex and www terminate on the same origin; DNS was not changed. Cloudflare SSL mode is Full (strict), Always Use HTTPS is off, and automatic HTTPS rewrites are on.
- The AWS deploy workflow builds and deploys `frontend/` and `backend/` but does not package/deploy `admin-web/`; the admin dashboard is currently CI-buildable but has no deployment target configured in this workflow.
- The Rust route table does not expose WebAuthn/passkey endpoints, but the original mobile UI offered passkey login/enrollment that called those absent endpoints. The remediation branch disables the unsupported Expo routes and directs staff to implemented email OTP + TOTP/recovery instead.
- WhatsApp OTP was pinned to Meta Graph API v20.0, whose published expiry date was 24 September 2026. The remediation branch changes the client to configurable `META_GRAPH_API_VERSION` with v26.0 as the default; provider credential validity and an actual test OTP still require a safe live integration test.
- The Play Store readiness script was written against the removed Python backend. It is now aligned to the Rust project and explicitly checks required release endpoints. The current Rust router still lacks `/api/auth/play-review`, `/api/account-deletion/public-request`, and `/.well-known/assetlinks.json`; Android Play submission remains blocked until these contracts and isolated review fixtures are implemented and tested.
- The admin dashboard can now be built in CI, but the production deployment workflow has no admin hosting target and `/api/admin/auth/login` intentionally fails closed until the admin UI uses the implemented challenge-bound email OTP plus TOTP/recovery flow. The hardcoded privileged email was removed from the handler.
- The deploy script builds `DATABASE_URL` with database name `postgres`; the RDS instance metadata names `trackmyrmc` as the application database. This mismatch must be resolved and the actual live DB target verified before cutover.
- The workflow can create `trackmyrmc/app-runtime` with blank provider credentials if the secret is absent. Production OTP delivery must be checked without printing secret values.
- The current module parity audit documents major missing or partial Rust API domains compared with the original FastAPI/MongoDB implementation. A health endpoint does not establish functional parity.
- A read-only SSM diagnostic confirmed both the backend and Nginx services are active and the Nginx configuration parses. The production runtime secret contains keys for WhatsApp and email providers; key presence alone does not prove provider credentials work.

## Phased work and release gates

1. **Repository inventory:** inspect route registration, auth services, DB pool/migrations, mobile/admin clients, CI workflows, deployment script, and module-parity audit.
2. **Production baseline:** capture service status, listener ports, Nginx configuration, TLS files, SSM health, secret key presence only, DB name/migration status, and HTTP/HTTPS behavior. Never print credentials or personal data.
3. **Availability and database fixes:** make apex TLS provisioning persistent across every deployment; keep Cloudflare Full (strict); preserve the live database target (`postgres`) until the `trackmyrmc` database has a verified backup and data/migration parity; then perform an explicitly authorized cutover. Do not change DNS as part of the HTTPS fix.
4. **Automated verification:** Rust format/check/clippy/tests, frontend typecheck and route/policy checks, admin build, deployment workflow validation, and targeted auth/OTP tests.
5. **Deploy from a review branch:** deploy only after CI passes; use existing GitHub OIDC/SSM deployment path; capture release SHA and SSM command result.
6. **Live smoke tests:** HTTPS apex health, API response, frontend index/assets, redirects, TLS validity/hostname, and rollback readiness. Verify the separately hosted `www`/Render frontend independently; do not test it as though it were the EC2 API.
7. **Authentication:** test customer/driver WhatsApp OTP and staff email OTP→TOTP/recovery using authorized test accounts; complete admin challenge-bound MFA; verify failures/rate limits/session revocation. Never disclose OTPs/tokens.
8. **Store/admin release gates:** implement and test isolated Play review accounts and fixtures, public account-deletion request, Android asset-links endpoint, and admin MFA/hosting. Do not claim Play Store or admin portal readiness until these pass.
9. **Parity/data audit:** compare source domains and Rust route coverage, verify production schema/migration state and record-count/relationship evidence before declaring migration complete.
10. **Release decision:** mark each gate PASS/FAIL/NOT VERIFIED with evidence; do not claim production-ready while any critical gate is unverified.

## Safety constraints

- Do not print or commit runtime secrets, database credentials, OTPs, personal records, or provider tokens.
- Do not modify DNS or weaken Cloudflare SSL mode.
- Do not run destructive migrations, truncate/delete production data, disable database deletion protection, or force-push.
- Keep changes on `fix/production-audit-and-https` until CI and diff review are complete.
- Any deployment must retain a known-good release artifact and be reversible.
