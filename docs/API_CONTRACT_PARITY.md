# API contract parity

Reference: 51903571f110908c3f1ddcffa6e4171ed406888c. Target: integration/trackmyrmc-parity-20261015. The baseline has 297 decorator entries, including duplicate method/path registrations; 288 unique method/path pairs. A method/path match alone never establishes contract parity. The SQL/HTTP regression tests cover the repaired delivery and privileged authentication endpoints.

| Source module | Method | Path | Integration status | Classification |
|---|---|---|---|---|
| account_deletion | POST | `/api/account-deletion/cancel` | PARTIAL | Matching Rust method/path; full contract validation pending |
| account_deletion | POST | `/api/account-deletion/public-request` | PARTIAL | Matching Rust method/path; full contract validation pending |
| account_deletion | POST | `/api/account-deletion/request` | PARTIAL | Matching Rust method/path; full contract validation pending |
| account_deletion | GET | `/api/account-deletion/requests` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| account_deletion | POST | `/api/account-deletion/requests/{request_id}/complete` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| account_deletion | GET | `/api/account-deletion/status` | PARTIAL | Matching Rust method/path; full contract validation pending |
| admin_auth | POST | `/api/admin/auth/logout-all` | PARTIAL | Matching Rust method/path; full contract validation pending |
| admin_auth | POST | `/api/admin/auth/method` | PARTIAL | Matching Rust method/path; full contract validation pending |
| admin_auth | POST | `/api/admin/auth/recover` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| admin_auth | POST | `/api/admin/auth/step-up` | PARTIAL | Matching Rust method/path; full contract validation pending |
| admin_auth | POST | `/api/admin/auth/verify-totp` | PARTIAL | Matching Rust method/path; full contract validation pending |
| admin_portal | GET | `/api/admin/portal/audit` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| admin_portal | GET | `/api/admin/portal/kyc` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| admin_portal | GET | `/api/admin/portal/orders` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| admin_portal | GET | `/api/admin/portal/payments` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| admin_portal | GET | `/api/admin/portal/plants` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| admin_portal | GET | `/api/admin/portal/summary` | PARTIAL | Matching Rust method/path; full contract validation pending |
| admin_portal | GET | `/api/admin/portal/support` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| admin_portal | GET | `/api/admin/portal/system` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| admin_portal | GET | `/api/admin/portal/users` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| assistant | POST | `/api/assistant/orders/confirm` | PARTIAL | Matching Rust method/path; full contract validation pending |
| assistant | POST | `/api/assistant/orders/prepare` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| assistant | POST | `/api/assistant/support` | PARTIAL | Matching Rust method/path; full contract validation pending |
| assistant | GET | `/api/assistant/support/cases` | PARTIAL | Matching Rust method/path; full contract validation pending |
| assistant | GET | `/api/assistant/support/cases/{case_id}` | PARTIAL | Matching Rust method/path; full contract validation pending |
| assistant | POST | `/api/assistant/support/cases/{case_id}/replies` | PARTIAL | Matching Rust method/path; full contract validation pending |
| assistant | GET | `/api/assistant/support/staff/cases` | PARTIAL | Matching Rust method/path; full contract validation pending |
| assistant | GET | `/api/assistant/support/staff/cases/{case_id}` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| assistant | POST | `/api/assistant/support/staff/cases/{case_id}/replies` | PARTIAL | Matching Rust method/path; full contract validation pending |
| assistant | PATCH | `/api/assistant/support/staff/cases/{case_id}/status` | PARTIAL | Matching Rust method/path; full contract validation pending |
| auth | POST | `/api/auth/demo-login` | NOT IMPLEMENTED | Intentionally retired for security; excluded until approved secure implementation |
| auth | GET | `/api/auth/google/callback` | NOT IMPLEMENTED | Intentionally retired for security; excluded until approved secure implementation |
| auth | POST | `/api/auth/google/exchange` | NOT IMPLEMENTED | Intentionally retired for security; excluded until approved secure implementation |
| auth | GET | `/api/auth/google/start` | NOT IMPLEMENTED | Intentionally retired for security; excluded until approved secure implementation |
| auth | POST | `/api/auth/logout` | PARTIAL | Matching Rust method/path; full contract validation pending |
| auth | POST | `/api/auth/request-otp` | NOT IMPLEMENTED | Requires compatibility route or frontend contract correction |
| auth | POST | `/api/auth/verify-otp` | NOT IMPLEMENTED | Requires compatibility route or frontend contract correction |
| automation | POST | `/api/automation/events/{event_id}/ack` | PARTIAL | Matching Rust method/path; full contract validation pending |
| automation | POST | `/api/automation/events/{event_id}/deliver` | PARTIAL | Matching Rust method/path; full contract validation pending |
| automation | POST | `/api/automation/events/{event_id}/fail` | PARTIAL | Matching Rust method/path; full contract validation pending |
| automation | POST | `/api/automation/events/claim` | PARTIAL | Matching Rust method/path; full contract validation pending |
| automation | POST | `/api/automation/provider-callback` | PARTIAL | Matching Rust method/path; full contract validation pending |
| automation | GET | `/api/automation/worker-health` | PARTIAL | Matching Rust method/path; full contract validation pending |
| business_ui | GET | `/api/business/plants/{plant_id}/customers` | PARTIAL | Matching Rust method/path; full contract validation pending |
| business_ui | POST | `/api/business/plants/{plant_id}/materials` | PARTIAL | Matching Rust method/path; full contract validation pending |
| business_ui | POST | `/api/business/plants/{plant_id}/materials/{material_id}/adjust` | PARTIAL | Matching Rust method/path; full contract validation pending |
| business_ui | POST | `/api/business/plants/{plant_id}/people` | PARTIAL | Matching Rust method/path; full contract validation pending |
| business_ui | POST | `/api/business/plants/{plant_id}/people/{user_id}/activate` | PARTIAL | Matching Rust method/path; full contract validation pending |
| business_ui | POST | `/api/business/plants/{plant_id}/people/{user_id}/suspend` | PARTIAL | Matching Rust method/path; full contract validation pending |
| business_ui | POST | `/api/business/plants/{plant_id}/vehicles` | PARTIAL | Matching Rust method/path; full contract validation pending |
| business_ui | POST | `/api/business/plants/{plant_id}/vehicles/{vehicle_id}/status` | PARTIAL | Matching Rust method/path; full contract validation pending |
| control_center | GET | `/api/control-center/admin-access` | PARTIAL | Matching Rust method/path; full contract validation pending |
| control_center | POST | `/api/control-center/admin-access` | PARTIAL | Matching Rust method/path; full contract validation pending |
| control_center | POST | `/api/control-center/ai/commands` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| control_center | GET | `/api/control-center/capabilities` | PARTIAL | Matching Rust method/path; full contract validation pending |
| control_center | POST | `/api/control-center/owners/plants/{plant_id}/assign` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| control_center | GET | `/api/control-center/owners/requests` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| control_center | POST | `/api/control-center/owners/requests/{request_id}/approve` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| control_center | GET | `/api/control-center/owners/unowned-plants` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| control_center | GET | `/api/control-center/reviewer-access` | PARTIAL | Matching Rust method/path; full contract validation pending |
| control_center | POST | `/api/control-center/reviewer-access` | PARTIAL | Matching Rust method/path; full contract validation pending |
| control_center | GET | `/api/control-center/sessions` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| control_center | POST | `/api/control-center/sessions/{session_id}/revoke` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| control_center | GET | `/api/control-center/support/cases` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| control_center | GET | `/api/control-center/support/cases/{case_id}` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| control_center | POST | `/api/control-center/support/cases/{case_id}/notes` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| control_center | POST | `/api/control-center/support/cases/{case_id}/replies` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| control_center | PATCH | `/api/control-center/support/cases/{case_id}/status` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| customer | GET | `/api/customer/compare-plants` | PARTIAL | Matching Rust method/path; full contract validation pending |
| customer | GET | `/api/customer/home` | PARTIAL | Matching Rust method/path; full contract validation pending |
| customer | GET | `/api/customer/kyc` | PARTIAL | Matching Rust method/path; full contract validation pending |
| customer | POST | `/api/customer/kyc/start` | PARTIAL | Matching Rust method/path; full contract validation pending |
| customer | GET | `/api/customer/orders` | PARTIAL | Matching Rust method/path; full contract validation pending |
| customer | POST | `/api/customer/orders` | PARTIAL | Matching Rust method/path; full contract validation pending |
| customer | GET | `/api/customer/orders/{order_id}` | PARTIAL | Matching Rust method/path; full contract validation pending |
| customer | POST | `/api/customer/orders/{order_id}/cancel` | PARTIAL | Matching Rust method/path; full contract validation pending |
| customer | GET | `/api/customer/orders/{order_id}/challan` | PARTIAL | Matching Rust method/path; full contract validation pending |
| customer | GET | `/api/customer/orders/{order_id}/tracking` | PARTIAL | Matching Rust method/path; full contract validation pending |
| customer | GET | `/api/customer/plants` | PARTIAL | Matching Rust method/path; full contract validation pending |
| customer | GET | `/api/customer/plants/{plant_id}` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| customer | GET | `/api/customer/pour-plans` | PARTIAL | Matching Rust method/path; full contract validation pending |
| customer | POST | `/api/customer/pour-plans` | PARTIAL | Matching Rust method/path; full contract validation pending |
| customer | DELETE | `/api/customer/pour-plans/{plan_id}` | PARTIAL | Matching Rust method/path; full contract validation pending |
| customer | GET | `/api/customer/project-sites` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| customer | POST | `/api/customer/quotation-requests` | PARTIAL | Matching Rust method/path; full contract validation pending |
| customer | GET | `/api/customer/quotation-requests` | PARTIAL | Matching Rust method/path; full contract validation pending |
| customer | GET | `/api/customer/receiving-records` | PARTIAL | Matching Rust method/path; full contract validation pending |
| customer | POST | `/api/customer/receiving-records` | PARTIAL | Matching Rust method/path; full contract validation pending |
| customer | DELETE | `/api/customer/receiving-records/{record_id}` | PARTIAL | Matching Rust method/path; full contract validation pending |
| customer | PATCH | `/api/customer/receiving-records/{record_id}/cube-results` | PARTIAL | Matching Rust method/path; full contract validation pending |
| driver | GET | `/api/driver/attendance` | PARTIAL | Matching Rust method/path; full contract validation pending |
| driver | POST | `/api/driver/attendance/checkin` | PARTIAL | Matching Rust method/path; full contract validation pending |
| driver | POST | `/api/driver/attendance/checkout` | PARTIAL | Matching Rust method/path; full contract validation pending |
| driver | GET | `/api/driver/home` | PARTIAL | Matching Rust method/path; full contract validation pending |
| driver | POST | `/api/driver/sos` | PARTIAL | Matching Rust method/path; full contract validation pending |
| driver | GET | `/api/driver/sos` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| driver | GET | `/api/driver/trips` | PARTIAL | Matching Rust method/path; full contract validation pending |
| driver | GET | `/api/driver/trips/{trip_id}` | PARTIAL | Matching Rust method/path; full contract validation pending |
| driver | POST | `/api/driver/trips/{trip_id}/arrive` | PARTIAL | Matching Rust method/path; full contract validation pending |
| driver | POST | `/api/driver/trips/{trip_id}/location` | PARTIAL | Matching Rust method/path; full contract validation pending |
| driver | POST | `/api/driver/trips/{trip_id}/pod` | PARTIAL | Matching Rust method/path; full contract validation pending |
| driver | POST | `/api/driver/trips/{trip_id}/start` | PARTIAL | Matching Rust method/path; full contract validation pending |
| driver | POST | `/api/driver/trips/{trip_id}/unload` | PARTIAL | Matching Rust method/path; full contract validation pending |
| finance_ops | GET | `/api/ops/customer/quotations` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| finance_ops | POST | `/api/ops/customer/quotations/{quotation_id}/decision` | PARTIAL | Matching Rust method/path; full contract validation pending |
| finance_ops | GET | `/api/ops/plants/{plant_id}/attendance/{date_key}` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| finance_ops | POST | `/api/ops/plants/{plant_id}/attendance/checkin` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| finance_ops | POST | `/api/ops/plants/{plant_id}/attendance/checkout` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| finance_ops | GET | `/api/ops/plants/{plant_id}/diesel` | PARTIAL | Matching Rust method/path; full contract validation pending |
| finance_ops | POST | `/api/ops/plants/{plant_id}/diesel` | PARTIAL | Matching Rust method/path; full contract validation pending |
| finance_ops | GET | `/api/ops/plants/{plant_id}/expenses` | PARTIAL | Matching Rust method/path; full contract validation pending |
| finance_ops | POST | `/api/ops/plants/{plant_id}/expenses` | PARTIAL | Matching Rust method/path; full contract validation pending |
| finance_ops | PUT | `/api/ops/plants/{plant_id}/payroll` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| finance_ops | GET | `/api/ops/plants/{plant_id}/payroll/{month}` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| finance_ops | GET | `/api/ops/plants/{plant_id}/purchases` | PARTIAL | Matching Rust method/path; full contract validation pending |
| finance_ops | POST | `/api/ops/plants/{plant_id}/purchases` | PARTIAL | Matching Rust method/path; full contract validation pending |
| finance_ops | GET | `/api/ops/plants/{plant_id}/quotation-requests` | PARTIAL | Matching Rust method/path; full contract validation pending |
| finance_ops | POST | `/api/ops/plants/{plant_id}/quotation-requests/{request_id}/respond` | PARTIAL | Matching Rust method/path; full contract validation pending |
| finance_ops | GET | `/api/ops/plants/{plant_id}/quotations` | PARTIAL | Matching Rust method/path; full contract validation pending |
| finance_ops | POST | `/api/ops/plants/{plant_id}/quotations` | PARTIAL | Matching Rust method/path; full contract validation pending |
| hr_master | GET | `/api/hr/employees` | PARTIAL | Matching Rust method/path; full contract validation pending |
| hr_master | GET | `/api/hr/plants/{plant_id}/employees/{user_id}` | PARTIAL | Matching Rust method/path; full contract validation pending |
| hr_master | PUT | `/api/hr/plants/{plant_id}/employees/{user_id}/profile` | PARTIAL | Matching Rust method/path; full contract validation pending |
| hr_master | PUT | `/api/hr/plants/{plant_id}/employees/{user_id}/salary` | PARTIAL | Matching Rust method/path; full contract validation pending |
| hr_master | GET | `/api/hr/plants/{plant_id}/employees/{user_id}/salary-suggestion/{month}` | PARTIAL | Matching Rust method/path; full contract validation pending |
| kyc_recovery | GET | `/api/staff/kyc-recovery` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| kyc_recovery | POST | `/api/staff/kyc-recovery/{profile_id}/reset` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| loads | PUT | `/api/loads/{load_id}/assignment` | PARTIAL | Matching Rust method/path; full contract validation pending |
| loads | POST | `/api/loads/{load_id}/cancel` | PARTIAL | Matching Rust method/path; full contract validation pending |
| loads | POST | `/api/loads/{load_id}/dispatch` | PARTIAL | Matching Rust method/path; full contract validation pending |
| loads | POST | `/api/loads/{load_id}/prepare` | PARTIAL | Matching Rust method/path; full contract validation pending |
| loads | POST | `/api/loads/gate-pass` | PARTIAL | Matching Rust method/path; full contract validation pending |
| loads | GET | `/api/loads/orders/{order_id}` | PARTIAL | Matching Rust method/path; full contract validation pending |
| loads | POST | `/api/loads/orders/{order_id}` | PARTIAL | Matching Rust method/path; full contract validation pending |
| maps | GET | `/api/maps/authority/rmc-plants` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| maps | GET | `/api/maps/autocomplete` | PARTIAL | Matching Rust method/path; full contract validation pending |
| maps | GET | `/api/maps/geocode` | PARTIAL | Matching Rust method/path; full contract validation pending |
| maps | GET | `/api/maps/place/{place_id}` | PARTIAL | Matching Rust method/path; full contract validation pending |
| maps | GET | `/api/maps/rmc-plants` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| maps | POST | `/api/maps/rmc-plants/{place_id}/request-listing` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| maps | GET | `/api/maps/route` | PARTIAL | Matching Rust method/path; full contract validation pending |
| maps | GET | `/api/maps/status` | PARTIAL | Matching Rust method/path; full contract validation pending |
| master_data | GET | `/api/master/customer/sites` | PARTIAL | Matching Rust method/path; full contract validation pending |
| master_data | POST | `/api/master/customer/sites` | PARTIAL | Matching Rust method/path; full contract validation pending |
| master_data | DELETE | `/api/master/customer/sites/{site_id}` | PARTIAL | Matching Rust method/path; full contract validation pending |
| master_data | GET | `/api/master/my-plants` | PARTIAL | Matching Rust method/path; full contract validation pending |
| master_data | GET | `/api/master/plants/{plant_id}/mix-designs` | PARTIAL | Matching Rust method/path; full contract validation pending |
| master_data | POST | `/api/master/plants/{plant_id}/mix-designs` | PARTIAL | Matching Rust method/path; full contract validation pending |
| master_data | GET | `/api/master/plants/{plant_id}/people` | PARTIAL | Matching Rust method/path; full contract validation pending |
| master_data | GET | `/api/master/plants/{plant_id}/profile` | PARTIAL | Matching Rust method/path; full contract validation pending |
| master_data | PUT | `/api/master/plants/{plant_id}/profile` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| master_data | GET | `/api/master/plants/{plant_id}/rate-cards` | PARTIAL | Matching Rust method/path; full contract validation pending |
| master_data | POST | `/api/master/plants/{plant_id}/rate-cards` | PARTIAL | Matching Rust method/path; full contract validation pending |
| master_data | GET | `/api/master/plants/{plant_id}/resources` | PARTIAL | Matching Rust method/path; full contract validation pending |
| master_data | GET | `/api/master/plants/{plant_id}/summary` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| master_data | GET | `/api/master/plants/{plant_id}/suppliers` | PARTIAL | Matching Rust method/path; full contract validation pending |
| master_data | POST | `/api/master/plants/{plant_id}/suppliers` | PARTIAL | Matching Rust method/path; full contract validation pending |
| me | GET | `/api/me` | PARTIAL | Matching Rust method/path; full contract validation pending |
| meta_whatsapp | GET | `/api/meta/whatsapp/webhook` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| meta_whatsapp | POST | `/api/meta/whatsapp/webhook` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| notify | GET | `/api/notifications` | PARTIAL | Matching Rust method/path; full contract validation pending |
| notify | POST | `/api/notifications/{notification_id}/read` | PARTIAL | Matching Rust method/path; full contract validation pending |
| notify | POST | `/api/notifications/device/register` | PARTIAL | Matching Rust method/path; full contract validation pending |
| notify | POST | `/api/notifications/device/unregister` | PARTIAL | Matching Rust method/path; full contract validation pending |
| notify | POST | `/api/notifications/read-all` | PARTIAL | Matching Rust method/path; full contract validation pending |
| operator_ops | GET | `/api/staff/orders/{order_id}/production` | PARTIAL | Matching Rust method/path; full contract validation pending |
| operator_ops | POST | `/api/staff/orders/{order_id}/production/batch` | PARTIAL | Matching Rust method/path; full contract validation pending |
| owner | GET | `/api/owner/drivers` | PARTIAL | Matching Rust method/path; full contract validation pending |
| owner | GET | `/api/owner/fleet` | PARTIAL | Matching Rust method/path; full contract validation pending |
| owner | GET | `/api/owner/home` | PARTIAL | Matching Rust method/path; full contract validation pending |
| owner | GET | `/api/owner/incidents` | PARTIAL | Matching Rust method/path; full contract validation pending |
| owner | POST | `/api/owner/incidents/{incident_id}/resolve` | PARTIAL | Matching Rust method/path; full contract validation pending |
| owner | GET | `/api/owner/insights` | PARTIAL | Matching Rust method/path; full contract validation pending |
| owner | GET | `/api/owner/invoices` | PARTIAL | Matching Rust method/path; full contract validation pending |
| owner | POST | `/api/owner/invoices/{invoice_id}/payment` | PARTIAL | Matching Rust method/path; full contract validation pending |
| owner | GET | `/api/owner/ledger` | PARTIAL | Matching Rust method/path; full contract validation pending |
| owner | GET | `/api/owner/orders` | PARTIAL | Matching Rust method/path; full contract validation pending |
| owner | GET | `/api/owner/orders/{order_id}` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| owner | POST | `/api/owner/orders/{order_id}/approve` | PARTIAL | Matching Rust method/path; full contract validation pending |
| owner | POST | `/api/owner/orders/{order_id}/assign-driver` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| owner | POST | `/api/owner/orders/{order_id}/assign-tm` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| owner | POST | `/api/owner/orders/{order_id}/challan` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| owner | GET | `/api/owner/orders/{order_id}/challan` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| owner | POST | `/api/owner/orders/{order_id}/dispatch` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| owner | POST | `/api/owner/orders/{order_id}/invoice` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| owner | GET | `/api/owner/orders/{order_id}/production` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| owner | POST | `/api/owner/orders/{order_id}/production/batch` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| owner | POST | `/api/owner/orders/{order_id}/production/complete` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| owner | POST | `/api/owner/orders/{order_id}/production/start` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| owner | POST | `/api/owner/orders/{order_id}/reject` | PARTIAL | Matching Rust method/path; full contract validation pending |
| payroll_closure | GET | `/api/payroll-periods/{month}` | PARTIAL | Matching Rust method/path; full contract validation pending |
| payroll_closure | GET | `/api/payroll-periods/me/{month}` | PARTIAL | Matching Rust method/path; full contract validation pending |
| payroll_closure | POST | `/api/payroll-periods/plants/{plant_id}/{month}/close` | PARTIAL | Matching Rust method/path; full contract validation pending |
| payroll_closure | GET | `/api/payroll-periods/plants/{plant_id}/{month}/export` | PARTIAL | Matching Rust method/path; full contract validation pending |
| payroll_closure | GET | `/api/payroll-periods/plants/{plant_id}/{month}/payslips` | PARTIAL | Matching Rust method/path; full contract validation pending |
| payroll_closure | POST | `/api/payroll-periods/plants/{plant_id}/{month}/reopen` | PARTIAL | Matching Rust method/path; full contract validation pending |
| payroll_concurrency_hotfix | PUT | `/api/workforce-reports/plants/{plant_id}/payroll/{month}/{user_id}/draft` | PARTIAL | Matching Rust method/path; full contract validation pending |
| payroll_concurrency_hotfix | POST | `/api/workforce-reports/plants/{plant_id}/payroll/{month}/{user_id}/mark-paid` | PARTIAL | Matching Rust method/path; full contract validation pending |
| payroll_concurrency_hotfix | POST | `/api/workforce-reports/plants/{plant_id}/payroll/{month}/{user_id}/owner-decision` | PARTIAL | Matching Rust method/path; full contract validation pending |
| payroll_guard | PUT | `/api/ops/plants/{plant_id}/payroll` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| permanent_access | POST | `/api/auth/request-otp` | NOT IMPLEMENTED | Requires compatibility route or frontend contract correction |
| permanent_access | POST | `/api/auth/staff/request-otp` | NOT IMPLEMENTED | Requires compatibility route or frontend contract correction |
| permanent_access | POST | `/api/auth/staff/verify-otp` | NOT IMPLEMENTED | Requires compatibility route or frontend contract correction |
| permanent_access | POST | `/api/auth/verify-otp` | NOT IMPLEMENTED | Requires compatibility route or frontend contract correction |
| permanent_access | GET | `/api/customer/kyc` | PARTIAL | Matching Rust method/path; full contract validation pending |
| plant_discovery | POST | `/api/plant-discovery/plants/{plant_id}/assign-owner` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| plant_discovery | GET | `/api/plant-discovery/requests` | PARTIAL | Matching Rust method/path; full contract validation pending |
| plant_discovery | POST | `/api/plant-discovery/requests/{request_id}/approve` | PARTIAL | Matching Rust method/path; full contract validation pending |
| plant_discovery | POST | `/api/plant-discovery/requests/{request_id}/reject` | PARTIAL | Matching Rust method/path; full contract validation pending |
| plant_discovery | POST | `/api/plant-discovery/requests/bulk-approve` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| plant_discovery | POST | `/api/plant-discovery/requests/bulk-import` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| plant_discovery | GET | `/api/plant-discovery/unowned-plants` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| plant_onboarding | GET | `/api/plant-onboarding/places` | PARTIAL | Matching Rust method/path; full contract validation pending |
| plant_onboarding | POST | `/api/plant-onboarding/requests` | PARTIAL | Matching Rust method/path; full contract validation pending |
| plant_plans | POST | `/api/plant-plans/activate` | PARTIAL | Matching Rust method/path; full contract validation pending |
| plant_plans | GET | `/api/plant-plans/authority-control` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| plant_plans | GET | `/api/plant-plans/cashfree/return` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| plant_plans | POST | `/api/plant-plans/cashfree/webhook` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| plant_plans | GET | `/api/plant-plans/context` | PARTIAL | Matching Rust method/path; full contract validation pending |
| plant_plans | GET | `/api/plant-plans/orders/{order_number}` | PARTIAL | Matching Rust method/path; full contract validation pending |
| plant_plans | GET | `/api/plant-plans/payment-history` | PARTIAL | Matching Rust method/path; full contract validation pending |
| plant_plans | POST | `/api/plant-plans/promo-codes` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| plant_plans | POST | `/api/plant-plans/quote` | PARTIAL | Matching Rust method/path; full contract validation pending |
| play_review | POST | `/api/auth/play-review` | PARTIAL | Matching Rust method/path; full contract validation pending |
| play_review | GET | `/api/auth/play-review/status` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| public_policy | GET | `/api/account-deletion` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| public_policy | GET | `/api/delete-account` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| public_policy | GET | `/api/privacy` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| public_policy | GET | `/api/privacy_policy` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| public_policy | GET | `/api/terms` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| staff | GET | `/api/staff/collection/{kind}` | PARTIAL | Matching Rust method/path; full contract validation pending |
| staff | GET | `/api/staff/drivers` | PARTIAL | Matching Rust method/path; full contract validation pending |
| staff | GET | `/api/staff/fleet` | PARTIAL | Matching Rust method/path; full contract validation pending |
| staff | GET | `/api/staff/home` | PARTIAL | Matching Rust method/path; full contract validation pending |
| staff | POST | `/api/staff/invoices/{invoice_id}/payment` | PARTIAL | Matching Rust method/path; full contract validation pending |
| staff | POST | `/api/staff/kyc/{profile_id}/approve` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| staff | POST | `/api/staff/kyc/{profile_id}/reject` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| staff | POST | `/api/staff/materials` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| staff | POST | `/api/staff/materials/{material_id}/adjust` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| staff | GET | `/api/staff/orders/{order_id}` | PARTIAL | Matching Rust method/path; full contract validation pending |
| staff | POST | `/api/staff/orders/{order_id}/assign-driver` | PARTIAL | Matching Rust method/path; full contract validation pending |
| staff | POST | `/api/staff/orders/{order_id}/assign-tm` | PARTIAL | Matching Rust method/path; full contract validation pending |
| staff | POST | `/api/staff/orders/{order_id}/challan` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| staff | POST | `/api/staff/orders/{order_id}/dispatch` | PARTIAL | Matching Rust method/path; full contract validation pending |
| staff | POST | `/api/staff/orders/{order_id}/production/complete` | PARTIAL | Matching Rust method/path; full contract validation pending |
| staff | POST | `/api/staff/orders/{order_id}/production/start` | PARTIAL | Matching Rust method/path; full contract validation pending |
| staff | POST | `/api/staff/quality` | PARTIAL | Matching Rust method/path; full contract validation pending |
| staff | GET | `/api/staff/quality/{order_id}` | PARTIAL | Matching Rust method/path; full contract validation pending |
| staff | POST | `/api/staff/users/{user_id}/activate` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| staff | POST | `/api/staff/users/{user_id}/suspend` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| staff | POST | `/api/staff/vehicles` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| staff | POST | `/api/staff/vehicles/{vehicle_id}/status` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| staff_auth | POST | `/api/auth/staff/request-otp` | NOT IMPLEMENTED | Requires compatibility route or frontend contract correction |
| staff_auth | POST | `/api/auth/staff/verify-otp` | NOT IMPLEMENTED | Requires compatibility route or frontend contract correction |
| staff_mfa | POST | `/api/auth/staff/mfa/enroll/confirm` | PARTIAL | Matching Rust method/path; full contract validation pending |
| staff_mfa | POST | `/api/auth/staff/mfa/enroll/start` | PARTIAL | Matching Rust method/path; full contract validation pending |
| staff_mfa | POST | `/api/auth/staff/mfa/method` | PARTIAL | Matching Rust method/path; full contract validation pending |
| staff_mfa | POST | `/api/auth/staff/mfa/reset-user` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| staff_mfa | GET | `/api/auth/staff/mfa/status` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| staff_mfa | POST | `/api/auth/staff/mfa/verify-recovery` | PARTIAL | Matching Rust method/path; full contract validation pending |
| staff_mfa | POST | `/api/auth/staff/mfa/verify-totp` | PARTIAL | Matching Rust method/path; full contract validation pending |
| staff_passkeys | POST | `/api/auth/staff/passkey/authenticate/options` | NOT IMPLEMENTED | Intentionally retired for security; excluded until approved secure implementation |
| staff_passkeys | POST | `/api/auth/staff/passkey/authenticate/start` | NOT IMPLEMENTED | Intentionally retired for security; excluded until approved secure implementation |
| staff_passkeys | POST | `/api/auth/staff/passkey/authenticate/verify` | NOT IMPLEMENTED | Intentionally retired for security; excluded until approved secure implementation |
| staff_passkeys | POST | `/api/auth/staff/passkey/exchange` | NOT IMPLEMENTED | Intentionally retired for security; excluded until approved secure implementation |
| staff_passkeys | POST | `/api/auth/staff/passkey/register/options` | NOT IMPLEMENTED | Intentionally retired for security; excluded until approved secure implementation |
| staff_passkeys | POST | `/api/auth/staff/passkey/register/start` | NOT IMPLEMENTED | Intentionally retired for security; excluded until approved secure implementation |
| staff_passkeys | POST | `/api/auth/staff/passkey/register/verify` | NOT IMPLEMENTED | Intentionally retired for security; excluded until approved secure implementation |
| staff_passkeys | POST | `/api/auth/staff/passkey/remove` | NOT IMPLEMENTED | Intentionally retired for security; excluded until approved secure implementation |
| staff_passkeys | GET | `/api/auth/staff/passkey/status` | NOT IMPLEMENTED | Intentionally retired for security; excluded until approved secure implementation |
| storage | GET | `/api/files/{path:path}` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| storage | POST | `/api/upload` | PARTIAL | Matching Rust method/path; full contract validation pending |
| workforce | GET | `/api/workforce/accountant/expenses` | PARTIAL | Matching Rust method/path; full contract validation pending |
| workforce | POST | `/api/workforce/accountant/expenses/{claim_id}/decision` | PARTIAL | Matching Rust method/path; full contract validation pending |
| workforce | POST | `/api/workforce/attendance/punch-in` | PARTIAL | Matching Rust method/path; full contract validation pending |
| workforce | POST | `/api/workforce/attendance/punch-out` | PARTIAL | Matching Rust method/path; full contract validation pending |
| workforce | POST | `/api/workforce/expenses` | PARTIAL | Matching Rust method/path; full contract validation pending |
| workforce | POST | `/api/workforce/leave` | PARTIAL | Matching Rust method/path; full contract validation pending |
| workforce | GET | `/api/workforce/me` | PARTIAL | Matching Rust method/path; full contract validation pending |
| workforce | GET | `/api/workforce/owner/control` | PARTIAL | Matching Rust method/path; full contract validation pending |
| workforce | POST | `/api/workforce/owner/expenses/{claim_id}/decision` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| workforce | POST | `/api/workforce/owner/leave/{request_id}/decision` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| workforce | POST | `/api/workforce/owner/visits/{visit_id}/decision` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| workforce | POST | `/api/workforce/visits` | PARTIAL | Matching Rust method/path; full contract validation pending |
| workforce | POST | `/api/workforce/visits/{visit_id}/complete` | PARTIAL | Matching Rust method/path; full contract validation pending |
| workforce | POST | `/api/workforce/visits/{visit_id}/start` | PARTIAL | Matching Rust method/path; full contract validation pending |
| workforce_reports | GET | `/api/workforce-reports/monthly/{month}` | PARTIAL | Matching Rust method/path; full contract validation pending |
| workforce_reports | PUT | `/api/workforce-reports/plants/{plant_id}/payroll/{month}/{user_id}/draft` | PARTIAL | Matching Rust method/path; full contract validation pending |
| workforce_reports | POST | `/api/workforce-reports/plants/{plant_id}/payroll/{month}/{user_id}/mark-paid` | PARTIAL | Matching Rust method/path; full contract validation pending |
| workforce_reports | POST | `/api/workforce-reports/plants/{plant_id}/payroll/{month}/{user_id}/owner-decision` | PARTIAL | Matching Rust method/path; full contract validation pending |
| workforce_roster | GET | `/api/workforce-roster/me` | PARTIAL | Matching Rust method/path; full contract validation pending |
| workforce_roster | GET | `/api/workforce-roster/overview/{date_key}` | PARTIAL | Matching Rust method/path; full contract validation pending |
| workforce_roster | PUT | `/api/workforce-roster/plants/{plant_id}/attendance-config` | PARTIAL | Matching Rust method/path; full contract validation pending |
| workforce_roster | POST | `/api/workforce-roster/plants/{plant_id}/attendance/{attendance_id}/override` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
| workforce_roster | PUT | `/api/workforce-roster/plants/{plant_id}/roster/{date_key}/{user_id}` | PARTIAL | Matching Rust method/path; full contract validation pending |
| workforce_roster | POST | `/api/workforce-roster/plants/{plant_id}/shifts` | PARTIAL | Matching Rust method/path; full contract validation pending |
| workforce_roster | PUT | `/api/workforce-roster/plants/{plant_id}/shifts/{shift_id}` | NOT IMPLEMENTED | Missing business logic or contract; implementation required |
