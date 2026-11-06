# TrackMyRMC Smart RFQ — Implementation & Work Handoff

## Status and scope (2026-11-06)
This feature branch implements a first-pass customer RFQ capture flow for Google-sourced and approved plants.
It does **not** activate external supplier messaging, live charges, production migration or deployment.
The PR remains a **draft** until automated + staging verification passes.

## Business logic
1. Customer opens **Nearby Plants → Request Quotation** and completes one shared requirement form.
2. Mandatory: authenticated customer, selected plant/Google Place ID, customer name, grade, quantity
   (0.01–10,000 m³, <=2 decimal places), site address, delivery date, site contact,
   and explicit permission for subsequent supplier sharing. Optional: email, GSTIN, map pin.
3. Google listing without approved TrackMyRMC registration: validate Google Place ID server-side,
   create `rmc_rfq_leads` status `PENDING_SUPPLIER`, notify *admin only*, and display honest
   non-delivery wording. **Do not** copy Google listing phone/address/name into persistent storage.
4. Approved plant: create canonical `customer_quotation_requests`, enriched lead record, owner
   in-app notification; existing owner/authorised-staff RFQ quoting continues unchanged.
5. On plant approval, existing `google_plant_quote_interests` transition to `MATCHED`, while
   rich leads transition to `MATCHED_RECONFIRMATION_REQUIRED`. Notify the original customer.
6. An authenticated customer reconfirms the matching lead before personal data becomes
   visible to the plant. The canonical RFQ is created atomically with the lead update.
7. Lead IDs are server UUIDs. Client-generated request keys are scoped to the authenticated
   customer for idempotency, not used as an authentication credential.
8. The owner quotation UI shows contact, GST, delivery date, site, grade and quantity only
   for approved plant RFQs; backend plant-scoped authorization still applies.

## New schema and API
- Migration: `backend/migrations/0044_smart_rmc_rfq_leads.sql`
- `POST /api/customer/rmc-rfq-leads`: validated authenticated customer creation.
- `GET /api/customer/rmc-rfq-leads`: authenticated own lead history only.
- `POST /api/customer/rmc-rfq-leads/:lead_id/confirm`: authenticated customer reconfirmation.
- `GET /api/admin/rmc-rfq-leads`: admin-only records for assistance and follow-ups.
- Legacy `POST /api/customer/quotation-requests` remains compatible.
- Existing `GET /api/ops/plants/:plant_id/quotation-requests` receives enriched approved lead fields.
- UI: `/customer/request-quotation`, `/customer/quotations`, `/admin/rmc-rfq-leads`.

## WhatsApp: required next tranche, **not implemented**
There are no new WhatsApp sends in this PR. Existing `trackmyrmc_login_otp` template is for
authentication only; **never** repurpose it for invitations or commercial enquiries.

Implement separately behind `RMC_RFQ_WHATSAPP_ENABLED=false`:
- Consent table scoped to individual opted-in plant owner/staff phone, source, timestamp, template
  categories, opt-out and auditable consent withdrawal.
- Separate Meta-approved supplier onboarding/invitation (Marketing) and registered RFQ notification
  (Utility candidate) templates, category pending Meta decision.
- Sender identity from `META_PHONE_NUMBER_ID` / Meta Graph API, never hardcode or expose secrets.
- Only message registered/consented selected supplier(s), not all plants and never a Google Maps
  scraped number. Public listing phone does NOT establish WhatsApp opt-in.
- Approved template, provider API health, quality/account messaging limits and configured allowed
  recipients are mandatory before enabling real sends.
- Durable outbox keyed by (`lead_id`, `recipient_user_id`, `template`) with queued, accepted,
  delivered, read, failed, suppressed, and opted-out states.
- Signed Meta webhook verification and idempotency; retry transient failures with bounded backoff;
  never show "delivered" from a 200/accepted-only API response.
- Suppression and consent checks both at enqueue and immediately before send; no PII in logs.
- Cost counters / daily budget limits; disable flag and incident runbook.
- A supplier invitation link is independently signed, expiring, single-use where appropriate,
  and shows no customer details until authenticated plant ownership/admin approval.
- Meta template message should carry only a non-sensitive RFQ reference and link to authenticated
  dashboard. Avoid GSTIN, site phone, or full site address in WhatsApp text.

## Before any production release
- Verify current Google Places API terms, proper autocomplete session tokens and billing use,
  field masking, client/server key restrictions, attribution, rate-limits and caching boundaries.
- Add full consent revocation and account-deletion retention rules for `rmc_rfq_leads`.
- Implement admin follow-up actions (assignment, outreach method, contacted timestamp, lead
  closure and customer follow-up) with audit logs and RBAC.
- Implement staff notification routing based on actual `quotations` permissions;
  owner notification is in-app in this first tranche.
- Add Play/website privacy disclosure and verify users can see/share/revoke personal-data consent.
- Add onboarding reconfirmation expiration UI; customers should not reconfirm past-date delivery.
- Validate concurrency and request-key idempotency across simultaneous submissions.
- Add integration tests for unregistered, approved, reconfirmation, expired, duplicate submissions,
  malformed Google Place ID, failed Google response, wrong tenant, unauthenticated, non-admin
  dashboard access, tampered quote, rate limiting and no supplier contact before approval.
- Verify migration on PostgreSQL 16 and 18 in isolated test databases.
- Run `cargo fmt --all -- --check`, `cargo check --all-targets`,
  `cargo clippy --all-targets -- -D warnings`, `cargo test --all` in `backend`.
- Run `npm run typecheck`, `npm run lint`, module routing checks and preview build in `frontend`.
- Run real device/browser QA: Android, responsive web, owner/authorised staff, admin, pending
  onboarding, reconfirmation, offline/retry and accessibility. Confirm exact Google Place matching.
- Inspect GitHub Actions job logs; fix all failures; do not bypass security or skip tests.
- Do not merge/deploy or activate paid AWS/Meta services until acceptance and explicit approval.

## Recommended Work mode instruction
Continue from branch `feat/smart-rfq-leads-onboarding-20261106` in repository
`Aakruti7870/Track-My-RMC`. Perform code review first, repair Rust/TypeScript/SQL errors,
run the required CI + PostgreSQL 16/18 validation, add admin workflow and secure WhatsApp
outbox with consent and Meta webhook handling but keep sends disabled, then prepare evidence.
Do not alter authentication, pricing, Cashfree, KYC, existing order or security boundaries.
No merge, deployment, production database writes or live WhatsApp sends without separate approval.
