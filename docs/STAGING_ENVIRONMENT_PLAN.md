# TrackMyRMC isolated staging review

Status: PARTIAL. AWS provisioning: BLOCKED. No stack, change set, EC2, RDS, secret, bucket or production resource was created or changed. The separately authorized monitoring-only AWS budget was created and verified.

## Verified inventory

Read-only inventory in AWS account 260234292958, ap-south-1 found only the existing production EC2, production PostgreSQL 18.3 RDS, two production secrets and the production artifact bucket. No staging compute, database or stack was identified. No approved staging account records were queried because no staging database exists.

AWS Backup vault inventory and DocumentDB cluster/snapshot inventories were empty. Seven PostgreSQL production snapshots were present. The approved artifact bucket contained 106 application artifacts/source archives, not an identified MongoDB dump. This does not establish whether an external Atlas production database exists. Historical migration remains BLOCKED until an authorized backup is identified. No development seeds will be imported as real records.

## Proposed foundation

Template: ops/staging/foundation.json. The stack would create a new 10.88.0.0/16 VPC, independent subnets and security groups, an SSM-only Amazon Linux 2023 t3.small host, a private PostgreSQL 18.3 db.t4g.micro instance with 20 GiB gp3 storage, a private versioned artifact bucket and staging-only secrets. EC2 has 30 GiB encrypted gp3 storage and standard CPU credits. It has no inbound security-group rules, requires IMDSv2, and can use outbound HTTPS for SSM and packages. PostgreSQL accepts port 5432 only from the new application security group. There is no peering, production security-group reference or production secret permission.

RDS manages its administrator password. The host cannot read that administrator secret. A separate generated application database credential is prepared; its PostgreSQL role and restricted grants must be established through a separately reviewed bootstrap before application deployment. JWT and OTP pepper are separate generated staging secrets. Secret values are never outputs. Databases, buckets and secrets have Retain policies; RDS also has deletion protection and seven-day backups. Retention means storage/secrets can continue costing money after compute is stopped or a stack is removed.

The foundation intentionally does not install the application, load identities, enroll MFA, deliver OTPs, open a public API, configure staging DNS/TLS, or reference the production deployment script. Those are additional reviewed steps.

## Validation findings

- COMPLETE: cfn-lint 1.57.2, Mumbai schemas: 0 errors, 0 warnings, 0 informational findings after correction of EC2 CreditSpecification.CPUCredits.
- COMPLETE: AWS CloudFormation ValidateTemplate accepted the final template and reported CAPABILITY_IAM. This is template validation, not a successful deployment or account-level change-set validation.
- PARTIAL: cfn-guard 3.2.1, official registry commit 7f7340c26ae5d5e8874651dbffeb12e0e9f505b6, all EC2/RDS/S3/IAM rule directories: 71 rule-file evaluations; 42 PASS, 13 FAIL, 16 SKIP. The 13 failing files report 15 named failures, including helper branches. No rule suppressions were added.
- COMPLETE: repaired EBS optimization, missing database ingress description, Boolean TLS denial, and converted the scoped runtime permissions to a managed IAM policy.
- BLOCKED: account-level change set and provisioning are not authorized. No change set was created.

| Remaining finding | Assessment and required decision | Status |
|---|---|---|
| EC2 detailed monitoring; RDS enhanced monitoring and log exports | Not enabled in the baseline. Decide retention and monitoring coverage, then price the additional metrics/logs before provisioning. | PARTIAL |
| World-address egress, default Internet Gateway route, app subnet public address | Intentional low-cost SSM egress; no inbound app ports. A private host with endpoints/NAT is an alternative requiring a revised cost review. No exception is treated as approved. | PARTIAL |
| Single-AZ RDS | Staging baseline trades availability for cost. Multi-AZ requires revised pricing and review. | PARTIAL |
| RDS master username secure-source rules | A non-secret system username is literal; administrator password is AWS-managed. The username rule remains a policy finding for review. | PARTIAL |
| RDS password secure-parameter helper | The main no-plaintext-password and secure-service rules PASS; the alternative parameter helper FAILS because AWS-managed password is used. Retained as a checker compatibility finding. | PARTIAL |
| S3 public ReadWrite ACL rule | No ACL is declared; BucketOwnerEnforced disables ACLs and all four public-access blocks are true. The registry comparison treats the absent ACL as a failure. No public ACL was introduced to silence it. | PARTIAL |
| S3 access logging, Object Lock, replication | Not configured for disposable staging artifacts. Decide retention, logging and replication requirements and price any additional resources before deployment. | PARTIAL |

Raw initial/final Guard streams, summary, AWS template-validation result and exact price-list products are retained under ops/staging/evidence.

## Proposed baseline cost

AWS public on-demand prices retrieved on 15 October 2026 for Mumbai. Python Decimal calculated 730-hour monthly estimates; no Free Tier, credit or negotiated discount is assumed.

| Component | Rate / assumption | Monthly USD |
|---|---|---:|
| EC2 Linux t3.small | 0.0224/hour x 730 | 16.3520 |
| RDS PostgreSQL db.t4g.micro, Single-AZ | 0.021/hour x 730 | 15.3300 |
| EC2 gp3, 30 GiB | 0.0912/GiB-month | 2.7360 |
| RDS gp3, 20 GiB | 0.131/GiB-month | 2.6200 |
| One in-use public IPv4 | 0.005/hour x 730 | 3.6500 |
| Four Secrets Manager secrets, including RDS-managed administrator | 0.40/secret-month | 1.6000 |
| S3 Standard, assumed 5 GiB | 0.025/GiB-month | 0.1250 |
| **Estimated baseline** | **Before variable usage and tax** | **42.4130** |

Budget approximately USD 42.41/month for this baseline, not a spending cap or a quote. Excludes tax, data transfer, API requests, additional artifact versions/storage, excess backups, RDS surplus CPU credits, monitoring/logging additions, DNS/TLS hosting choices and any provider charges. Stopping compute does not stop all charges. Re-price any revised design before approval. Sources: [EC2](https://aws.amazon.com/ec2/pricing/on-demand/), [RDS PostgreSQL](https://aws.amazon.com/rds/postgresql/pricing/), [VPC IPv4](https://aws.amazon.com/vpc/pricing/); exact regional SKUs and terms are in evidence/pricing.json.

## Identity and provider restrictions

Approved synthetic identities are listed in backend/tests/fixtures/staging_identities.json. They are mock-delivery and database-test inputs only. The example.invalid addresses and reserved synthetic phone numbers must never receive real email or WhatsApp requests. No live provider destination is authorized, so live OTP delivery is BLOCKED. The package under test is com.trackmyrmc.concreteking. No Authority or Central Admin staging identity is approved or automatically created. Code-designated privileged email addresses are not account approval.

## Pre-approval review completed after the provisioning hold

The revised template enforces account 260234292958, ap-south-1 and stack name trackmyrmc-staging, permits only t3.small, removes public TCP80 egress and adds explicit denial of non-staging secret/SSM parameter reads and infrastructure mutation/role assumption. Static isolation validation and IAM simulation pass for the tested boundaries; actual deployed enforcement remains untested. No production resource references or cross-VPC links are present. Internet egress still permits access to public URLs and is explicitly documented.

All13 failing rule-file evaluations, including15 named branches, are individually documented in SECURITY_REVIEW.md with the actual properties, risks, mitigations and required decisions. None is silently suppressed or treated as an approved exception. Final cfn-lint is clean, AWS ValidateTemplate accepts the revision, and Guard remains42 PASS/13 FAIL/16 SKIP.

A USD 100 MONTHLY COST budget named trackmyrmc-account-monthly-cost-guardrail is configured in account 260234292958, with an80% ACTUAL GREATER_THAN email notification to the user-approved recipient. DescribeBudget reports HEALTHY; the notification and subscriber were read back. This account-wide guard includes existing production costs. It is not a staging-only cost allocation, hard spending cap or automatic shutdown, and email receipt has not been independently tested. Monitoring and notifications are free; no paid Budget Reports or automatic Budget Actions were enabled. Recipient details are redacted from repository evidence.

SHUTDOWN_AND_CLEANUP.md documents exact-stack inventory checks, temporary stopping, RDS seven-day auto-restart, retained-resource costs, versioned-object cleanup and separate destructive-cleanup authorization. It has not been executed or rehearsed because staging does not exist.

Python Decimal reconfirmed USD 42.413/month running and approximately USD 7.081/month persistent costs while temporarily stopped, before variable usage/tax. IAM restrictions and budget monitoring add no modeled recurring charge. See evidence/cost-recheck.json.

## Remaining blockers before provisioning and live validation

1. Review the exact revised foundation, all 13 documented exceptions and cleanup procedure; explicitly authorize this foundation before creating any billable resource.
2. Establish application build artifacts, safe runtime secret resolution, a non-administrator database role, migrations and staging health checks.
3. Decide staging access/DNS/TLS and a real-device connection method; the foundation has no public application listener.
4. Use only isolated synthetic operational fixtures. Live provider identities and dedicated privileged identities need separate explicit authorization.
5. Obtain an authorized MongoDB backup if real historical data exists; do not restore production records into the synthetic staging test environment.
6. Complete remaining module contracts and real-device journeys before any production release approval.

Supporting review files: SECURITY_REVIEW.md, SHUTDOWN_AND_CLEANUP.md, evidence/budget.json, evidence/iam-isolation-simulation.json and evidence/cost-recheck.json under ops/staging. The only AWS configuration changed during this follow-up is the explicitly authorized free cost budget; production infrastructure and secrets remain unchanged.
