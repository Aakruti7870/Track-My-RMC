# Production release checklist

Overall: BLOCKED. Full feature parity: PARTIAL. No production release SHA is accepted. No production approval is requested while independent modules and acceptance gates remain incomplete.

| Gate | Status | Evidence / remaining requirement |
|---|---|---|
|Integration history/current main|COMPLETE|PR36/37/38/39 retained; main6253bbb4 ancestor; controlled draft PR40|
|SQLx migration numbering|COMPLETE|Unique chronological0019/0020/0021;29 files through 0032|
|Migration acceptance|PARTIAL|PG16/18 chain/checksum/legacy-upgrade tests pass3d913265; production history/restore unverified|
|Nonprivileged auth/browser core|PARTIAL|Ten approved synthetic roles pass actual Expo login/routing/dashboard/records/logout and server revocation; live delivery/device journeys unavailable|
|Central Admin separation|PARTIAL|Explicit approved web provenance/grants/step-up/revocation and browser pass; enrollment/recovery and remaining privileged UI unavailable|
|Authority|NOT IMPLEMENTED|Dedicated auth/workspaces and approved identity unavailable; no admin alias/elevation|
|Customer commercial/site/planning/observation/support core|PARTIAL|Real RFQ/quote/order/site/pour/project/receiving/cube/support tests and customer project/support browser pass; full role/device/provider acceptance pending|
|Owner/operational dashboards|PARTIAL|Actual customer/owner/staff contracts and weekly measured quantities pass; complete module mutations/device workflows pending|
|Production/delivery/billing core|PARTIAL|Transactional stock, produced pool, dispatch, GPS/POD and invoice/payment tests pass; complete customer-origin device journey pending|
|Payroll/workforce|PARTIAL|Recorded amounts/approval/payment/snapshots/reopen/version2 pass; salary from attendance and complete workforce acceptance pending|
|Automation|PARTIAL|Missing secrets/stale leases/fake delivery denied; real adapter unavailable|
|All source modules|PARTIAL|297 source entries classified;309 target pairs,201 matches/96 unmatched; path matches are not functional acceptance|
|Strict backend/Admin/Expo browser|COMPLETE|3d913265 run 38791343034, PostgreSQL16/18; all 10 approved mobile identities and dedicated Admin fixture|
|Frontend/Admin checks/export|COMPLETE|3d913265 run 38791343323|
|Signed Android/device|PARTIAL|3d913265 run 38791343104 building; real-device acceptance BLOCKED|
|Dependency security|BLOCKED|Compatible remediation yields0 critical but22 high entries from braces,node-forge,image-size; no suppression/downgrade approved|
|Staging validation/security review|PARTIAL|cfn-lint/AWS validation/static/IAM checks pass;13 Guard failures individually documented and await explicit decision|
|Cost controls/cleanup|PARTIAL|Verified free USD 100 monthly account budget with80% actual alert; cleanup procedure prepared, no rehearsal|
|AWS staging provisioning|BLOCKED|User holds all billable resources pending review and renewed explicit approval|
|Live OTP/KYC/payments|BLOCKED|No authorized real destinations/configured adapters|
|Persistent privileged identities|BLOCKED|Dedicated grants/MFA/recovery not approved/verified|
|Historical migration/restore/rollback|BLOCKED|Authorized backup and isolated restoration unavailable; seeds excluded|
|Release manifest/final approval|BLOCKED|Exact accepted artifact, complete modules/security/device/restore gates required|
|Production deployment/post-release verification|BLOCKED|No production-changing deployment performed|

Keep the manual production confirmation gate. Free budget configuration does not authorize EC2/RDS/S3/secret provisioning. The staging review covers an approximately USD 42.41/month baseline before usage/tax and all 13 outstanding managed-rule findings; it must receive separate explicit approval. Production release needs another final approval after every required gate passes.
