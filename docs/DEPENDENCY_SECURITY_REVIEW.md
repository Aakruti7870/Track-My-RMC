# Dependency security review — 21 October 2026

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
