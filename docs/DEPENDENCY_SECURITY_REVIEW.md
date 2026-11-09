# Dependency security review — evidence history

**Latest locked-graph snapshot: 9 November 2026.** See [the current evidence](audits/2026-11-09-dependency-evidence.json) and [release checklist](PRODUCTION_RELEASE_CHECKLIST.md). Local npm audit reports frontend full: 41 moderate + 1 low affected entries; production subset: 34 moderate + 1 low; admin full: 0. All report 0 high/critical. The lockfile already resolves node-forge 1.4.3. Residual moderate/low review and exact-head RustSec evidence remain required. Counts depend on the audit database and graph; they are not distinct vulnerability counts.

## Historical assessment — 21 October 2026

Status: **PARTIAL; public launch remains blocked pending remediation or explicit risk acceptance.** No audit findings are suppressed.

The production lockfile at b99d7ae7 reported 22 high-severity affected dependency entries and zero critical entries under `npm audit --omit=dev --json`. These include transitive parents, not 22 distinct vulnerabilities.

## Candidate remediation

Pin the published `image-size` **2.0.4** release using an exact npm override; retain Expo 54 and React Native 0.81.5. The new release retains the CJS default function but removes the filesystem API. Full export exposed a second Metro caller that passes a filename. An install-time adapter converts that filename to bytes, requiring the exact Metro 0.83.3 version and original Assets.js SHA-256. It refuses unknown dependency contents and supports repeat installation. It does not modify the image parser or hide audit findings.

- Before changing the graph, parsed all **114 uploaded PNG/JPEG/WebP/SVG files** with both 1.2.1 and 2.0.4: every width/height matched.
- Added CI tests through Metro's actual `getAssetSize` for an independent one-pixel PNG and every uploaded supported image asset.
- Added an actual asynchronous file-based `getAssetData` test with an independent one-pixel PNG, covering the compatibility path that the initial Buffer-only checks missed.
- Added bounded child-process regressions for ICNS entry lengths 0, 1 and 7; malformed entries must throw within three seconds rather than hanging the build.
- The resulting production audit reports **21 high, zero critical**, with **image-size absent** from the vulnerability entries. This does not claim the whole dependency graph is safe.
- Full Expo export, existing frontend/Android policy checks, browser regressions and exact-commit CI remain mandatory before merging the candidate. A signed Android build/device validation remains a separate launch gate.

## Remaining root findings

| Package | Locked version | Advisory | Exposure and next action |
| --- | --- | --- | --- |
| braces | 3.0.3 | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), nested-pattern recursion denial of service | Reached through micromatch in the Metro/Expo build dependency graph. The deployed web service serves exported files through Nginx and runs Rust, not Metro. Repository/build inputs remain a relevant trust boundary. No compatible patched version is identified by the current audit; require reviewed upstream repair or explicit accepted exposure analysis. |
| node-forge | 1.4.0 | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv), malformed RSA verification acceptance | Used by Expo CLI/code-signing certificate tooling. Current production runtime does not run the Expo dev server. Build/signing workflows remain in scope; do not equate tooling-only reachability with an accepted exception. Current audit does not identify a compatible patched release. |

## Sources and limits

The installed package contents and actual Metro caller were inspected locally. The `image-size` audit ranges cover versions through 2.0.2: [ICNS](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), [JXL/HEIF](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq). The published 2.0.4 ICNS parser rejects entry lengths below eight bytes. Both advisories must remain part of regression review; the child-process test specifically exercises ICNS non-progress, while export/asset checks establish compatibility rather than proving every parser input safe.

No forced Expo downgrade, vulnerability ignore, framework major upgrade, unreviewed fork, or claim of accepted residual risk is included. Rust dependency advisory scanning and release-artifact reachability analysis remain outstanding. Use `npm ci` and repeat the audit on the final accepted release lockfile.


## Advisory status update — 8 November 2026

The 21 October assessment above remains useful historical evidence, **not a current active-advisory count**. GitHub officially **withdrew** [GHSA-vfj7-8cjw-p6xm (braces)](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) on **23 October 2026**, stating that the reported issue is not practically exploitable. Do not label this withdrawn advisory as an outstanding confirmed high-severity vulnerability. A new locked-graph audit is still needed to determine the current number and exposure of any other advisories.

In contrast, [GHSA-86w9-cpqp-85rv (node-forge)](https://github.com/advisories/GHSA-86w9-cpqp-85rv) remains a GitHub-reviewed **high-severity** advisory affecting versions through 1.4.0; the advisory currently lists **no patched version**. Review build/signing toolchain reachability and isolate trusted inputs, or obtain documented independent risk acceptance. Do not assume an unconditional production exploit path merely because the package appears in a development tool dependency.

**The dependency-security release gate stays BLOCKED** until the final Node and Rust lockfiles are re-audited and all active exposures have either a verified fix or an independently approved, narrowly scoped risk disposition. Do not use a historical high count or a withdrawn advisory as a substitute for a new audit.


## Corrected locked-graph evidence — 8 November 2026, PR #161

**This section supersedes the stale statement above that no patched node-forge release existed.** The current committed frontend package-lock at baseline main 54863d5a resolves node-forge **1.4.3** with an npm SHA-512 integrity value. Its two dependents, `@expo/cli@54.0.27` and `@expo/code-signing-certificates@0.0.6`, request ^1.3.3 and therefore accept the fixed version. Expo remains SDK 54; react-native remains 0.81.5. No risky framework migration was performed.

Independent GitHub-hosted npm audit on PR #161 (run 42501259713, audit produced by npm registry on 2026-11-08) observed:

| Lockfile audit | Critical | High | Moderate | Low |
| --- | ---: | ---: | ---: | ---: |
| frontend full graph (runtime + build) | 0 | 0 | 22 | 1 |
| frontend production subset | 0 | 0 | 15 | 1 |
| admin-web full graph | 0 | 0 | 0 | 0 |
| admin-web production subset | 0 | 0 | 0 | 0 |

These are **affected dependency entries**, not unique exploit paths. Moderate/low findings remain to be triaged on the exact release SHA; do not call the entire dependency graph clean. This result explicitly resolves the old node-forge high advisory **at the currently installed version**; it does not assert that all cryptographic or signing behavior has been independently verified. The prior withdrawn braces report is not an active vulnerability.

A new `Dependency Security Audit` workflow runs npm audits of **all installed and production subsets** for both packages, an exact lockfile version/integrity check, and a separate unsuppressed RustSec full Cargo.lock audit. Missing audit data or any new high/critical npm finding fails the security job. The AWS production release workflow is being changed to require this workflow to succeed on the **same approved main push SHA**, before AWS credentials are assumed.

Rust's optional `rsa 0.9.10` in Cargo.lock remains subject to actual RustSec findings and documented reachability: a full-lockfile finding cannot be silently ignored simply because the PostgreSQL backend does not enable MySQL. Do not confuse a completed npm scan with independent acceptance of the Rust dependencies, live IAM security, production migrations/TLS or Play release.
