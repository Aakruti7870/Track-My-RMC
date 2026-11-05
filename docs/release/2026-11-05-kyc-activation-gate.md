# TrackMyRMC DigiLocker KYC — 2026-11-05 activation gate

## Live evidence (read-only)

- AWS production account `260234292958`, EC2 `i-0598aad6e6d729c69`: backend, Nginx, and RDS recovery timer active; trusted-origin /health OK.
- Deployment marker at diagnosis: `510b4526db252bc8fe1e54cd31e52e4e0b074e55`, running DB `postgres`.
- SQLx migration maximum: `0040`; the KYC sessions table has an additive schema migration at `backend/migrations/0040_customer_digilocker_sessions.sql`.
- Effective deployed `TRACKMYRMC_KYC_ENABLED=false`; `TRACKMYRMC_KYC_ENV=disabled`.
- Secrets Manager `trackmyrmc/app-runtime`: generic `KYC_API_KEY` / `KYC_API_SECRET` present, **no** separate `SANDBOX_KYC_API_KEY` / `SANDBOX_KYC_API_SECRET` values or explicit KYC activation flags. Credential presence does **not** prove that they belong to the test environment.
- Sandbox provider confirmed the **Startup account plan is active again on 2026-11-05**. This removes the subscription suspension but does not prove the existing generic KYC credentials are for the test environment, or that DigiLocker API entitlement is active.
- Provider sandbox authentication, registered callback, consent journey, and reviewer acceptance **not verified**. Do not mark enabled.

## Changes staged in the accompanying PR

- When `GET /api/customer/kyc` returns `provider: "unavailable"`, customer UI preserves the stored KYC status, shows an explanation, and offers **Check DigiLocker Availability** rather than a broken start action. Existing VERIFIED users retain Back to Home.
- Login screen's references to deleted JPG banner files now point to existing user-supplied PNG assets. This addresses Frontend CI web bundling error `Unable to resolve module ../../assets/images/login-hero-light.jpg`.
- Add a CI guard for provider-unavailable state and login asset references.
- **No AAB trigger, no source signing changes, no production database write, no real identity submission.**

## Safe sandbox-only activation sequence (not yet executed)

1. Confirm KYC API access and **test workspace** subscription for DigiLocker with the Sandbox provider. In Sandbox Console → Settings → API Keys, generate/select **Test** credentials and save them only in AWS Secrets Manager fields `SANDBOX_KYC_API_KEY` and `SANDBOX_KYC_API_SECRET` without printing or committing them. Existing generic KYC keys might be live and cannot be used as fallback. See https://help.sandbox.co.in/portal/en/kb/articles/generate-your-api-keys.
2. Verify test credentials by authenticating at `https://test-api.sandbox.co.in/authenticate` with no personal data; confirm test entitlement. Run the redacted preflight `python3 ops/release/verify-sandbox-digilocker-auth.py` **only with the explicitly configured Test credentials in its process environment**. The script prints only `SANDBOX_AUTH=PASS/FAIL` and never a token. Do not use or test against the live API host.
3. Verify the configured callback in the provider test workspace is exactly `https://trackmyrmc.com/kyc/return` and the public return path works in Chrome and Android; test return never itself verifies KYC.
4. Verify production SQLx migration 0040 and table using read-only probes; confirm recent restorable backup/restore plan before a feature that will write new KYC session records.
5. Add `TRACKMYRMC_KYC_ENABLED=true` and `TRACKMYRMC_KYC_ENV=sandbox` to the AWS runtime secret **only after** steps 1–4 succeed; perform a controlled backend service deploy/restart to pick up the environment, not an Android AAB release.
6. Execute a consenting test-customer journey: start, redirect, poll, UIDAI-issued Aadhaar metadata, exact account name/mobile match, `PENDING` reviewer approval, and ordering gate. Test denied consent, timeout, mismatch and duplicate/replay. No Aadhaar data should appear in application logs or database.
7. If any provider or callback test fails, set `TRACKMYRMC_KYC_ENABLED=false` and re-deploy the flag; never treat callback query params as verified identity.

## Release hold

User explicitly requested **no further Android .aab build without confirmation**. KYC fix and infrastructure diagnostics are separate. Android Signed Release AAB run `42048986865` was already triggered by an earlier merge and was still in progress at the latest GitHub check; no new AAB workflow was started by this change. The installed GitHub connector does not expose a workflow cancel operation; operator can open that Actions run and choose `Cancel workflow` if still available.
