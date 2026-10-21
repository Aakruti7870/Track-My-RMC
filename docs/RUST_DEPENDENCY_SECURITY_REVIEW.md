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
