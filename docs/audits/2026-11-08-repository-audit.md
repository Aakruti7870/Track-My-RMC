# TrackMyRMC — repository-wide source, configuration and documentation audit

**Assessment date:** 2026-11-08  
**Repository:** Aakruti7870/Track-My-RMC  
**Baseline main:** 277d7ed5659d6a5a9572b86df3a9d9212039c799 (merged PR #159)  
**Remediation branch:** audit/repository-documentation-and-config-20261108  
**Change policy:** Preserve active module behavior, app roles, customer/plant data, migration history, payment security gates and worker activation controls.

## Executive decision

**Code audit: corrective PR required; release acceptance: BLOCK.** Main's required CI is green, but a passing build cannot certify all functional workflows or production readiness. The documented inconsistencies have been corrected on a dedicated review branch. No AWS deploy, production migration, user-data deletion, live payment, email/WhatsApp message or automation activation was performed.

The audit found **confirmed environment/documentation failures and two narrow defensive code defects**, not evidence that the main application is generally broken. No permission bypass, payment authorization failure, or cross-tenant data exposure was demonstrated by the inspected code. Do not interpret absence of an observed problem as formal certification of every function.

## Inventory and verification coverage

GitHub recursive tree at the baseline SHA was **not truncated**: 847 total tree entries, **734 tracked files**, including assets. Of these, **476 files have code-like extensions** (Rust, JavaScript/TypeScript, Python, SQL, shell and others), not all executable at runtime.

Inventory includes: 116 backend/src files, 22 backend/tests files, 54 database migrations, 108 Expo app files, 99 Expo src files, 36 frontend scripts, 39 ops files (including evidence and tests), and 10 admin-web files. The remaining entries include assets, config, plugin files, docs and lockfiles.

Methods:
1. Enumerated the complete repository tree and identified build/runtime/test groups.
2. Inspected the active backend/frontend/admin production workflows, release SHA guard, environment/config parsing, source samples and release reports.
3. Performed targeted code inspection of core Rust authentication and session management, privileged support, native automation, Cashfree, routes, storage, ownership/roles, Expo API/location and the Android trip-location integration.
4. Used GitHub search for high-risk TODO/FIXME/unimplemented/panic patterns and manually classified representative matches, including static inline HTML and test-only unwraps.
5. Verified the exact baseline **main push** GitHub CI jobs, plus the deployment workflow outcomes.
6. Added offline source-contract tests; a fresh CI run on the remediation PR is required before accepting changes.

**Coverage limit:** This is a complete **file inventory**, a broad build/CI verification and a targeted security/source review. It is **not** a manual, line-by-line functional proof of all 476 code-like files, a complete coverage-instrumented test run, a real-device QA campaign, or a production penetration test. Some provider paths cannot be exercised without approved credentials.

## Baseline CI evidence (main SHA 277d7ed)

| Run | Status | Scope |
| --- | --- | --- |
| Backend CI #42493945966 | PASS | Rust format, check, strict Clippy, PostgreSQL 16/18 tests and integrated regression steps |
| Frontend CI #42493945959 | PASS | Expo typecheck, UI/privacy/asset/layout checks, Expo web build and admin-web build |
| AWS production run #42494170835 | SKIPPED | Exact release approval gate not satisfied / no deployment job |
| AWS production run #42494847175 | SKIPPED | Exact release approval gate not satisfied / no deployment job |

Baseline CI links: [Backend](https://github.com/Aakruti7870/Track-My-RMC/actions/runs/42493945966) · [Frontend](https://github.com/Aakruti7870/Track-My-RMC/actions/runs/42493945959).

CI validates compiled and exercised paths; it does not imply a new Android Play release or customer-provider acceptance. Any changes on this remediation branch require **new head-specific CI** and review.

## Confirmed findings and controlled remediations

| ID | Priority | Finding | Resolution / verification plan |
| --- | --- | --- | --- |
| A-01 | Medium | Root README describes SQLx 0.7 (Cargo uses 0.8.6), nonexistent backend/handlers directory, outdated workflows and incomplete web-only admin/authority/automation boundaries | Rewrote root README with current module structure, local commands, permissions and exact-SHA production gates; offline docs contract test |
| A-02 | Medium | frontend/README.md retains create-expo-app reset instructions unsuitable for an established multi-role product | Replaced with project-specific setup, roles, privacy, Native Android/Play testing and safety restrictions |
| A-03 | High for copied config | backend/.env.example sets production mode with CORS_ORIGIN=*, which production config explicitly rejects; examples can fail startup | Changed to development-only defaults, explicit local CORS, no enabled automation, and clearly marked placeholder credentials |
| A-04 | Medium | frontend/.env.example advertises retired Render production backend, creating wrong API routing in copied builds | Updated example to https://trackmyrmc.com, retained safe local HTTP guidance |
| A-05 | Low | Initial PostgreSQL connection failure is mislabeled as a migration failure in backend/src/db/pool.rs | Changed diagnostic text only; connection, pool, query and migration behavior unchanged |
| A-06 | Low, defense-in-depth | TOTP verifier uses unwrap on UNIX_EPOCH clock conversion; an invalid host clock can panic a request | Return AppError::InternalError instead of panicking; TOTP computation, skew and accepted credentials unchanged |
| A-07 | Medium | Control-plane document listed six Authority delegation permissions and read-only support, while current code allows seven including explicitly governed support.reply | Updated role policy text without changing permission implementation |
| A-08 | Medium | docs/DEPLOYMENT.md describes Render as live production, and release checklist says Authority is unimplemented / old migration counts | Replaced with AWS RDS/EC2/SSM/S3 release guide and current dated gating checklist |
| A-09 | Medium | docs/API.md production base URL references Render | Corrected production API URL |
| A-10 | Low | Root .env.example implies unsupported database pool-size environment overrides and is labeled production with a local database URL | Converted to local example; removed misleading pool-size overrides, kept automation/recovery disabled |
| A-11 | Process | Configuration and documentation can silently diverge from source after green CI | Added ops/tests/test_repository_audit_contract.py to verify samples, role allowlist, SQLx version, local doc links and exact-SHA release guard |

| A-12 | Medium, independent reviewer P2 | Replacement release checklist omitted outstanding npm and Rust dependency-security approval requirements | Reintroduced an explicit BLOCKED dependency gate requiring a current locked-graph audit and remediation or independent documented residual-risk acceptance |
| A-13 | Medium, independent reviewer P2 | Local admin dev instructions would otherwise connect to the production API, and backend CORS examples omitted the Vite origin | Added admin-web/.env.example and safe local Vite default, explicit README steps, and localhost:3000 development CORS entries |

All corrections are on the **audit branch**, not a direct edit of main. No existing schema migration was modified or rewritten.

## Functional and security review by subsystem

| Subsystem | Source or regression evidence | Verdict |
| --- | --- | --- |
| Authentication / MFA / sessions | Rust control_center, authority, staff_support, jwt, middleware, otp, totp, refresh; PR #159 role/session/lock tests | Baseline CI PASS; narrow clock failure hardened; independent live identity QA remains |
| Central Admin and Authority | Approved web session, explicit grants and fresh-MFA management; support.reply delegation corrected in PR #159 | Code-only passed; real production credentials and operator tests not verified |
| Customer/order/RFQ and payment | Customer and order routes, order_payment and Cashfree sandbox/prepaid paths, SQLx test suite | Baseline CI PASS; Cashfree live provider settlement/refund release gated |
| Driver, GPS, dispatch and POD | Native Android trip-location module, maps routes, driver and owner modules, Expo role checks | Baseline CI PASS; signed AAB/location/background real-device acceptance outstanding |
| Quality, inventory, payroll, workforce | Rust routes/services and PostgreSQL migration/test coverage | Build/test evidence available; complete tenant-specific operational acceptance not certified |
| Native operations automation | Rust automation service/router, PostgreSQL uniqueness/lock policy, default worker flag OFF | Code merged; activation separately governed |
| Customer support follow-ups | PR #159 targeted security review, 5 resolved inline findings, scoped web notification feed and token/session rechecks | Code merged; live operator/inbox acceptance and worker flags unverified |
| Admin dashboard and Expo | TypeScript build/typecheck, role route and browser tests in main CI | PASS on main SHA; not equivalent to Android/iOS production acceptance |
| Database / migrations | 54 migration files, PG16/18 CI and isolated migration parity tests | Baseline CI PASS; live production ledger/parity must be confirmed before deployment |
| CI/CD and AWS | Exact-SHA guarded GitHub workflow; release scripts and read-only AWS metadata | Deployment skipped; no production release proof |

Source-pattern searches did not find an actionable unimplemented! or FIXME in the indexed source. A static inline script in Expo web HTML is a fixed authored string, not proof of externally sourced HTML injection. Unwrap sites reviewed in maps, Cashfree and notification code were test-only; the TOTP runtime unwrap was corrected. Pattern matches alone are not security findings.

## Production acceptance — deliberately separate

As of this assessment, the AWS-connected audit principal is root. Read-only metadata previously confirmed RDS PostgreSQL 18.3 available, protected/private, automated backups, and EC2/SSM online. The presence of a backup **does not** demonstrate successful restore. No live migration-ledger/TLS positive-negative tests, scoped IAM release approval, real web support operator enrollment, activated worker flags, approved provider settlement or exact release-approval variable verification were supplied. AWS production release workflows for 277d7ed were skipped.

**Do not** deploy, run migrations, use root for operations, reconfigure LIVE Cashfree, activate automation or change TRACKMYRMC_APPROVED_RELEASE_SHA based solely on this audit. This report contains **no approval** to perform such actions. The existing reviewer access and historical application/business data must be preserved.

## Required next gates

1. Run this audit PR's actual Rust PostgreSQL 16/18, frontend, admin and offline ops tests on its final commit; inspect and fix failures without bypassing security checks.
2. Obtain an independent review of the changed Rust code, env examples and new tests; then merge when code-only criteria pass.
3. For a later separately authorized production release, validate live migration parity and TLS, scoped operator IAM, approved operator/inbox QA, reviewer/Play readiness and the exact approved main SHA. Keep both automation switches off until a distinct activation approval.

## Reproduction commands

~~~bash
python3 -m unittest discover -s ops/tests -p 'test_*.py' -v
cd backend
cargo fmt --all -- --check
cargo check --all-targets
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all
cd ../frontend
npm ci && npm run typecheck && npm run check:auth-routing && npm run check:modules
cd ../admin-web
npm ci && npm run build
~~~

Use an isolated PostgreSQL database for Rust integration tests. GitHub Actions are authoritative for the repository's tested toolchain; no full local checkout/test execution was available in this audit environment.


## Independent review follow-up

Codex's first exact-head review of the audit PR identified two legitimate P2 issues: the missing dependency-security release gate and unsafe admin local development API defaults. Both were fixed without changing production authorization or API routing. The new regression test guards against recurrence. A fresh final-head CI and independent review are still required; the initial green frontend checks and earlier commits do not prove the later corrections.

**Dependency-security status remains BLOCKED:** Previous locked-node audits documented residual high-severity transitive advisories, including braces and node-forge; the Rust advisory review is separate. Re-evaluate the final locked dependency graph and build/signing exposure, remediate or document independent explicit acceptance before any public release. See docs/DEPENDENCY_SECURITY_REVIEW.md and docs/RUST_DEPENDENCY_SECURITY_REVIEW.md.
