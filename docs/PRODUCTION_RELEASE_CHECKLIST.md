# Production release acceptance checklist

**Assessment: 9 November 2026. Baseline: `1c2f9a53be51895687aadcb921e1c5c3d268e90b`.** A status belongs to its recorded commit and evidence source. Repeat the applicable gates for each candidate; a baseline PASS does not certify a later branch.

**Candidate disposition: BLOCKED pending final-head checks, review and independent release acceptance.** This audit does not authorize a new deployment or provider/worker activation.

| Gate | Required proof | Evidence available for the baseline / candidate |
| --- | --- | --- |
| Source and reviews | Immutable SHA, reviewed diff and disposition of every material finding | Baseline is merged PR #174. The 9 November quality audit is a separate candidate; review its exact head. |
| Backend and database regression | Format, check, strict Clippy and PostgreSQL 16/18 tests | Baseline [Backend CI](https://github.com/Aakruti7870/Track-My-RMC/actions/runs/42662483976) PASS. No local Rust/PostgreSQL run in the quality-audit workspace. Candidate CI must pass. |
| Client and admin regression | Expo typecheck/guards/export, responsive browser checks and admin build | Baseline [Frontend CI](https://github.com/Aakruti7870/Track-My-RMC/actions/runs/42662483981) PASS. Candidate validation is recorded in [the audit](audits/2026-11-09-project-quality-audit.md). |
| Android / Google Play | Signed candidate AAB; device/reviewer/permission/Data safety acceptance | Web tests do not establish signed-device or Play acceptance. Retain artifact digest, version code, devices and reviewer evidence. |
| Dependency security | Final locked Node and selected-production Rust graphs; disposition of active advisories | Baseline [Dependency Security Audit](https://github.com/Aakruti7870/Track-My-RMC/actions/runs/42662483988) PASS under its configured policy. Local npm scan: frontend full 41 moderate + 1 low affected entries; production subset 34 moderate + 1 low; admin full 0. All report 0 high/critical. Current lock resolves node-forge 1.4.3; the braces advisory was withdrawn. Residual exposure review remains required; workflow success alone is not that review. |
| Migration parity | Read-only candidate migration/checksum comparison, pending migration review and schema compatibility | 56 tracked automatic migration files at baseline. Current live ledger and rollback compatibility were not independently inspected in this audit. |
| RDS TLS | Positive connection and negative untrusted-CA/hostname cases against the intended environment | Existing deployment workflow success is recorded; independently retain the required TLS evidence for the release. |
| Infrastructure and operator | Approved scoped release identity and reviewer, current least-privilege assessment | Not independently revalidated here. Historical reports about an earlier connected root identity are not current identity evidence. |
| Restore / rollback | Witnessed restore with measured recovery time/data loss; compatible SHA-pinned rollback | Not independently revalidated here. A configured backup is not a restore drill. |
| Privileged operators | Approved Central Admin/Authority identities, MFA, permission denial, scoped inbox and revocation | Synthetic browser acceptance and baseline CI are available. Actual approved operator enrollment/acceptance must be recorded separately. |
| Support / automation | Approved flags, opt-in, authorization rechecks, monitoring and notification acceptance | Both automation switches remain separately governed. No worker activation or external communication was performed by this audit. |
| Cashfree / KYC | Approved provider environment/entitlements, consent, reconciliation and specific enablement | Provider acceptance is independent. Sandbox code, mocked responses and UI navigation do not prove live settlement or KYC verification. |
| GitHub release approval | Matching approved main SHA, successful push CI/security and authorized workflow | Baseline has a successful manually dispatched release run. A new candidate needs its own exact-SHA approval. |
| Deployed release | Artifact digest, S3 object identity, SSM result, runtime SHA and origin/edge smoke | Baseline [AWS run 42662931432](https://github.com/Aakruti7870/Track-My-RMC/actions/runs/42662931432) completed successfully, including SSM deploy and trusted-origin/edge verification. This is workflow evidence, not an independent live runtime inspection or evidence that the audit branch is deployed. |

Record each outstanding gate as PASS, FAIL, NOT VERIFIED or NOT APPLICABLE with rationale, owner, reviewer, immutable artifact/SHA and an evidence link. Never infer release approval from the absence of a failing test.

Historical 8 November assessment: baseline `277d7ed` had skipped release invocations and a then-open dependency assessment. That snapshot does not describe the 9 November baseline. Preserve historical reports; use the dated evidence above and re-check the actual candidate.

References: [AWS deployment](DEPLOYMENT.md), [quality audit](audits/2026-11-09-project-quality-audit.md), [dependency review](DEPENDENCY_SECURITY_REVIEW.md), [locked-graph evidence](audits/2026-11-09-dependency-evidence.json), [support acceptance](security/pr159-release-acceptance.md) and [payment policy](payments/RMC_PREPAID_PLAY_COMPLIANCE_AND_ROLLOUT.md).
