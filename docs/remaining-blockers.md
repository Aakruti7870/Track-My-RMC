# Remaining blockers and release gates

15 October 2026. This branch does not establish full functional parity or production readiness.

## Environment
- Local GitHub CLI account Aakruti7870 has an invalid token. The GitHub connector successfully reads both repositories, including the private reference. Target cloned anonymously; reference inspected as a source snapshot, not a Git checkout.
- GNU Rust check fails before application compilation: dlltool.exe is absent. Installed MSVC toolchain also fails: link.exe is absent.
- No local PostgreSQL or Docker command is installed. New SQLx tests must execute against the isolated CI PostgreSQL service.
- Initial admin Vite build fails because esbuild cannot traverse an ancestor directory in this Windows sandbox. TypeScript compilation reached Vite without reporting errors.
- Expo builds use EXPO_NO_TELEMETRY=1 and a workspace-local EXPO_HOME to avoid writing outside the workspace.

## Implementation still required
- 110 reference API paths have no literal matching Rust registration; see feature-parity-matrix.md. Aliases must be examined before claiming an absent behavior. 187 matching paths also need schema, method, permission and runtime verification.
- The complete reference frontend/admin screen and navigation audit is outstanding.
- Load prepare/dispatch/cancel and reassignment still need atomic state rules, mixer occupancy checks, quantity validation and scheduling checks. Existing endpoints are now scoped to authorized plants.
- GPS offline replay, source timestamps, event deduplication, tracking visibility and route history require end-to-end validation.
- POD evidence uses PostgreSQL bytes for new uploads; historical metadata-only records return 404 for unavailable bytes. No historical image content can be reconstructed from metadata.
- File evidence has a 2 MiB file limit, subject to the existing multipart request body limit. Large image handling and compression need device validation.
- Finance, stock, QC, workforce, payroll, notifications, integrations, support, admin and owner modules remain PARTIAL until real workflows and permissions pass.
- WhatsApp, email, TOTP enrollment, Cashfree, map and KYC provider credentials/configuration were not tested. No production credentials were read.
- New delivery reconciliation does not yet emit the full reference customer notification/automation and parent-order audit events.
- Authenticated device and browser workflow tests and Android compilation are outstanding.

## Production gates
Do not deploy this branch. Require passing Rust/SQLx integration tests, migration upgrade validation on a copy of representative data, full route/contract and role tests, external provider tests, Android and admin builds, and review of all unresolved critical gaps. Production deployment requires separate user authorization.
