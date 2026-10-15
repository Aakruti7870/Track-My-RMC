# Dependency security review

Status: PARTIAL. Production release: BLOCKED.

The frontend locked production graph initially reported26 high and1 critical entries. Compatible lockfile remediation at dae4a0d7 removes the critical shell-quote advisory and updates shell-quote to1.12.0, undici to6.29.1, compression to1.8.2, source-map-js to1.2.2 and the affected brace-expansion versions. Expo54 and React Native0.81 remain unchanged. No forced framework downgrade, audit suppression or major-version override was applied.

The subsequent package-lock-only audit reports0 critical and22 high entries. These are affected dependency entries, including transitive parents, not22 distinct root vulnerabilities. The remaining roots are:

| Package | Locked version | Finding | Remaining work |
|---|---|---|---|
|braces|3.0.3|Nested-pattern recursion denial of service; advisory currently lists no patched release|Review a compatible upstream/vendor repair with Metro/Jest matching regression evidence|
|node-forge|1.4.0|RSA signature verification accepts malformed nested algorithm elements; no patched release listed|Review a validated upstream repair/replacement for Expo certificate tooling|
|image-size|1.2.1|JXL/HEIF and ICNS parsers can loop indefinitely; patched2.0.3+ is outside the current1.x contract|Review Metro/image processing compatibility before a major-version migration|

The implicated tools run during development/build; that is not proof that the published app or a server is unreachable by malicious inputs. No exploitability exception is approved and the release gate stays blocked. Dependencies installed as production packages can still include build tooling. Use npm ci for deterministic Android/Admin builds and repeat the audit on the exact accepted release lockfile.

The repaired graph passed frontend/export/Admin builds and actual Expo browser journeys at3d913265. The latest signed Android build is still pending. Expo Doctor is now an explicit candidate CI step; prior frontend CI did not run it. This report does not claim a clean high-severity audit.

Sources: [shell-quote](https://github.com/advisories/GHSA-pqg4-j6r4-53mv), [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv), [image-size JXL/HEIF](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq), [image-size ICNS](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr). Findings were inspected on16 October2026 India time.
