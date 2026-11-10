# Central Admin Command Center — architecture, deduplication and acceptance (2026-11-10)

## Status

Phase 1 was merged in PR #180 (main commit `07f80ecbf62b7e37499ea6ba04b7c32940724443`). Phase 2 is being developed separately, with AWS deployment explicitly blocked until whole-program acceptance. This file documents **code-level scope only**. It is not evidence of production activation, live Google Places configuration, real notifications, end-to-end approvals, or released marketing capability.

## Reconciled UX decisions, November 7–10, 2026

The highest Super Admin remains web-only; the Control Center uses existing React dark/glass layout, not a new design system. Keep Central Admin's email OTP → TOTP enrollment/verification and one-hour session. Do not add a password, mobile Admin role, duplicate Appearance toggle, another identity provider, or bypass privileged step-up.

| Navigation card | Authoritative display/action | Never attach |
| --- | --- | --- |
| Platform KPIs | Read-only `/api/control-center/summary` plus service health | Approval form or duplicate orders module |
| Notifications | Existing authenticated `/api/notifications`; notification opens matching approval workspace | Global unscoped push messages or new notification table |
| Approval Queue | Existing Owner onboarding, plant-profile section review, KYC review and supplier RFQ outreach | Automatic approval, new staff role, duplicate document upload screen |
| Plant Master | First-party plants; one selected plant shows Owner, staff, verification and intake policy | Raw Google contact dumps or new staff tables |
| TMRMC Verified | Trust decision inside selected plant, based on approved listing, published identification/licence and explicit expiring review | Google Places `businessStatus` or generic onboarding approval alone |
| Orders & RFQs | Existing order / quotation service and incoming-order policy | Automatic acceptance, payment or Cashfree subscription |
| Marketing & Broadcast | Consent-aware names/segments, bounded CSV upload, draft-only templates, later approved delivery | Unsolicited messaging, implicit opt-in, auto-created WhatsApp chat groups |
| Native Automation | Existing Rust/PostgreSQL templates and manual human review tasks | New external automation engine |
| Authority & Governance | Existing explicit web-only delegation, session revocation and audit | Unrestricted Authority/Super Admin role equivalence |

Owner/staff mobile automation may use 4–4–2 compact tiles, but this is **not** a web Super Admin responsive-layout requirement. Shared design principles are touch targets, consistent typography, one module per function and clean Home/More navigation.

### Phase 2 code-level status (not provider or production acceptance)

- Added explicit `plant_admin_controls` intake modes. Existing approved active plants default to `DIRECT`, preserving existing launch behavior; modes other than DIRECT block submitted orders at the Rust domain service. `ADMIN_REVIEW` currently redirects users to the **existing RFQ/manual review path**, not an invented admin-created order.
- Added `plant_trust_reviews` and per-plant governance read/decision, with recent TOTP step-up and audit. Trust is distinct from onboarding and published certificate review; the latter already has its own queue and evidence route.
- Added separate `admin_marketing_segments` / `contacts` / `memberships` / `campaign_drafts` stores: this is deliberate **new** data for a previously absent CRM, not a replacement for the existing order or support lead database.
- Contact imports are always `UNVERIFIED` by default and never modify existing consent or opt-out state; campaign records are `DRAFT` only. There is **no** provider send endpoint, approved campaign approval flow or outbound worker.
- Existing Plant Master detail opens governance in the same plant card; Marketing is a dedicated workspace from one navigation card. The UI uses the current admin font, colors, borders, inputs and responsive grid; no new frontend framework.
- Work remains for complete consent lifecycle, template/provider/webhook integration, audited marketing send approval, verified plant KPIs, central staff lifecycle delegation, RFQ case triage, multi-plant analytics and independent prelaunch tests. Do not deploy merely because CI compiles.

## Reuse and module ownership

| Business function | Existing source of truth | Phase 1 behavior |
| --- | --- | --- |
| Central Admin email OTP + authenticator | `backend/src/auth/control_center.rs` | Unchanged; one-hour web-only session, fixed entitlements |
| Owner onboarding | `backend/src/routes/plant_onboarding.rs` | Existing audited approval/rejection endpoints reused; notification recipients include `central_admin` |
| Unregistered supplier RFQs | `backend/src/routes/rmc_rfq_leads.rs` | Existing pending supplier workflow and customer reconfirmation unchanged; central notification added |
| Plant / owner / staff | `rmc_plants`, `users`, `plant_staff` | New read-only joined Plant Master list and detail, without new assignments table |
| Staff invitation / replacement | `backend/src/routes/staff_lifecycle.rs` | Owner or explicitly delegated manager remains the writer; role slots are not bypassed |
| Document verification | Existing plant-profile review queue | Continue through the MFA-step-up review API, distinct from onboarding approval |
| Global automation | Existing Rust Native Automation Center | Existing admin governance is retained; no external automation provider added |
| Customer / plant payments | Existing order and Cashfree guards | No new payment, subscription or checkout flows |
| Google Places | Existing server-side Places Text Search | Live results displayed with attribution, never bulk-imported or persisted as plant/marketing contacts |
| Notifications | Existing user-scoped notifications table and API | Web bell consumes existing feed; no separate notification store |

The Central Admin navigation no longer links to the generic `plants` collection when Plant Master is available. The Authority's separately authorized `plants` collection is retained; it has no new Central Admin privileges.

## Security and data design

- `GET /api/control-center/plants/master` and `GET /api/control-center/plants/:plant_id/master` both require `plant.view` **and** `user.view`. They use `WebAdmin` to enforce Central Admin web-MFA session provenance.
- Parameterized, bounded filters and explicit pagination avoid unbounded full-table responses.
- Source distinction: `onboarding_approved` reflects an approved listing; it **does not** establish current licence compliance, all plant certificates, Google ownership, order acceptance, or an eligibility to receive marketing.
- Google Places (New) bills by requested fields; retain minimal field mask, request limits, and provider attribution. Google API content must not become a reusable contact database. Retain only place IDs where product policy permits.
- Suppress private data from Authority and unauthenticated views. One plant's staff records must never be joined to another plant's detail.
- The primary Central Admin is an existing approved identity, not a generic `admin` user, so event notifications must target `central_admin` alongside backward-compatible operational admin recipients.
- Owner/staff identities are read-only in the new view. Reuse centralized audit, MFA and staff invitation lifecycle for any future Central Admin delegated modification.

## Target phases not represented as complete

1. **TMRMC Verified**: create independently reviewed document/identity/active-licence criteria and revocation/expiry policy. Never infer this from Google Places or an onboarding request alone.
2. **Controlled Orders**: plant-scoped intake policy `DIRECT`, `ADMIN_REVIEW`, `RFQ_ONLY`, `DISABLED` with explicit actor/transition tests. No confirmed order for unapproved suppliers; plant acceptance remains required.
3. **Marketing CRM**: upload validated CSV/XLSX **provided contacts**, deduplicate with normalized E.164 phone numbers, record opt-in evidence, suppression, revocation, owner-defined segments, and per-campaign approval. Contact segments are not WhatsApp chat groups; do not scrape Google Maps contacts.
4. **WhatsApp delivery**: separate provider setup and approved templates, lawful opted-in recipients, durable outbox, retries, dead-letter queue, send throttling, cost estimates, webhook delivery statuses, unsubscribe processing; no live messages before explicit approval.
5. **Plant analytics**: expand performance aggregates using existing plant-scoped orders, batch production, quality, workforce and finance models. Exclude reviewer fixtures and distinguish billing from receipts.
6. **Central staff administration**: any proposed admin write surface must invoke the *same* transactional slot and revocation logic as `staff_lifecycle.rs`, require a distinct permission and fresh MFA, and maintain the owner/manager delegation audit.

## Acceptance before merge or release

- Backend `cargo fmt --all -- --check`, Cargo Check, strict Clippy and PostgreSQL 16/18 tests.
- Admin `npm run build` and existing Playwright browser isolation at 390px/1440px.
- Confirm central_admin notification delivery from a real new onboarding and an unregistered-supplier RFQ on an isolated database. Confirm no notification is sent before a request is recorded.
- Verify `plant.view` without `user.view` cannot list private owner/staff records; verify authenticated `authority` cannot access Central Admin Plant Master.
- Check filters: case-insensitive search, invalid status/control characters, stable paging, nonexistent plant 404, Google Places failure, no key leakage to frontend, attribution.
- Independent API/provider acceptance, AWS release gating, database migration and rollback review remain separate.

## Reference links

- Google Places (New) field masks and price tiers: https://developers.google.com/maps/documentation/places/web-service/choose-fields
- Places content/attribution policy: https://developers.google.com/maps/documentation/places/web-service/policies
- Existing Central Admin / Authority contract: `docs/security/central-admin-authority-control-plane.md`
