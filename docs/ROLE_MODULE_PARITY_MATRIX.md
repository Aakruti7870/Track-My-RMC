# Role/module parity matrix

Source role inventory: reference-role-module-inventory.json. Deployment status for every role: BLOCKED. No production changes were applied.

| Role | Target screens | Rust implementation | PostgreSQL | Permission/test evidence | Remaining issues | Status |
|---|---|---|---|---|---|---|
| customer | frontend/app/customer | customer_routes.rs | users, user_profiles, customer_sites, orders | Customer IDs scoped in customer handlers; full negative journey tests pending | External OTP/KYC, invoice/payment workflow pending | PARTIAL |
| driver | frontend/app/driver; trip/[id]; pod/[id] | driver_routes.rs; trip_lifecycle.rs; dispatch_repo.rs | order_loads, gps_telemetry, challans, proof_of_deliveries, stored_files | Assigned driver/load validation; delivery HTTP and PostgreSQL regression tests | Real-device background replay and external WhatsApp pending | PARTIAL |
| plant_owner | frontend/app/owner | owner_routes.rs; staff_collections.rs | rmc_plants, plant_staff, orders, plant_invoices | owner and plant_owner are aliases; multi-plant collection tests | Owner quantity-batch/inventory workflows and full MFA journey pending | PARTIAL |
| admin | frontend/app/admin | staff_routes.rs; staff_collections.rs | plant_staff and plant-scoped operations | No Central Admin elevation; restricted collection tests | Complete mobile operational permissions audit pending | PARTIAL |
| dispatcher | frontend/app/dispatcher; LoadPlanner | loads_routes.rs; load_lifecycle.rs | order_loads, transit_mixers, challans, gate_passes | Plant scope and active resource checks; production/delivery integration test | UI browser/device flow pending | PARTIAL |
| operator | frontend/app/operator | staff_routes.rs | batch_production_records, order_loads | Approved order, plant scope and matching order/load checks | Materials consumption and order-wide quantity batch contracts pending | PARTIAL |
| supervisor | frontend/app/supervisor | staff_routes.rs; workforce_routes.rs | plant_staff, workforce_attendance, driver_sos_alerts | Plant-scoped collection tests | Full incident, attendance and shift journey pending | PARTIAL |
| accountant | frontend/app/accountant | finance_ops_routes.rs; payroll_routes.rs | plant_invoices, plant_payments, payroll_records | Role-scoped collections and SQL parsing; financial mutation audit pending | End-to-end ledger/payroll reconciliation pending | PARTIAL |
| quality_engineer | frontend/app/quality_engineer | staff_routes.rs | cube_tests, quality_test_records | Read collections role-scoped; quality mutation review pending | Full cube results and customer receiving journey pending | PARTIAL |
| fleet_manager | frontend/app/fleet_manager | staff_routes.rs; master_data_routes.rs | transit_mixers, plant_staff | Fleet collection tests and delivery resource release | Diesel/maintenance and complete tracking journey pending | PARTIAL |
| store_manager | frontend/app/store_manager | business_routes.rs; master_data_routes.rs | plant_materials and purchasing tables | Stock collection SQL and plant scope tests | Consumption and purchase mutation workflows pending | PARTIAL |
| authority | No original mobile role route | Not implemented as an alias | Existing users.role retained | Fail closed; no implicit owner/admin permissions | Authority policy and dedicated functions need implementation | NOT IMPLEMENTED |
| central_admin | admin-web | auth/control_center.rs; control_center_routes.rs | control_center_access, control_center_sessions, control_center_step_ups | Dedicated approved TOTP session and per-permission checks; HTTP negative tests | Recovery/enrollment/provisioning and remaining workspace APIs pending | PARTIAL |
