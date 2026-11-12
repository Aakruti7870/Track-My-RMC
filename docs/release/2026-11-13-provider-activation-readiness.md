# TrackMyRMC provider activation readiness — 13 November 2026

**Status: PREPARATION ONLY / NO LIVE ACTIVATION.** This review changes source and release validation on a feature branch. It does not authorize production deployment, a DigiLocker identity session, customer WhatsApp delivery, or outbound CRM campaigns.

## Inspected baseline

- Repository: `Aakruti7870/Track-My-RMC`, main SHA `77279ce6bbdb53632335f846f6d6166089da6522` at the time of the read-only check.
- AWS account: `260234292958`, region `ap-south-1`. EC2 `i-0598aad6e6d729c69` is running; RDS `trackmyrmc-postgres` is available.
- Read-only SSM release check: backend service `active`, `/health` HTTP 200, deployed SHA matches the main baseline. Runtime flags show `TRACKMYRMC_KYC_ENABLED=false`, `TRACKMYRMC_KYC_ENV=sandbox`, `TRACKMYRMC_KYC_LIVE_APPROVED=false`.
- AWS Secrets Manager `trackmyrmc/app-runtime`: Live KYC key pair, Test KYC key pair, Meta WhatsApp token, sender Phone ID and WABA ID are **present**. Presence alone does not establish provider entitlement, template approval, valid credentials or permission to send.
- Prior to this branch, the secret did **not** contain `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_DISPATCH_TEMPLATE_NAME`, `META_MARKETING_TEMPLATE_NAME`, `DISPATCH_WHATSAPP_ENABLED`, `ADMIN_MARKETING_SEND_ENABLED`, or `DISPATCH_WHATSAPP_MARKETING_ENABLED`.
- Read-only Meta Graph query from EC2 returned HTTP 200 for the WABA template listing and WABA subscribed-apps listing. The **first returned template page** did not contain the two expected TrackMyRMC template names. The subscription response contained **zero subscribed apps**. Check exact-name template queries and any pagination with an authorized Meta operator; absence on one page does not prove that the templates do not exist.
- **Not verified:** Sandbox Live subscription, billing/quota, successful Live authentication, verified KYC return registration inside provider console, real identity consent, WABA template approvals, production Meta billing, webhook signature receipt, real WhatsApp delivery, or a CRM campaign send. No identity session or customer message was initiated.

## Implemented behind fail-closed gates in this PR

1. Deploy script reads independent boolean switches from the existing Secrets Manager app secret, accepts only JSON booleans or exact `"true"`/`"false"`, and defaults all four flags to `false`: `DISPATCH_WHATSAPP_ENABLED`, `DISPATCH_WHATSAPP_MARKETING_ENABLED`, `ADMIN_MARKETING_SEND_ENABLED`, `ADMIN_WHATSAPP_REPLIES_ENABLED`.
2. Deploy script validates and injects `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, Utility/Marketing template names and locales. Activating a sender without signed webhook configuration is rejected before the service restarts. An enabled dispatch worker also needs a configured Utility template; dispatch-triggered promotion additionally needs the Utility worker and a separate Marketing template. These are **configuration checks, not proof of provider approval**.
3. CRM overview now reports the backend's actual `ADMIN_MARKETING_SEND_ENABLED` state; it no longer hardcodes `send_enabled=false`.
4. Super Admin Marketing CRM adds explicit per-contact consent evidence with recent MFA; separately reviewed Meta template approval; an operator-confirmed campaign launch only when the backend send gate is on; and audited cancellation.
5. Offline Python unit tests exercise the fail-closed deployment shell fragment with synthetic tokens. Browser regression tests exercise opt-in audit, approve, cancel, and disabled-launch isolation with mocked HTTP responses. None of these tests contacts a real recipient.

## Provider prerequisites and independent release approval

### DigiLocker (KYC)

- Confirm Live subscription **active**, key state `Active`, appropriate DigiLocker entitlement, nonexhausted quota/wallet and terms in the Sandbox console. Live keys may exist for an inactive trial.
- Using authorized operator access, perform non-identity Live authentication with `ops/release/verify-digilocker-credentials.py`; do not log or paste credentials, response bodies, or tokens.
- Confirm registered exact return `https://trackmyrmc.com/kyc/return`.
- Confirm additive migrations `0040` and `0041`, restoration/rollback plan, and real-device consent followed by human Authority review.
- Only **after a separate explicit release approval**, set `TRACKMYRMC_KYC_ENABLED=true`, `TRACKMYRMC_KYC_ENV=live`, `TRACKMYRMC_KYC_LIVE_APPROVED=true`; deploy approved SHA and complete monitored consent acceptance. Release gates are independent of AAB/Play publication.

### Meta WhatsApp Utility dispatch

- The existing Meta dashboard callback is `https://trackmyrmc.com/api/meta/whatsapp/webhook`. **Preserve this URL**. This PR maps it to the same signed webhook handler as the new `/api/meta/dispatch-webhook` endpoint. Do not change Meta's callback to the dispatch path merely to activate dispatch. After the reviewed code is deployed, configure the WABA webhook subscription for messages and status changes, an App Secret and a random verification token. Confirm the callback HMAC/GET challenge using Meta's configuration flow.
- Obtain Meta approval for `trackmyrmc_trip_dispatched` in **UTILITY**, locale `en_US`, with six body parameters matching the Rust sender. Validate sender entitlement and Meta billing/quality/limits. A name saved in Secrets Manager is not template approval.
- Customer delivery consent and the plant's own WhatsApp delivery preference remain independently required. The worker is activated by `DISPATCH_WHATSAPP_ENABLED=true` **only after separate release authorization**. The send occurs on confirmed dispatch, not challan preparation. Verify test load, duplicate suppression, a public signed link, and signed `accepted`→`sent`→`delivered/read` statuses; never treat API acceptance as customer receipt.

### Super Admin Marketing CRM campaigns

- Confirm the WABA has a Meta-**APPROVED MARKETING** template for the selected locale; confirm account billing/limits and actual opt-in evidence for each contact. CSV import never grants consent.
- Verify migration `20261111011000_admin_marketing_delivery.sql`, campaign lifecycle, cancellation, STOP opt-out, rate limits, tenant isolation, Central Admin MFA and audit records.
- `ADMIN_MARKETING_SEND_ENABLED` is independent of dispatch Utility and of dispatch-triggered promotions; the latter stay off unless separately approved. **Only after separate release authorization** enable `ADMIN_MARKETING_SEND_ENABLED=true` and send a small controlled test campaign to consenting recipients.
- Do not activate `ADMIN_WHATSAPP_REPLIES_ENABLED` or `DISPATCH_WHATSAPP_MARKETING_ENABLED` merely as a byproduct of the CRM/Utility work.

## Release and rollback gate

1. Review PR diff, check Python unit tests, shell syntax, PostgreSQL 16/18 Rust CI, Frontend CI / real-browser Admin workspace, dependency audit and least-privilege CI.
2. Confirm exact current `main` SHA, approved release variable, actual live migration ledger, backups, operational monitoring, negative auth/consent tests and secure provider callbacks.
3. Deploy **dormant** code first with all outbound workers disabled; confirm deployed SHA, `/health`, signed webhook readiness and server permission isolation.
4. Require explicit approval **for each** provider enablement. Change only that service's flags; redeploy the exact authorized SHA so systemd reloads environment.
5. On incident, set only the affected feature flag to `false`, controlled redeploy and verify worker no longer starts. Never drop historical KYC/CRM audit or message outbox tables. A disabled flag does not unsend an in-flight Meta message.

## Provider documentation

- [Sandbox Live/Test keys](https://help.sandbox.co.in/portal/en/kb/articles/generate-your-api-keys)
- [Sandbox Test and Live hostnames](https://help.sandbox.co.in/portal/en/kb/articles/sandbox-test-environment)
- [Sandbox API key lifecycle](https://help.sandbox.co.in/portal/en/kb/articles/api-key-lifecycle)
- [Meta WhatsApp Business policy](https://whatsappbusiness.com/policy/)
- Repository runbooks: `docs/release/digilocker-live-activation-20261105.md`, `docs/whatsapp-dispatch-and-marketing.md`.
