# Plant Owner route preservation audit

Baseline: 9d06c278767ef3f93b9df56def0b71071dcaaf81

All catalog destinations below must remain reachable through Operations or More; Home contains only six shortcuts. Authentication and module-level permissions remain unchanged.

| Module | Existing route | Group |
|---|---|---|
| KYC Verification | `/kyc` | Account |
| Plant Orders | `/owner/orders` | Operations |
| Production & Dispatch | `/owner/operations` | Operations |
| Billing & Ledger | `/owner/billing` | Commercial |
| Billing History | `/owner/billing-history` | Commercial |
| Quotation Requests | `/owner/quotation-requests` | Commercial |
| Incident / SOS Register | `/owner/incidents` | Operations |
| Premium & Promotions | `/plans-promotions` | Account |
| Plant Profile | `/business/profile` | Account |
| Rate Cards | `/business/rates` | Commercial |
| Mix Designs | `/business/mixes` | Operations |
| Material Inventory | `/business/inventory` | Operations |
| Suppliers | `/business/suppliers` | Operations |
| Purchases | `/business/purchases` | Operations |
| Fleet Management | `/business/fleet` | Operations |
| Diesel Ledger | `/business/diesel` | Operations |
| Plant Quotations | `/business/quotations` | Commercial |
| Expenses | `/business/expenses` | Commercial |
| Payroll | `/business/payroll` | Workforce |
| Plant Attendance | `/business/attendance` | Workforce |
| Plant Staff | `/business/staff` | Workforce |
| Plant Customers | `/business/customers` | Commercial |
| Plant Reports | `/business/reports` | Operations |
| Workforce & Field Activity | `/workforce` | Workforce |
| My Shift & Roster | `/shift-roster` | Workforce |
| My Payslip | `/my-payslip` | Workforce |
| Workforce Reports | `/workforce-reports` | Workforce |
| Employee Master & Salary | `/employee-master` | Workforce |
| Payroll Closure & Payslips | `/payroll-closure` | Workforce |
| Notifications | `/notifications` | Account |

Additional existing Operations destination: Driver Onboarding (`/owner/drivers`), retained under More → Workforce. Production and dispatch previously returned to Operations; the redesigned entry opens the existing `/owner/orders` queue filtered to processing. Order details remain `/order/[id]`, preserving approvals, production, dispatch, challans and POD.

Contracts: `/owner/home`, `/owner/orders`, `/notifications`; theme provider `src/theme/ThemeProvider.tsx`; uploaded symbols `src/components/VectorSymbol.tsx`; owner guard `app/owner/_layout.tsx`. Owner and legacy owner aliases retained. Shared dashboards, authentication, database schema and business mutations are outside this change.

Both light-background filenames exist and contain the same image. Metro handles the lowercase `.png` asset; the uppercase `.PNG` is interpreted as source JavaScript, so owner pages reuse `Background Light Theme.png`. No wallpaper pixels changed.
