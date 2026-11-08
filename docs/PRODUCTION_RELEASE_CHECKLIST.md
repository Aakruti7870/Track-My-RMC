# Production release acceptance checklist

**Current state: independent acceptance required.** This is a living checklist; historical release records remain in docs/release/ and Git history. A successful code merge or green CI is never evidence that the new SHA is deployed.

| Gate | Required proof | Status as of 2026-11-08 audit |
| --- | --- | --- |
| Source and reviews | Exact current main SHA, reviewed changes, no unresolved security findings | PR #159 merged as code; complete-repository audit branch under review |
| Backend and database regression | Rust format, check, strict Clippy and tests on PostgreSQL 16 and 18 | PASS on main merge SHA 277d7ed (Backend CI #42493945966) |
| Client and admin regressions | Expo typecheck/security/layout guards and admin web build | PASS on main merge SHA 277d7ed (Frontend CI #42493945959) |
| Android/Google Play | Signed AAB and real device/reviewer/permission/Data safety acceptance | NOT established by the web CI |
| Migration parity | Live readonly RDS ledger/checksums, pending migration and schema reconciliation | NOT verified live |
| Client TLS | Positive and negative production RDS TLS/hostname checks | NOT verified live |
| Infrastructure and operator | Scoped production IAM role, independent approval, least-privilege assessment | INCOMPLETE; connected audit identity is root |
| Restore/rollback | Witnessed safe restoration and SHA-pinned application rollback evidence | NOT verified |
| Privileged operator readiness | Approved Central Admin/Authority web credentials, TOTP and inbox acceptance | NOT verified live |
| Support/automation | Exact live flags, notification QA, opt-in and audit; no external messages | Feature switches default OFF; live values unverified |
| Cashfree and KYC | Provider/sandbox-to-live approval, legal/Play checks and specific enablement | GATED; not implied by merged code |
| GitHub production approval | Exact approved release SHA, main push CI and authorized workflow run | NOT independently verified |
| Deployed release | S3 artifacts, SSM success, EC2 running SHA marker, API/admin/Expo smoke | NOT established for SHA 277d7ed; release workflow skipped |

The main-branch backend/frontend jobs for 277d7ed passed. The two production workflow invocations on that SHA were **skipped**; there is no confirmation of a deployment for it.

Production activation requires **all** relevant release gates to pass on the selected immutable commit. Do not replace this evidence with unscoped root commands, modified applied migration checksums, placeholder credentials or a bypassed approval variable.

Primary references: [AWS deployment](DEPLOYMENT.md), [PR #157 security assessment](security/pr157-release-assessment.md), [PR #159 support assessment](security/pr159-release-acceptance.md), [RMC payment policy](payments/RMC_PREPAID_PLAY_COMPLIANCE_AND_ROLLOUT.md) and [this repository audit](audits/2026-11-08-repository-audit.md).
