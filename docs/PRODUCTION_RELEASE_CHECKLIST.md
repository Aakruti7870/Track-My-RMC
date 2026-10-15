# Production release checklist

Overall: BLOCKED. Do not request deployment approval until the functional gates pass.

| Gate | Status | Evidence or required action |
|---|---|---|
| Combine PRs 36/37/38/39 | COMPLETE | Integration commit retains source ancestry |
| Migration numbering | COMPLETE | 0019/0020/0021/0022 unique; no applied file edited |
| Baseline upgrade and checksum preservation | PARTIAL | Isolated SQLx test passed; representative restore and live history pending |
| Central Admin separation | PARTIAL | Dedicated web MFA and permissions tested; recovery and approved provisioning outstanding |
| Critical production-to-delivery path | PARTIAL | Regression added; latest assertions await CI |
| Complete business and role parity | PARTIAL | See API_CONTRACT_PARITY.md and ROLE_MODULE_PARITY_MATRIX.md |
| External authentication/KYC/payment channels | BLOCKED | Live seeded identities and approved provider tests not executed |
| Strict backend gates, PostgreSQL 16/18 | PARTIAL | Strict lint passed earlier revision; matrix run pending |
| Mobile/admin build and browser flows | PARTIAL | Earlier builds passed; latest CI and real browser/device flows pending |
| Android AAB/runtime permissions | PARTIAL | PR37 build succeeded; current build and device workflow pending |
| AWS inventory | COMPLETE | Intended EC2/RDS/secret metadata read only |
| Backup existence | COMPLETE | Seven available automated snapshots |
| Restore/reconciliation rehearsal | BLOCKED | No restored staging copy verified |
| Approved Central Admin mappings | BLOCKED | No existing admin auto-elevated; explicit approved identity/grants/enrollment needed |
| Final release manifest and rollback rehearsal | PARTIAL | Existing manual deployment reviewed; final verified SHA and compatibility rollback pending |
| Final production approval | BLOCKED | Not requested because required gates are incomplete |
| Deployment and production verification | BLOCKED | No deployment performed |

Existing manual-only GitHub Actions deployment and unrelated services remain unchanged. Never pass production confirmation until all gates above are satisfied.
