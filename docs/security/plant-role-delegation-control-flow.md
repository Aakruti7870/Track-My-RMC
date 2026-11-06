# Controlled plant login and management

Status: PR #141, review and release gates required. No automatic merge/deployment.

## Audit baseline

PRs #97, #98, #140 and #145 are merged. Main 85920c6 includes Smart RFQ and the
current customer layout. At refreshed PR head 0be76a7, the seven-role slot index,
OTP/MFA, rotating refresh, staff module registry, soft removal and partial Manager
UI already existed. Email onboarding still required a UUID, Manager limits and
revocation were incomplete, missing grants fell back to role ceilings, and Owner
approval used ordinary mobile Admin. Those were implementation/security gaps.
Production tables and assignments were not inspected in this environment: no
production identity is configured. Synthetic PostgreSQL and CI are the evidence
sources; historical production counters are not fresh preflight results.

## Authority and identity

The dedicated approved Central Admin Control Center MFA session plus explicit
`plant_owners.manage` permission controls Owner approval and access status.
Privileged mutations require recent step-up. Other Admin/Authority roles remain
distinct; no alias or mobile authentication bypass was added. Additional plant
ownership goes through reviewed onboarding. Owners only manage owned active
plants. Owner disablement revokes Owner and dependent Manager credentials.

Customer and Driver use WhatsApp OTP. Approved work-email identities use email OTP
and required authenticator enrollment/MFA/recovery. The existing isolated reviewer
flow retains its restrictions. Password-only staff login remains disabled.

## Seven roles and lifecycle

The operational roles are dispatcher, operator, supervisor, accountant,
quality_engineer, fleet_manager and store_manager. Manager is a delegation on an
existing active staff identity, not an eighth job role or global login role.
Migration 42's partial unique index reserves one assignment per plant/role;
separate plants have independent slots. The plant/user primary key prevents
conflicting slots for one identity in one plant. Identity row locks serialize
cross-plant registration attempts; database uniqueness handles simultaneous slot
requests. Identity creation and assignment reservation roll back together.

| State | Login | Reserved slot |
|---|---|---|
| PENDING, unexpired | Email/MFA claiming only; no active session yet | Yes |
| ACTIVE | Required OTP/MFA | Yes |
| SUSPENDED | Denied; credentials/delegations revoked | Yes |
| TERMINATED / REMOVED | Denied | No |
| EXPIRED / CANCELLED | Denied | No, after explicit audited transition |

Owners/authorized Managers register a work email and role as PENDING. No email
ownership is assumed from the invitation. Email OTP records ownership; final MFA
completion atomically activates employment and issues a controlled session.
Expired invitations cannot claim and require explicit expiry/cancellation to
release their reservation. Lifecycle changes record actor, role, plant, employee,
assignment generation, previous/new status, timestamp and reason. Normal removal
never deletes users or payroll/order history. Rehire uses a new generation and
clears old grants, refresh credentials and Manager delegation. History is
append-only at PostgreSQL and visible read-only in the existing Staff screen.

## Delegation and permissions

An Owner may appoint one active Manager per plant and independently authorize
staff management, permission delegation, fleet management and Driver management.
Managers cannot appoint another Manager, change ownership, manage themselves or
another Manager, modify privileged identities, or act outside their plant.
Permission delegation is bounded by the Owner's explicit per-module limits and
the target employee's role ceiling. Revoking delegation invalidates access and
refresh credentials. Rehire/reactivation never restores revoked delegation.

The existing 20-module registry owns View, Create, Edit, Approve and Export.
Missing grants deny. Legacy effective defaults are materialized once during
upgrade, preserving explicit denials; new assignments start with no grants.
Create/Export are separate controls; legacy three-flag clients retain compatible
Create=Edit behavior and default-denied Export. Role ceilings still prohibit
sensitive employee approvals. Export is limited to an explicitly granted,
non-financial plant summary. Shared HR/roster and KPI reads honor their effective
scope; Supervisor salary data remains redacted. Personal payslip, notifications
and self-service records retain their existing identity/row scope.

Manual stock reductions require the Owner; production inventory consumption keeps
its existing atomic ledger. Operators cannot independently edit protected mix
designs. Dispatcher payroll denial and other existing role ceilings remain.

## Fleet and Drivers

Owners manage their own fleet/Drivers. Managers need distinct fleet and Driver
capabilities; Fleet Managers need the corresponding explicit module grants.
Registering a Driver creates a pending phone identity without sending a live
message. WhatsApp OTP verifies identity before vehicle assignment. TM/Driver
assignment must match the plant and is audited. Suspension/revocation deletes
refresh credentials and blocks old JWTs. Existing employment history, experience,
GPS, trips, POD and consent controls remain in place.

## Session controls

Only completed authentication replaces the current session. Refresh credentials
rotate once; replay, stale logout, inactive employment and revoked delegation
cannot resurrect a newer session. Existing Central Admin web provenance, MFA,
step-up and revocation protections remain. Browser tabs serialize shared-cookie
refresh, adopt renewed access and propagate logout. Terminal protected-API 401
responses notify AuthProvider, which revalidates, clears sensitive credentials and
tracking, and presents the session-replaced message. Permission-denied 403 alone
does not globally sign out a valid identity. No protected WebSocket endpoint was
found in the current Rust router; no realtime exception was introduced.

## API additions and compatibility

- `POST /api/business/plants/:plant/staff/invitations`
- `POST /api/business/plants/:plant/staff/:user/lifecycle`
- `GET /api/business/plants/:plant/staff/history` (seven slots and audit history)
- Existing Manager grant/revoke and module-permission routes, with bounded policy
- `POST /api/business/plants/:plant/drivers/invitations`
- `POST /api/business/plants/:plant/drivers/:user/status`
- `POST /api/control-center/owners/:user/status`
- `GET /api/master/plants/:plant/summary/export`

Existing staff UUID and lifecycle routes remain with compatibility handling.
Unverified UUID identities must use invitation claiming. Existing frontend theme,
role routes and SVG assets are retained. No Python/FastAPI/MongoDB runtime,
replacement RBAC system, live payment/KYC credential change or paid resource was
introduced. See `docs/release/controlled-plant-access-rollout.md` for preflight,
backup/restore requirements, migration recovery and remaining external gates.
