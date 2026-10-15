# Production release checklist

Overall: BLOCKED. Full feature parity: PARTIAL. Production approval is not requested while independent implementation and required validation remain incomplete.

| Gate | Status | Evidence / required work |
|---|---|---|
| Preserve and integrate PRs 36/37/38/39 | COMPLETE | Source ancestry retained; main conflict reconciled in integration branch; draft PR40 |
| Resolve pending SQLx numbering | COMPLETE | Unique delivery 0019/0020, Control Center 0021; no prior migration rewritten |
| PostgreSQL baseline checksum and empty-chain tests | PARTIAL | Earlier revision passed PG16/18; 0026/0027 candidate passed PG16/18; latest quotation candidate must pass; actual production history and restored-data rehearsal pending |
| Nonprivileged auth | PARTIAL | Ten approved synthetic role fixtures, generated OTPs, MFA/recovery/logout passed; replay changes passed run 38781457530; live provider destinations unavailable |
| Central Admin separation | PARTIAL | Dedicated approval/session provenance/permissions/step-up and browser tests passed; persistent approved accounts, enrollment and recovery incomplete |
| Authority functions | NOT IMPLEMENTED | Reference designation does not authorize an account; dedicated authentication/workspaces remain closed |
| Production, dispatch, GPS, evidence, POD | PARTIAL | Transactional stock/quantity/dispatch/POD tests passed; real-device and full customer-origin journey pending |
| Finance and payroll | PARTIAL | Concurrent invoice/payment and immutable payroll snapshot tests passed; RFQ/quotation DTOs, salary calculations, reopen policy and remaining operations incomplete |
| Customer order/assistant contracts | PARTIAL | Actual form wired to transactional service; order/lifecycle run 38781019266 passed; quotation changes awaiting CI |
| Automation security | PARTIAL | No default secrets/fabricated delivery; lease tests passed run 38781019266; actual delivery adapter BLOCKED |
| All reference modules and screen journeys | PARTIAL | API inventory lists all 297 entries; 98 paths unmatched; matched paths still need complete contracts |
| Strict fmt/check/Clippy/tests on PG16/18 | PARTIAL | de950c26 passed; 276122c1 and d95d5cc5 passed; quotation candidate requires fresh results; no gate weakened |
| Expo/admin TypeScript, policy, layout, Doctor, web build | PARTIAL | CI frontend runs pass through 83ba8b03; d95d5cc5 also passed frontend run 38782012228; quotation candidate must pass; mobile runtime checks remain |
| Dedicated Admin browser | PARTIAL | Real Rust/Postgres authorized login/workspaces/logout passed on prior candidate; rerun current candidate |
| Signed Android AAB | PARTIAL | deea5c3 run 38777317672 passed, package com.trackmyrmc.concreteking, version 2.0.32/code90; latest build pending, no device acceptance |
| Staging foundation | PARTIAL | cfn-lint clean and AWS ValidateTemplate accepted; Guard 42 PASS/13 FAIL/16 SKIP; cost/security review in STAGING_ENVIRONMENT_PLAN.md |
| AWS provisioning approval | BLOCKED | No stack/change set/resources created; user only approved local validators |
| Live OTP/KYC/payment testing | BLOCKED | No controlled provider destinations approved; synthetic identifiers never sent to providers |
| Historical MongoDB migration | BLOCKED | Authorized real-data source backup not found; seeds excluded |
| Dedicated Authority/Central Admin staging records | BLOCKED | No active identity, enrollment, grants or recovery verified; no accounts created/elevated |
| Production backup restore/rollback rehearsal | BLOCKED | Seven snapshot metadata records observed; no authorized restoration performed |
| Final release manifest | PARTIAL | Draft PR contains ongoing work; no accepted release SHA or final rollback rehearsal |
| Production approval/deployment/verification | BLOCKED | No production-changing action; production and GOLD-e unchanged |

Retain the manual production workflow confirmation gate. A successful build does not approve deployment, provider sends or privileged enrollment. Re-price and resolve or explicitly approve staging policy exceptions before any AWS provisioning. After all required acceptance gates pass, prepare a concrete release/rollback review and obtain final explicit production approval.
