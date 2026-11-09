# TrackMyRMC — project quality audit and remediation

**Assessment:** 9 November 2026  
**Repository:** Aakruti7870/Track-My-RMC  
**Baseline:** `1c2f9a53be51895687aadcb921e1c5c3d268e90b` (merged PR #174)  
**Remediation branch:** `audit/project-quality-20261109`

**Decision:** Corrective source and editorial changes are prepared for review. Production readiness is not certified: candidate-specific CI, independent review, residual dependency assessment and applicable device/provider/operational acceptance remain necessary. This audit performed no production deployment, database migration, payment, worker activation or external message.

## Scope and evidence

The baseline contains 812 tracked files: 118 backend source files, 23 backend test/fixture files, 56 automatic migration files, 109 Expo app files, 102 shared Expo source files, 11 admin-web files, 66 documentation files and 44 ops files; these groups exclude other tracked config/assets/vendor files. The inventory is complete; manual source review is targeted. It is not a line-by-line proof of every file.

Inspected the project structure, local setup, CI/release controls, configuration, error responses, upload contract, API/session clients, map loader, privileged login/sign-out/collection flows, permission guards and overlapping release/dependency documents. Exercised the real client code with isolated fetch/DOM boundaries, built the frontends and ran local browser regressions with synthetic API responses. No live credentials or customer records were used.

The environment provides Node 24.22.1, npm 11.9.0 and system Chromium. Rust/Cargo and local PostgreSQL are not installed; fresh local backend compilation/integration is therefore not claimed. Backend source and migrations are unchanged. Baseline GitHub evidence is separate from candidate verification:

| Baseline workflow | Observed result | Link |
| --- | --- | --- |
| Backend CI | SUCCESS, main push on baseline SHA | [42662483976](https://github.com/Aakruti7870/Track-My-RMC/actions/runs/42662483976) |
| Frontend CI | SUCCESS, main push on baseline SHA | [42662483981](https://github.com/Aakruti7870/Track-My-RMC/actions/runs/42662483981) |
| Dependency Security Audit | SUCCESS under configured policy, main push on baseline SHA | [42662483988](https://github.com/Aakruti7870/Track-My-RMC/actions/runs/42662483988) |
| AWS production release | SUCCESS, manually dispatched; S3/SSM deployment and trusted-origin/edge verification steps succeeded | [42662931432](https://github.com/Aakruti7870/Track-My-RMC/actions/runs/42662931432) |

Other deployment invocations for this SHA were skipped or cancelled; they do not negate the successful authorized run. Conversely, the workflow record is not an independent current runtime inspection or proof that this later audit branch is deployed.

## 1. Error log

Bold text identifies the exact source text or claim requiring correction. Severity describes the demonstrated failure or risk, rather than an assumed production exploit.

| ID / priority | Location and exact text | Correction and rationale |
| --- | --- | --- |
| E01 / Medium | `frontend/src/api/client.ts`: **`const base = RAW_BACKEND.replace(/\/+$/, "");`** and **`!(process.env.NODE_ENV !== "production" && localHost)`** | Validate credentials/query/fragment before fetch; construct the base from parsed origin/path. Permit only HTTPS, or explicitly local HTTP in development. Previously, a query/fragment could absorb the appended API route and the development exception also admitted a non-HTTP protocol such as FTP on localhost. Tests demonstrate rejection before fetch. |
| E02 / Medium | Same file: **`if (typeof body === "string" && body.trim()) return body;`** | Replace non-JSON error bodies with controlled status feedback. A 403/429 proxy HTML page could previously appear verbatim in the interface. This is a demonstrated diagnostic/UX disclosure path, not a demonstrated script-execution vulnerability. |
| E03 / Low | Same file: **`Server down`** | **“The service is temporarily unavailable. Please try again.”** A 5xx response does not establish that the whole server is down. Update the two browser assertions to verify the new user-facing wording. |
| E04 / Medium | Same file, certificate helper: **``const response = await fetch(`${apiBase()}/upload`, {``** | Route multipart upload through the existing shared request function. This restores the 30-second timeout, cookie policy, normalized network errors and protected-session-loss event. Let FormData set its boundary; preserve `purpose=plant_cert`. |
| E05 / Medium | `frontend/src/maps/googleMapsLoader.ts`: **`return pending;`** after an unrecoverable cached rejected promise | Reset `pending` on transient failure, retain one shared concurrent attempt and ignore duplicate events from a settled attempt. Authentication failure remains denied. Tests simulate network errors, timeout, retry and stale callbacks. |
| E06 / Low | `frontend/src/components/PlantMap.web.tsx`: **`window.location.reload()`**, **`Reload map`**, **`Check the browser console for the Google error code.`** | Retry only the map component with **“Try map again”**. Use actionable list-fallback copy and preserve the page state. The customer should not have to debug developer configuration or lose filters/drafts to retry an optional map. |
| E07 / Medium | `admin-web/src/api.ts`: **`window.sessionStorage.removeItem('trackmyrmc_admin_token')`** without an exception boundary | Guard legacy-token cleanup. A browser storage policy can throw during module initialization and prevent the sign-in page from rendering. Current bearer tokens remain memory-only. The browser test runs with sessionStorage deliberately blocked. |
| E08 / Medium | `admin-web/src/main.tsx`: partial logout cleanup beginning **`setUser(null);setPrivilegedPassword('');setPermissions([]);setRecords([]);setWorkspace('');`** | After attempting server revocation, clear the token and remount the complete account workspace. The previous cleanup omitted loaded Owner requests, Owner ID/reason/MFA fields, profile queues, Authority records and password-rotation values. Browser evidence verifies account switching after both successful and failed revocation attempts. This is residual browser-state exposure; no server permission bypass is claimed. |
| E09 / Medium | Same file: **`No records on this page.`** / **`No records in this workspace.`** displayed after collection request failure | Introduce separate collection loading/error state; clear old records immediately when changing collections; set the requested offset before fetch; offer **“Retry loading records”** on failure. Empty-state text appears only after a successful empty response. The old title/records mismatch could also expose inappropriate contextual actions while the new collection loaded. |
| E10 / Low | Same file: **`Fresh Super Admin authenticator code`** | **“Fresh Central Admin authenticator code”**, matching the actual account name and avoiding a nonexistent additional privileged role. |
| E11 / Medium | `docs/CASHFREE_SANDBOX_INTEGRATION_REVIEW.md`: **`A merge automatically deploys code to production`** | Explain successful exact-main-SHA CI/security plus independent matching release approval. Merging alone is not deployment authorization. Preserve the separate sandbox schema/provider/financial-effect gates. |
| E12 / Low | Same file: literal **`\n- The sandbox checkout`** | Replace the literal escape with a real paragraph/list newline, restoring two separate readable requirements. |
| E13 / Low | `README.md` / `frontend/README.md`: unqualified **`Node.js 20+`** | Specify Node 20.19.4+ in the 20.x line or a supported newer line at 22.12+. Locked React Native/Metro require at least 20.19.4; Vite also imposes supported major/minor constraints. Node 20.0 is not sufficient merely because CI selects Node 20. |
| E14 / Medium | `docs/PRODUCTION_RELEASE_CHECKLIST.md`: **`node-forge remains an active high-severity advisory`** and old-only **`277d7ed`** evidence | State that the current lock already resolves node-forge 1.4.3; retain the withdrawn-braces context and residual dependency gate. Replace the living checklist's obsolete-only baseline with current, linked 9 November evidence. Preserve older dated reports as historical evidence. A current successful AWS run must not be described solely by an older skipped run. |

Additional admin error correction: the old response interceptor passed arbitrary truthy response data through. It now emits a controlled message plus status/error code, including Blob/network failure cases. Expected structured JSON validation messages remain available; raw proxy/5xx diagnostics are hidden.

## 2. Gap analysis

| Gap | Missing or weak element | Added material / disposition |
| --- | --- | --- |
| G01 | A new account could inherit unreset browser work even though the token changed | Implemented complete sign-out workspace reset and a 390px/1440px browser regression covering blocked storage and confirmed/unconfirmed revocation. |
| G02 | Collection UX did not distinguish failed, empty and loading states | Implemented explicit states, same-page retry, clearing stale records and private drafts; browser test holds a real request in flight and verifies recovery from 403 HTML to a successful empty response. |
| G03 | Multipart uploads had weaker reliability/session behavior than JSON requests | Shared the request path; added behavioral tests for auth/cookies/boundary, revoked sessions and deterministic timeout cleanup. |
| G04 | Map failures had no state-preserving recovery contract | Added loader retry and component-local retry; removed customer-facing debugging instructions. Loader tests exercise transient failure and stale event cleanup. Actual Google entitlement/API success remains external acceptance. |
| G05 | Narrow client regressions were missing from normal CI | Existing API/map jobs now run the added cases; Frontend CI's admin job also runs the new browser suite. Local system-browser acceptance supplements, rather than replaces, the CI-selected browser. |
| G06 | Numerous dated reports competed with the living release status | Linked a single cohesive product brief and this audit from the root; refreshed the living checklist and dependency entry point. Historical reports retain dates; conclusions must be read against their SHA. |
| G07 | Dependency reporting confused old advisories with the current graph | Added machine-readable hashes, tool versions, counts and root-advisory URLs. Full Expo graph: 41 moderate + 1 low affected entries; production subset: 34 moderate + 1 low. Root findings: deepmerge prototype poisoning, glob cancellation bypass and minimatch denial of service. No forced cross-major override was applied without compatibility evidence. **Open:** independently assess inputs/reachability and approve fixes or scoped dispositions; rerun exact-head RustSec CI. |
| G08 | Signed Android acceptance is easy to infer incorrectly from a web export | The brief and checklist require the artifact/version, devices/OS, reviewer, foreground/background consent, offline/reconnect and native upload evidence. **Open:** actual signed-device execution. |
| G09 | Live provider and financial acceptance cannot be supplied by source review | Added concrete evidence and test requirements below. **Open:** authorized Cashfree/DigiLocker controlled acceptance and separate enablement. No fake transaction, entitlement or verification result is supplied. |
| G10 | Restore, live migration/TLS and operator approval need evidence, not prose | Updated the release record contract. **Open:** accountable operations/security owners must attach the actual candidate/environment results. Earlier root-identity statements are not proof of the identity used today. |
| G11 | Commercial/operational objectives were not consolidated into a product brief | Added purpose, role journeys, UX/data boundaries, support expectations and the acceptance record. **Open:** product/operations approval of availability, retention, supported-device and recovery objectives. No invented customer commitment is introduced. |

The remaining evidence-dependent gaps cannot honestly be “filled” by writing a PASS, enabling live systems or upgrading framework majors without acceptance. The source fixes and complete usable acceptance text are supplied; operational outcomes remain explicitly unverified.

## 3. Fill the gaps — delivered content and code

### Account isolation and collection state

The implementation is in `admin-web/src/main.tsx`. The account boundary is an actual keyed component, not a note instructing a future developer to clear some fields:

```tsx
function App() {
  const [sessionKey, setSessionKey] = useState(0);
  const [signOutNotice, setSignOutNotice] = useState('');
  return <CommandCenter key={sessionKey} initialNotice={signOutNotice} onSignedOut={message => {
    setSignOutNotice(message);
    setSessionKey(value => value + 1);
  }} />;
}
```

`logout` attempts the appropriate server endpoint, clears the in-memory token in `finally`, then calls `onSignedOut` with either confirmed-revocation or local-only wording. All record panels and drafts are initialized afresh on the next mount. Password rotation uses the same boundary and keeps its specific success notice.

The collection feedback is implemented as:

```tsx
const workspaceFeedback = workspaceLoading
  ? <p role="status">Loading records…</p>
  : workspaceError
    ? <div role="alert"><p>{workspaceError}</p><button type="button" disabled={busy}
        onClick={()=>void loadWorkspace(workspace,workspaceOffset)}>Retry loading records</button></div>
    : records.length === 0 ? <p>No records on this page.</p> : null;
```

`loadWorkspace` clears the previous records/case/draft before fetch, records the requested offset and sets/reset the dedicated loading/error state. Both Central Admin and Authority use the same feedback contract.

### Protected uploads and map recovery

The certificate helper retains its actual file and purpose fields, then uses the production request path:

```ts
return request<{ path: string }>("/upload", {
  method: "POST", token, formData: body,
});
```

The request function omits JSON Content-Type for FormData, sends its body directly and retains the existing timeout/cookie/session-loss policy. API configuration rejects non-HTTP(S) development schemes and embedded credentials/query/fragment before sending any request.

The map loader resets its rejected shared promise on a transient failure; a settled attempt cannot clear a later attempt's callback/timer. The map component increments a local attempt state rather than reloading the document. Google authentication failure remains fail-closed, and plant-list fallback stays available.

### Dependency disposition text — ready for the release record

> The selected frontend lockfile currently reports no high or critical npm advisories, but moderate/low findings remain in the Expo build/runtime dependency graph. The full graph has 42 affected entries and the production subset has 35; these are not unique vulnerabilities. The admin full graph reports zero. Review the reachable deepmerge, glob and minimatch advisory paths against trusted repository inputs, filesystem traversal/cancellation and attacker-controlled glob patterns. Package placement under production dependencies does not prove the static deployed web application executes a package, and build-time placement does not prove no exposure. A disposition must name the advisory, exact version/path, reachable inputs, proposed fix or compensating controls, compatibility tests, reviewer and re-evaluation trigger. No vulnerability suppression or independent residual-risk acceptance is granted by this audit.

The exact report metadata and lockfile SHA-256 values are in [2026-11-09-dependency-evidence.json](2026-11-09-dependency-evidence.json). Earlier high counts are preserved as history, not recycled as current findings.

### Device/provider acceptance text — ready for the test plan

> Run the signed candidate with synthetic approved identities. Record artifact digest, version code, OS/device and role. For each mobile role, test first sign-in, “Allow”, “Not now”, OS denial, later settings changes, sign-out and account switching. Verify no background location request occurs at login. For drivers, separately test the active-trip disclosure, foreground/background transitions, app restart, denied/revoked permission, offline/reconnect, delayed GPS and POD upload interruption. Verify a cancelled/failed upload does not claim published evidence. Test the optional map failure/retry while preserving the selected location and enquiry draft.
>
> For DigiLocker, record the intended Test/Live entitlement and selected host. Verify consent, success, cancellation, expired/invalid callbacks, polling and replay handling with controlled identities. A browser redirect must not mark identity verified without server evidence. For Cashfree sandbox, test success, failure, expiration, duplicate and reordered callbacks, invalid signatures/timestamps, mismatched amount/currency/order, retry/idempotency and concurrent reconciliation. Confirm a sandbox receipt cannot activate live funds, subscriptions or refunds. Any later live activation requires the provider's approval and the existing separate financial/release contract.
>
> Save a result for each case: PASS, FAIL, NOT VERIFIED or NOT APPLICABLE, with actual evidence and an accountable reviewer. Stop financial/provider acceptance on an unexplained accounting, consent or authorization discrepancy; preserve sanitized evidence before retrying mutations.

### Operational acceptance text — ready for the release record

> Identify the candidate full SHA and immutable artifact digest. Confirm reviewed schema changes and a read-only live migration/checksum comparison. Retain positive and negative RDS CA/hostname tests against the intended environment. Prove the approved operator's scoped identity; do not substitute an older identity snapshot. Record a witnessed restore and compatible application rollback with measured recovery time/data loss. Obtain the matching release approval and verify the candidate's required main-push CI/security results. After an authorized release, retain S3/SSM references, the running SHA, API/admin/Expo routing smoke and origin/edge results. A health response alone does not establish provider activation or restore capability.

### Reproduction commands

Run from the indicated repository directory. Use isolated databases/fixtures; the commands below do not authorize live-provider or production actions.

```bash
# Repository root: offline operations regressions
python3 -m unittest discover -s ops/tests -p 'test_*.py'

# frontend/: locked install, static and behavioral checks
npm ci
npm run typecheck
npm run test:api-base
npm run test:maps
npm run check:auth-routing
npm run check:modules
npm run check:play-policy
npm run check:android-permissions
npm run check:android-layout
npm run check:kyc-availability
npm run check:single-font
npm run check:vector-symbols
EXPO_PUBLIC_BACKEND_URL=https://trackmyrmc.com npm run build:preview

# admin-web/: independent privileged build and synthetic browser checks
npm ci
npm run build
npx playwright install chromium
npm run test:browser

# backend/: supported Rust toolchain + isolated PostgreSQL, or required CI
cargo fmt --all -- --check
cargo check --all-targets
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all
```

The normal Frontend CI additionally serves the exported Expo app and runs its customer/home/header/owner/staff browser suites. The new admin suite starts its own localhost-only Vite preview and intercepts all API requests with synthetic responses. It never signs into a deployed service.

### Candidate verification ledger

- Offline operations suite: **102 PASS**.
- Frontend standalone Node regression suite: **66 PASS**, including new API/map cases.
- Expo TypeScript typecheck: **PASS**.
- Role routing, module discovery, Play policy, Android permissions/layout, KYC availability, font and vector-symbol guards: **PASS**. Pattern/layout guards are not a proof of native screen usability.
- Expo production web export: **PASS**; the final browser journeys use the rebuilt error wording.
- Admin TypeScript/Vite production build: **PASS**.
- New admin browser suite: **PASS at 390px and 1440px**, covering blocked storage, loading, failure, retry, successful empty results and account reset after both confirmed and unconfirmed revocation.
- Existing Expo browser suites: **PASS**. Customer tracking: six widths (320/390/768/960/1024/1440px); customer header: eight light/dark viewport cases; Owner: five theme/width journeys plus three automation-grid cases; staff: eight roles at 320/390/768px (24 viewport cases). These use the actual exported UI with synthetic API responses, not live backend/provider acceptance.
- Local npm audit: **0 high/critical** in all scanned graphs, with the residual counts above. Nonzero npm exit status for moderate/low entries is retained as advisory evidence, not called a clean scan.
- Local Rust/PostgreSQL, signed native device, live provider and current live infrastructure acceptance: **NOT RUN**. Required baseline workflows passed; later head-specific CI must be inspected independently.

Environment-only failures were corrected without repository workarounds: npm uses a writable workspace cache; Expo disables telemetry and stores CLI state in the workspace. Initially running browser scripts without their required server/browser setup did not establish an application defect; the configured browser runs supply that setup.

## 4. Premium rewrite — final project narrative

TrackMyRMC is a ready-mix concrete coordination platform for customers, approved plant teams and drivers. It brings supplier enquiries, orders, plant operations and delivery evidence into one role-scoped workflow, supported by a Rust/PostgreSQL API, an Expo/React Native application and a separate privileged web dashboard.

Customers discover plants, submit enquiries, review offered terms and follow their orders. Plant Owners and authorized staff manage work within approved plant/module entitlements. Drivers use assigned-trip workflows and purpose-specific delivery/location controls. Central Admin and Authority operate through dedicated web identities with distinct permissions, MFA and audit requirements.

The experience preserves user context through recoverable failures. Collections distinguish loading, empty results and failed requests; retries do not masquerade as successful empty searches. Certificate uploads share the protected request policy. Optional map failures preserve plant-list access and can be retried without reloading the page. Sign-out ends the complete account workspace so the next account starts without another operator's drafts, records or privileged form values.

Security and release decisions remain evidence-based. Server authorization governs plant, role and action scope; navigation visibility alone does not grant access. Mobile preferences, OS permissions and customer-discovery consent are separate. Background tracking retains its active-trip disclosure. Payment, KYC and automation activation require their own controlled acceptance.

The approved production runtime is AWS, with immutable source/artifact identity and independently gated release. A successful baseline deployment is recorded, while new code still requires its own review and exact-commit checks. Web builds do not substitute for signed Android, provider, restore or live operational evidence. Remaining dependency findings and acceptance gaps are documented with their actual scope rather than hidden behind a production-ready label.

The complete cohesive rewrite is delivered in [the product and delivery brief](../PROJECT_BRIEF.md), with current setup/navigation in [the root README](../../README.md) and the evidence-driven [production checklist](../PRODUCTION_RELEASE_CHECKLIST.md). These documents integrate the corrections and usable acceptance text above while keeping historical reports traceable.
