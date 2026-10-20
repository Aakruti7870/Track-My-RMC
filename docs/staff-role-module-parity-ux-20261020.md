# TrackMyRMC operational staff role parity and UX audit

**Audited:** 2026-10-20
**Base production SHA:** 1dd56b292867a6578f0746db5a7b3948e4aba0c8
**Scope:** Operational staff roles only. Customer, Plant Owner and Driver post-login card components, navigation and backgrounds remain unchanged.

## Evidence and boundaries
- frontend/src/navigation/moduleCatalog.ts is the canonical discovery list: **61 destinations overall**; each operational staff entry already has an SVG symbol (none missing).
- backend/src/routes/staff_module_permissions.rs defines 20 scoped capability keys with per-role immutable ceilings.
- docs/ROLE_PERMISSION_MATRIX.md is a design-era specification, **not** definitive evidence a backend route authorizes a specific action. It conflates legacy plant Admin and Central Admin in places.
- docs/ROLE_MODULE_PARITY_MATRIX.md marks all eight operational staff roles PARTIAL. These remain PARTIAL until their separate end-to-end workflow acceptance passes.
- backend/migrations/0038 and 0039 store audited grants, not full workflow data. They do not implement maintenance schedules, GRNs, batching calibration, collections or payroll approvals by themselves.

## Role-wise catalog audit
| Staff login role | Existing catalog cards | Data focus | Important incomplete workflows |
| --- | ---: | --- | --- |
| Admin (plant-scoped) | 21 | Assigned plant orders, fleet, commercial controls | Exceptional approvals, workforce access, comprehensive mutation review |
| Dispatcher | 9 (8 visible by default; reports is denied) | Dispatch queue, mixer availability, inventory read-only | Live trip scheduling, gate-pass review/approval, advanced ETA |
| Operator | 9 | Batching, mix design view, inventory view | Production downtime, batch variance and calibrated batching records |
| Supervisor | 10 | Incidents, stock, production oversight, attendance | Incident resolution, shift approvals, QC exception signoff |
| Accountant | 15 | Billing, ledger, expenses, payroll and salary | Credit limits, receivables aging, tax reconciliation |
| Quality Engineer | 9 | Quality register, mix designs, material inventory | Sampling, slump register, concrete cube acceptance and calibrations |
| Fleet Manager | 10 | Fleet, drivers, diesel, reporting | Preventive maintenance, statutory expiry alerts, breakdown workflows |
| Store Manager | 11 | Stock, suppliers, receipts and diesel | GRN matching, stock reconciliation, silo thresholds |

**Important:** A catalog card is navigation to an existing Expo route, **not** proof of fully implemented domain logic. No placeholder for a nonexistent specialist workflow has been added.

## Code changes in this branch
1. **Staff-only UI** — StaffModuleDirectory is separate from the shared RoleModuleDirectory, preserving Driver's post-login cards. All eight staff Homes get branded role-specific glass hero panels, live backend KPIs, vector symbols, permission-aware primary queues, responsive mobile/tablet module cards, search and category filtering in More.
2. **Backend gate consistency** — All staff collection reads for orders, production, quality, dispatch, fleet, drivers, incidents, invoices, ledger and inventory use their effective plant/module grant in addition to the existing role policy and SQL plant scoping. Identity-scoped plant directory retained.
3. **Material permissions** — Existing inventory collection allows eligible Dispatcher and Quality Engineer read access when their role ceiling and Owner override permit it.
4. **Operational reports repaired** — The missing /api/master/plants/:plant_id/summary route now returns true per-plant order/mixer/material counts only, with tenant and module checks; reports view shows those rows instead of an empty placeholder.
5. **Supervisor salary privacy** — Supervisors continue to see allowed roster profiles but employee salary and pay totals are withheld. Financial access remains with Owner/Accountant/otherwise-existing legitimate roles.
6. **Regression tests** — Verify per-role collection revocation, disabled-plant access and Owner continuity; operational reports count/tenancy and permission denial.

## Security rules
- Plant Owner grants cannot exceed server role ceilings and cannot grant Central Admin/Owner authority.
- A suspended or unassigned staff member cannot read a protected collection.
- Hiding UI does not authorize or replace Rust checks.
- A role's personal payslip and roster shortcuts keep their established personal-scope authorizations; do not conflate these with managing everyone else's payroll.
- Admin means existing **plant-scoped legacy Admin**, not Central Admin.
- Four key roles (Customer, Owner, Driver and restricted Central Admin) retain their original screens and permission models.

## Release acceptance
- [ ] Rust fmt, Clippy, PostgreSQL 16/18 tests including synthetic staff login journeys.
- [ ] Frontend typecheck, vector-symbol validation, module discovery contract and responsive web build.
- [ ] Staging smoke: eight MFA logins, granted/revoked paths, search filters, light/dark readability.
- [ ] Android handset review of 44pt touch targets and 52px module vectors.
- [ ] Main merge only after CI green, followed by AWS SSM deployment and origin health checks.

## Future implementation backlog (not represented as completed)
- Role-specific create/edit/approve rights for ALL legacy workforce/HR, invoice, report and specialized APIs.
- Mix design version approval and batch recipe traceability.
- Cube-test evidence/certificates and equipment-calibration workflows.
- Plant inventory GRN, batch-consumption reconciliation, low-stock alerts and diesel anomalies.
- Fleet statutory expiry, driver compliance, preventive maintenance and live ETA.
- Full device acceptance and regulatory validation in the deployment jurisdiction.
