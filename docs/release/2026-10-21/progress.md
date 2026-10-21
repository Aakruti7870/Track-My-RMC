# Launch evidence and progress — 21 October 2026

Decision: **NO-GO**. Evidence applies to production `b99d7ae7bac8f731e0ac01ac4dcf33ce24bd8fe8`; this is not a final release approval.

## Verified current state

- PR #99 is merged. Main Frontend CI [39623056747](https://github.com/Aakruti7870/Track-My-RMC/actions/runs/39623056747), Backend CI [39623056917](https://github.com/Aakruti7870/Track-My-RMC/actions/runs/39623056917), and AWS deployment [39623828312](https://github.com/Aakruti7870/Track-My-RMC/actions/runs/39623828312) succeeded.
- EC2 local API health returned status=ok, database=connected, environment=production. Nginx configuration validated; root disk usage was 55%.
- RDS PostgreSQL 18.3 is private, encrypted, deletion-protected, with seven-day backup retention. Manual snapshot `trackmyrmc-pre-url-recovery-20261016` is available. Restore and application rollback have **not** been proved.
- SELECT-only audit completed at 2026-10-21T15:44:18Z through SSM command `c6f07217-9b33-4ef8-8532-e52b35761c81`. See database-audit.json. Credentials and customer records are excluded.
- Runtime database **postgres** contains 78 public tables, all 36 expected SQLx migrations with matching SHA-384 checksums, no failed/unknown migrations, no invalid indexes or unvalidated constraints, and zero orphan rows across 146 declared foreign keys.
- Intended database **trackmyrmc** has zero public tables and zero applied migrations. It is not an interchangeable deployment target. Keep production on postgres pending a separately approved recovery-backed migration.
- Live data inventory: six users (four customers, one owner, one driver), one plant/order/load/challan, zero staff assignments, rate cards, material stocks, mix designs or invoices. Three enabled Play fixtures exist. These counts do not establish a real production pilot.
- Mumbai returned zero CloudWatch alarms, zero log groups and zero SNS topics. No resources were provisioned.
- KYC start is explicitly disabled in customer_routes.rs. Cashfree checkout/webhooks/refunds are absent from Rust; subscription activation is explicitly disabled in plant_plans_routes.rs. Secret-field presence and frontend SDK installation do not establish provider integration.

## Progress tracker

| Module | Current state | Work completed | Tests passed | Blockers | Next action |
| --- | --- | --- | --- | --- | --- |
| DB parity | Verified mismatch | Read-only catalog/count/checksum/FK audit implemented and run | 36 migration checksums; 146 FK scans | trackmyrmc empty; restore unproved | Isolated restore proposal and exact approval; preserve postgres |
| Recovery gate | Corrected in candidate | Require actual manual snapshot; malformed evidence fails closed | Offline negative regressions | No restore/rollback acceptance | CI/review/merge candidate, then approved restore |
| Customer order/delivery | Partial | Existing synthetic tests and lifecycle services inspected | Current main CI green | KYC disabled; plant operational configuration absent; real pilot absent | Complete provider and representative-data acceptance |
| Staff permissions | Partial | Current collection gates and role ceilings present | Existing PG16/18 main suites | Mutation authorization audit incomplete | Audit create/edit/approve paths |
| OTP/MFA/reviewer | Partial | Synthetic tests and isolated reviewer flow exist | Current main CI green | Authorized delivery destinations/device verification absent | Live authorized OTP and reviewer acceptance |
| KYC | Blocked | Actual disabled backend confirmed | Order eligibility negative tests exist | Provider session/callback implementation absent | Implement approved identity flow, sandbox tests, authorized live acceptance |
| Cashfree | Blocked | Actual disabled/absent backend confirmed | Local billing tests do not validate gateway | Checkout/webhook/refund implementation absent | Sandbox implementation and reconciliation; separate live approval |
| Dependencies | Blocked | Fresh locked production audit | 0 critical; 22 high entries | braces, node-forge, image-size | Compatible remediation and exposure review |
| Frontend | Partial | Approved dashboards preserved | Local typecheck, 20 regressions, routing/modules/vectors/policy/layout; Expo Doctor 18/18 | Physical-device and full workflow acceptance | Browser export and real-device journeys |
| Android/Play | Pending | Current app config verified 2.0.32 / vc90 / com.trackmyrmc.concreteking | Static policy checks | Fresh final-commit signed AAB, device tests, Play status | Build after final approved code; preserve hash/signature |
| Monitoring | Blocked | Current empty inventory confirmed; opt-in template exists | Existing template contracts | Cost approval and verified SNS destination | Price reviewed plan; activate only after approval |
| Release | NO-GO | Current SHA and evidence collected | PR99 post-merge CI/deployment | Critical gates above remain open | Reviewable batches; no launch declaration |

## 13-role acceptance status

The detailed route/API/table matrix remains docs/ROLE_MODULE_PARITY_MATRIX.md. All rows remain partial or unimplemented; menu/card discovery is not workflow acceptance.

| Role | UI / API / tables | Current evidence | Acceptance status |
| --- | --- | --- | --- |
| Customer | /customer; customer_routes; users/user_profiles/orders/customer_sites | Synthetic ordering and isolation tests; live KYC start disabled | BLOCKED |
| Plant Owner | /owner; owner_routes; rmc_plants/plant_staff | Approved UI preserved; synthetic owner MFA and operational flows | PARTIAL |
| Driver | /driver; driver_routes; order_loads/gps_telemetry/proof_of_deliveries | Approved UI preserved; synthetic delivery tests | PARTIAL; device GPS/POD required |
| Admin | /admin mobile; staff_routes; plant_staff/audit_logs | Plant-scoped collection guards | PARTIAL; mutation audit |
| Dispatcher | /dispatcher; loads_routes; order_loads/challans/gate_passes | Synthetic dispatch and role grants | PARTIAL |
| Operator | /operator; production_service; production_batches/production_stock_movements | Synthetic transactional production tests | PARTIAL |
| Supervisor | /supervisor; workforce_routes; workforce_attendance/workforce_shifts | Collection/tenancy tests | PARTIAL |
| Accountant | /accountant; finance_ops_routes/billing_service; plant_invoices/plant_payments/payroll_records | Synthetic financial tests | PARTIAL; gateway missing |
| Quality Engineer | /quality_engineer; staff_routes; quality_test_records/cube_tests | Scoped collections/association tests | PARTIAL; calibration/certificate workflows |
| Fleet Manager | /fleet_manager; business_routes; transit_mixers/diesel_transactions | Scoped collection tests | PARTIAL; maintenance/compliance acceptance |
| Store Manager | /store_manager; master_data_routes; plant_materials/purchase_receipts/plant_suppliers | Production consumption tests | PARTIAL; GRN/reorder acceptance |
| Authority | No dedicated implemented journey | No approved identity/onboarding model | BLOCKED; no Admin alias or MFA bypass authorized |
| Central Admin | Separate admin-web; control_center_routes; control_center_access/sessions/step_ups | Synthetic browser/security tests; no live privileged identity configured | PARTIAL; explicit provisioning and recovery policy |

## Safety and approval boundaries

No production rows, database targets, provider configuration, roles, credentials, infrastructure, or payment modes were changed by the audit. No chargeable resources or real orders were created. Database restore costs, monitoring/SNS destination, live provider test identities, physical devices and Play Console access require concrete follow-through; none is assumed accepted. Customer, Owner and Driver card designs are unchanged.
