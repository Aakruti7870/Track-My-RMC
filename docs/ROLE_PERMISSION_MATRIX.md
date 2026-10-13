# TrackMyRMC — Role and Permission Matrix

**Date:** 2026-10-13  
**Status:** Unified Specification & Authorization Boundary  
**Enforcement Boundary:** Server-side Axum middleware (`check_role` & `AuthUser`), PostgreSQL Foreign Key scoping, and Bearer JWT Claims.

---

## 1. Role Taxonomy Reconciliation

| Role Identifier (Canonical) | Alias / Database Representation | Human-Readable Label | Login Channel & MFA Policy | Primary UI Surface | Data Isolation Boundary |
|---|---|---|---|---|---|
| `customer` | `customer` | Customer | WhatsApp OTP (Phone) | Mobile App (`/customer`) | Own user ID (`customer_id`), own sites, own orders, visible plants. |
| `driver` | `driver` | Transit Mixer Driver | WhatsApp OTP (Phone) | Mobile App (`/driver`) | Assigned trips, assigned transit mixer, own attendance. |
| `plant_owner` | `owner`, `plant_owner` | Plant Owner | Email OTP + TOTP MFA | Mobile App (`/owner`) & Web | Owned plants (`owner_id`), staff, fleet, financial ledger, and orders of owned plants. |
| `dispatcher` | `dispatcher` | Dispatcher | Email OTP + TOTP MFA | Mobile App (`/dispatcher`) | Assigned plant (`plant_id`), dispatch queue, orders, transit mixer fleet. |
| `operator` | `operator` | Plant Operator / Batcher | Email OTP + TOTP MFA | Mobile App (`/operator`) | Assigned plant (`plant_id`), active batching queue, mix design targets. |
| `supervisor` | `supervisor` | Plant Supervisor | Email OTP + TOTP MFA | Mobile App (`/supervisor`) | Assigned plant (`plant_id`), field staff, daily roster, quality tests. |
| `accountant` | `accountant` | Plant Accountant | Email OTP + TOTP MFA | Mobile App (`/accountant`) | Assigned plant (`plant_id`), expense verification, payroll draft, purchases, billing. |
| `quality_engineer` | `quality_engineer` | Quality Engineer | Email OTP + TOTP MFA | Mobile App (`/quality_engineer`) | Assigned plant (`plant_id`), concrete cube compressive tests, batch quality sign-off. |
| `fleet_manager` | `fleet_manager` | Fleet Manager | Email OTP + TOTP MFA | Mobile App (`/fleet_manager`) | Assigned plant (`plant_id`), vehicle maintenance, transit mixers, driver roster. |
| `store_manager` | `store_manager` | Store / Inventory Manager | Email OTP + TOTP MFA | Mobile App (`/store_manager`) | Assigned plant (`plant_id`), raw materials inventory, purchase receipts, stock adjustments. |
| `admin` | `admin`, `central_admin` | Central Administrator | Email OTP + TOTP MFA (5-min Step-Up for high risk) | Admin Web Dashboard (`admin-web`) | Global platform visibility; read/write with audit logging. |

---

## 2. Granular Role-Permission Matrix

| Functional Capability | Customer | Driver | Plant Owner | Dispatcher | Operator | Supervisor | Accountant | Quality Eng. | Fleet Mgr. | Store Mgr. | Admin |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Authentication & Profile** |
| WhatsApp OTP Login | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Work Email OTP Login | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| TOTP MFA Verification | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| WebAuthn / Passkeys | 🚫 (Blocked) | 🚫 (Blocked) | 🚫 (Blocked) | 🚫 (Blocked) | 🚫 (Blocked) | 🚫 (Blocked) | 🚫 (Blocked) | 🚫 (Blocked) | 🚫 (Blocked) | 🚫 (Blocked) | 🚫 (Blocked) |
| Play Reviewer Login | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View Profile (`/api/me`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Submit Account Deletion | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Complete Account Deletion | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Plant Discovery & Onboarding** |
| Search Public Places | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Submit Plant Onboarding | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Review / Approve Onboarding | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Customer Order Management** |
| Browse Verified Plants & Grades | ✅ | ❌ | ✅ (Owned) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Manage Delivery Sites | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Submit Quotation Requests (RFQ) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Create / Cancel Orders | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Track Live Order / Mixer GPS | ✅ (Own) | ✅ (Assigned) | ✅ (Owned) | ✅ (Plant) | ❌ | ✅ (Plant) | ❌ | ❌ | ✅ (Fleet) | ❌ | ✅ |
| Create Pour Plans | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Record Material Receipts | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Record Cube Test Results (Customer) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Plant Operations & Logistics** |
| Approve / Reject Orders | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Create Order Loads & Assign Fleet | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Generate Gate Passes | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Start / Complete Batch Production | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Plant Quality Inspection & Cube Testing | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ |
| Respond to Customer RFQs (Quotes) | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| **Fleet & Driver Operations** |
| View Assigned Trips | ❌ | ✅ | ✅ (Plant) | ✅ (Plant) | ❌ | ❌ | ❌ | ❌ | ✅ (Fleet) | ❌ | ✅ |
| Trip Progress (Start, Arrive, Unload) | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Driver GPS Location Ping | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Sign Digital Challan | ✅ (Receiver) | ✅ (Driver) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Submit Proof of Delivery (POD) | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Driver Emergency SOS Alert | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Resolve SOS Incidents | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ |
| **Materials & Inventory** |
| View Raw Materials Stock | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| Adjust Material Stock | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Record Supplier Purchase Receipts | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ |
| Record Diesel Fuel IN/OUT | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ✅ |
| **Finance & Accounting** |
| Plant Rate Cards & Mix Designs | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Record Plant Expenses | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| View Plant Invoices & Record Payments | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Plant Financial Ledger & Insights | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Plant Subscription Plans & Activation | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Workforce & HR** |
| Daily Employee Shift Roster | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Attendance GPS Check-in / Check-out | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Apply for Leave | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Approve / Reject Leave | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Log Client Visits (Start/Complete) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Submit Employee Expense Claims | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Verify Expense Claims (Stage 1) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Approve Expense Claims (Stage 2) | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Employee Master & Salary Profiles | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Draft Monthly Payroll | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Approve & Close Payroll Period | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| View Own Payslips (`/api/payroll-periods/me/*`) | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Support & Platform Governance** |
| Submit Support Case / Ticket | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Reply to Own Support Case | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Staff Support Ticket Resolution | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Admin Control Center Management | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Reviewer Access Mode Toggling | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Platform Audit Logs (`audit_logs`) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## 3. Data Isolation and Multi-Tenancy Invariants

1. **Customer Tenancy:**
   - Every customer query filters strictly by `customer_id = auth_user.user_id`.
   - Customers cannot view other customers' orders, delivery sites, pour plans, or receiving records.
2. **Plant Tenancy:**
   - Staff members (`dispatcher`, `operator`, `supervisor`, `accountant`, `quality_engineer`, `fleet_manager`, `store_manager`) belong to exactly one plant through `plant_staff.plant_id`.
   - Handlers verify that the `plant_id` parameter matches the staff member's registered plant or return `403 Forbidden`.
   - Plant Owners can own multiple plants (`rmc_plants.owner_id = auth_user.user_id`). Plant-level operations verify ownership.
3. **Driver Scoping:**
   - Drivers query only loads and trips where `order_loads.driver_id = auth_user.user_id` or `transit_mixers.driver_id = auth_user.user_id`.
4. **Administrative Scoping:**
   - Central Administrators have global platform read/write capabilities with mandatory security audit logging in `audit_logs`.
   - High-risk operations (user suspension, reviewer access change, root privilege changes) require fresh TOTP step-up verification within a 5-minute window.
