# Rust dependency security review — 21 October 2026

The unchanged original Cargo.lock produced **15 vulnerability entries and three unmaintained warnings** under cargo-audit. No advisory was ignored. The candidate lockfile produces **one vulnerability entry and no warnings**.

## Remediation

- Upgrade SQLx 0.7.4 to 0.8.6, which includes the fix for [RUSTSEC-2024-0363](https://rustsec.org/advisories/RUSTSEC-2024-0363.html), a database protocol encoding issue. Explicitly select PostgreSQL, Tokio/rustls, macros, migrations, UUID, chrono, JSON and bigdecimal; disable default features.
- Align bigdecimal to 0.4, SQLx's supported numeric type. Replace allocation-only integer comparisons using the new direct numeric comparisons; preserve validation boundaries and exact decimal handling.
- Update compatible lockfile dependencies, including rustls 0.23.46+, rustls-webpki 0.103.16+ and updated webpki roots. Remove older 0.21 rustls/certificate chains from the resolved graph.
- Remove the unused validator dependency. No backend source uses that crate; application input checks remain in their existing route/service validation. This removes its vulnerable idna 0.5 and unmaintained proc-macro-error chain.
- Keep every migration file and checksum unchanged. Add a PostgreSQL test that constructs the SQLx 0.7.4 history-table schema and previously applied migration history independently, then verifies the new migrator runs twice without changing history or a stored application row. Existing migration/quantity/money/HR/auth/tenant tests remain mandatory on PG16 and PG18.

Local cargo check, fmt, Clippy with warnings denied and unit tests are required. The complete PG16/PG18 and actual browser journeys must pass on current main before merge. This report does not replace a representative-data restore/rollback rehearsal.

## Residual advisory, explicitly unresolved in the full lockfile audit

| Package | Advisory | Evidence | Status |
| --- | --- | --- | --- |
| rsa 0.9.10 | [RUSTSEC-2023-0071](https://rustsec.org/advisories/RUSTSEC-2023-0071.html), Marvin private-key timing attack | Cargo.lock retains SQLx's optional MySQL dependency resolution. `cargo tree -i rsa` returns no selected dependency path for this PostgreSQL-only application; no MySQL driver is enabled. | Full cargo-audit still exits nonzero. Do not call the lockfile audit clean or add an ignore. Reassess if MySQL/RSA private-key operations become enabled; record release-review acceptance separately. |

The baseline also flagged idna RUSTSEC-2024-0421; rustls RUSTSEC-2026-0346/0347/0348/0349; rustls-webpki RUSTSEC-2026-0098/0099/0104/0382; and webpki-roots RUSTSEC-2026-0381. These entries are absent from the candidate audit after remediation. Counts are dependency/advisory entries, not unique exploitable production vulnerabilities.

No credentials, URLs containing secrets, customer data or production SQL writes are included in the audit output. No security failure is suppressed. The public-launch decision remains NO-GO for the other recorded recovery/provider/operational/device gates and any unaccepted residual security risk.


## 8 November 2026: PR #161 security audit and remediation

The older assessment in this document is historic, **not** a current RustSec clearance. On the baseline Cargo.lock, the newly added unsuppressed RustSec scan [run #42501259713](https://github.com/Aakruti7870/Track-My-RMC/actions/runs/42501259713) confirmed **three active vulnerability findings** and **one yanked crate**:

- **RUSTSEC-2026-0384 — tokio 1.54.0**: critical for this application's periodic native worker, which calls Interval::tick. Patched release **1.54.1** exists; PR #161 pins 1.54.1 and regenerates the Cargo lockfile.
- **RUSTSEC-2026-0387 — crypto-bigint 0.5.5**: timing variability in secret arithmetic; fixed release >=0.7.6. The application only signs HS512 JWTs and does not use asymmetric JWT algorithms. PR #161 switches jsonwebtoken 10.3 from `rust_crypto` to `aws_lc_rs`, with default features disabled. The regenerated lockfile no longer contains crypto-bigint. The JWT HS512 contract remains unchanged; mandatory PG16/PG18 integration/auth regression CI determines compatibility.
- **RUSTSEC-2023-0071 — rsa 0.9.10**: still present in regenerated lockfile because the selected SQLx package resolves the optional `sqlx-mysql` dependency. PostgreSQL-only application features do not intentionally use the MySQL driver; **this is a potential non-reachable lockfile advisory, NOT a verified fix or an accepted exception.** Independent selected-feature dependency-tree evidence, confirmation of no RSA private-key usage, and authorized, documented release-specific risk acceptance are required before choosing a narrower policy.
- The yanked warning on the baseline was consistent with tokio 1.54.0; assess the final Cargo.lock again for any remaining warnings after the 1.54.1 update.

**Security policy (updated 2026-11-08):** the new `Dependency Security Audit` workflow always scans the **complete** Rust lockfile and records every finding. It independently produces the selected production dependency tree with `cargo tree --edges normal,build` for the PostgreSQL target. **Only** `RUSTSEC-2023-0071` on `rsa 0.9.10` may receive `PASS_WITH_DOCUMENTED_OPTIONAL_RISK`, and only if `rsa` and `sqlx-mysql` are both absent from the selected executable graph. Any other vulnerability, selected RSA/MySQL feature, invalid evidence or yanked dependency is BLOCKED. The residual advisory remains visible in machine-readable and PR evidence; this is a code graph non-exposure assessment, **not independent production release risk approval**. Cargo audit runs without `--ignore`. Exact-SHA production approval, scoped IAM and live operational acceptance remain separate hard gates.

A separate production acceptance process also requires AWS operator least privilege, real PostgreSQL migration ledger + TLS evidence, support/MFA readiness and independent approval of the exact new main SHA. Root audit access is read-only for this assessment.
