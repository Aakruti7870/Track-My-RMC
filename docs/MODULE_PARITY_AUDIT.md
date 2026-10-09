# TrackMyRMC Original-to-Rust Module Parity Audit

Audit date: 2026-10-09

## Purpose and evidence boundary

The original `Aakruti7870/Tracking-project` FastAPI/MongoDB repository is the functional reference. The target `Aakruti7870/Track-My-RMC` Rust/Axum/PostgreSQL repository is the current migration target.

This is a source-code comparison, not proof of production data migration. No live MongoDB documents or PostgreSQL row counts were exposed by the files inspected for this audit. Do not treat development seeds or a healthy health endpoint as evidence that customer/plant/order records were migrated.

## Original backend domains

The original `backend/server.py` mounts these routers/domains: account deletion, automation, assistant, admin auth, admin portal, control center, auth, business UI, customer, driver, finance operations, HR master, KYC recovery, loads, maps, Meta WhatsApp, master data, current-user profile, notifications, operator operations, owner, payroll closure, payroll concurrency hotfix, payroll guard, permanent access, plant plans, plant discovery, plant onboarding, Play review, public policy, staff, staff auth, staff MFA, staff passkeys, storage, workforce, workforce reports, workforce roster, and attendance.

Original roles in `backend/roles.py` include customer, driver, plant owner, admin, dispatcher, operator, supervisor, accountant, quality engineer, fleet manager, store manager, authority, and central admin.

## Target Rust route surface verified in `backend/src/routes/mod.rs`

- Authentication/profile: register, login, current user, logout, WhatsApp OTP send/verify, email OTP send/verify, TOTP setup/verify/login.
- Customer: plant list, grades, customer sites list/create, orders list/create/detail.
- Driver: trips, location update, challan signing, proof of delivery.
- Dispatcher: plant fleet, load assignment, order status update.
- Owner: create plant, billing overview.
- Workforce/payroll: daily roster, attendance marking.
- Admin: admin login and portal overview.
- Health: health check.

The target explicitly does not expose WebAuthn passkey endpoints in `backend/src/routes/mod.rs` because full challenge/origin/RP-ID/signature/counter verification is not implemented.

## Parity findings

| Original capability | Target evidence | Status from inspected source |
|---|---|---|
| WhatsApp OTP for customer/driver | OTP send/verify routes in Rust auth | Present at route level; runtime delivery/login must be tested separately |
| Email OTP for staff/owner/admin | Email OTP routes and backward-compatible staff aliases | Present at route level; runtime delivery/login must be tested separately |
| TOTP MFA | TOTP setup/verify/login routes | Present at route level |
| Passkeys/WebAuthn | Explicitly not exposed pending full verification | Missing/not enabled |
| Customer plant discovery/listing | `GET /api/customer/plants` | Partial; original discovery/onboarding workflows are not represented by these routes |
| Customer sites | list/create | Partial |
| Orders | list/create/detail and status update | Partial; original order lifecycle/history and supporting workflows require route/service comparison |
| Driver trips/location | trip list and location update | Partial; route history and additional tracking flows need comparison |
| Challan/POD | sign challan and submit POD | Partial; storage/evidence workflows need comparison |
| Dispatcher/fleet/load | fleet list, assign load, status update | Partial |
| Owner plant/billing | create plant and billing overview | Partial; plans/promotions, plant onboarding, business profiles, quotations and finance workflows not represented in current route table |
| Workforce/payroll | roster and attendance marking | Partial; reports, payroll closure/guards/concurrency workflows are not represented in current route table |
| Admin/control center | admin login and portal overview | Partial; original control center, access management and security workspaces need implementation/parity verification |
| KYC/DigiLocker recovery | Original has KYC recovery/onboarding routes | No corresponding route in inspected Rust route table |
| Notifications | Original notifications router | No corresponding route in inspected Rust route table |
| Maps/live fleet map | Original maps router | No corresponding route in inspected Rust route table |
| Finance/invoices/payments | Original finance operations and billing domains | No corresponding route in inspected Rust route table |
| Automation/assistant | Original automation and assistant routers | No corresponding route in inspected Rust route table |
| Play review/public policy | Original Play review/public policy routers | No corresponding route in inspected Rust route table |
| Storage | Original storage router | No corresponding route in inspected Rust route table |
| Plant plans/promotions | Original plant plans router | No corresponding route in inspected Rust route table |
| HR/master data/operator workflows | Original HR, master data, operator routers | No corresponding route in inspected Rust route table |
| Account deletion | Original account deletion router | No corresponding route in inspected Rust route table |

## Production data verification still required

1. Read the production MongoDB connection/database name from the original runtime configuration without printing credentials.
2. Inspect MongoDB collection counts and representative schema metadata (no personal data dump).
3. Inspect PostgreSQL table counts and migration version on the target production database.
4. Compare counts and key relationships for users, plants, orders, order loads, mixers, trips/GPS telemetry, challans, POD, attendance/payroll, notifications, and audit logs.
5. Confirm ETL/cutover evidence. `docs/MIGRATION.md` describes ETL as a plan; the document alone does not prove it ran.
6. Only after backup and row-level reconciliation should any missing data be migrated or production code changed.

## Safe next implementation order

1. Verify live database counts and migration state.
2. Fix the currently visible placeholder/nonresponsive role-home routes by tracing frontend role routing against the authenticated role and implemented API endpoints.
3. Complete missing high-priority route parity in this order: plant discovery/onboarding; KYC; notifications; maps/tracking history; finance/payments; plans/promotions; workforce reports/payroll closure; admin/control center; storage; automation/assistant; account deletion and Play policy.
4. Add integration tests for each module and role before deploying.
