# Tracking-project → TrackMyRMC: Role and Module Retrieval

**Audit date:** 2026-10-15  
**Reference repo:** `Aakruti7870/Tracking-project` (`main`)  
**Target repo:** `Aakruti7870/Track-My-RMC` (`main`)  
**Machine-readable file inventory:** [reference-role-module-inventory.json](reference-role-module-inventory.json)

## Identity rule

**`owner` = `plant_owner`, the same Plant Owner role.** The target backend currently uses a legacy `owner` DB/API identifier while some screens require `plant_owner`. Both route to `/owner` and inherit exactly the same Plant Owner authorization policy. This is an alias, **not an additional role**. Do not automatically promote any user to owner as part of code migration.

The reference backend defines 13 role identifiers: `customer`, `driver`, `plant_owner`, `admin`, `dispatcher`, `operator`, `supervisor`, `accountant`, `quality_engineer`, `fleet_manager`, `store_manager`, `authority`, and `central_admin`.

## Role-screen and business-module mapping

| Role | Target workspace | Source-equivalent modules and operational data |
| --- | --- | --- |
| Customer | `frontend/app/customer/` | Own sites/projects, discovery and plant comparison, quotations, pour plans, orders, delivery tracking, challans, documents, receiving and cube results |
| Driver | `frontend/app/driver/` | Assigned trips and mixer, trip status, GPS updates, attendance, POD, SOS, own shifts and payslips |
| Plant Owner (`plant_owner` / `owner`) | `frontend/app/owner/` | Own plants, orders, production, operations, fleet, incident resolution, staff, finance, quotes, inventory, workforce, payroll, subscriptions |
| Legacy operations `admin` | `frontend/app/admin/` | Operational staff dashboard, fleet, orders, plant onboarding; **not** the dedicated Central Admin web security surface |
| Dispatcher | `frontend/app/dispatcher/` | Dispatch queue, fleet, load allocation, gate passes and assignments |
| Operator | `frontend/app/operator/` | Production batches, batching workflow, production records |
| Supervisor | `frontend/app/supervisor/` | Plant operations, incidents, roster and attendance |
| Accountant | `frontend/app/accountant/` | Billing, ledger, expenses, purchases, workforce reports, salaries and payroll |
| Quality Engineer | `frontend/app/quality_engineer/` | Mix design, quality checks, slump and cube tests |
| Fleet Manager | `frontend/app/fleet_manager/` | Mixers, vehicles, drivers, maintenance, diesel, tracking |
| Store Manager | `frontend/app/store_manager/` | Raw material stock, suppliers, purchases, stock movements |
| Authority | No mobile role route in source | Restricted operational Plant Staff identity; do not silently equate with admin or owner |
| Central Admin | Original dedicated `admin-web/` | Web-only platform governance, permissions, sessions, users, onboarding, support, audit and safe read-only workspaces |

For the actual original files, their target counterparts, and content hashes, see the JSON inventory. Source and target have 195 byte-identical frontend files; 24 matching-path frontend files differ. The target contains all original per-role mobile route files. Screen presence is not proof of end-to-end functional parity.

## Confirmed differences and safeguards

1. **Plant Owner alias mismatch:** The target login router recognizes both `owner` and `plant_owner`, but the previous owner-layout guard rejected `owner`. Fixed on this feature branch.
2. **Admin Control Center:** Original admin web includes dedicated role/permission and governance workspaces that are mostly absent from target. The separate admin security implementation remains an ongoing task; PR #36 covers only initial remediation. Never copy the original admin UI and claim it works without Rust API, login provenance and per-permission enforcement.
3. **Unsupported passkeys:** The reference has passkey setup/ceremony screens that intentionally are not exposed by the target because cryptographic backend verification is incomplete. Do not restore them merely for route parity.
4. **Data migration:** Repository content provides schemas, business rules and UI source. Actual historical users, trips, orders, GPS points, invoices, payroll and documents are stored in databases/object storage, **not in source code**. Migrating historical records requires read-only source access, data inventory, safe ETL mapping, backup and staged reconciliation. Do not run blind writes to production or copy secrets to GitHub.
5. **Tenancy:** Each customer, driver, owner and staff member must access only authorized customer IDs, trip assignments and plant IDs. Neither a role label nor visible screen is sufficient authorization.

## Acceptance gate

- Source role inventory exists and matches the target routes.
- Every applicable screen reaches a real authorized Rust endpoint and PostgreSQL persistence layer.
- No unimplemented buttons, mock-only data or unmapped original business state transitions.
- Mobile WhatsApp OTP (customer/driver) and email/MFA (staff/owner), Central Admin provenance and approved role boundaries are verified independently.
- Play reviewer and passkey security controls are preserved.
- Order-to-production-to-dispatch-to-delivery/POD, inventory/finance, employee payroll and all role-scoped query tests pass in isolated staging.
- Historical data migration only after source database type, live backup, record counts, relation integrity, document references and rollback procedures are verified.
- No production deployment or destructive changes until staging evidence and explicit approval.
