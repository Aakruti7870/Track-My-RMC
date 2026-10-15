# Staging security-rule disposition

Status: PARTIAL. Provisioning: BLOCKED pending explicit approval of this exact configuration and the documented exceptions. No rule suppression or exception approval is implied.

Your template has 13 failing rule-file evaluations, containing 15 named failure branches. The final local check evaluated 71 official registry files: 42 PASS, 13 FAIL and 16 SKIP. Registry commit: 7f7340c26ae5d5e8874651dbffeb12e0e9f505b6; cfn-guard 3.2.1. The complete final stream is evidence/guard-preapproval.json-stream. cfn-lint remains clean and AWS ValidateTemplate accepted the revised template. These checks do not prove a deployed system.

| # | Failed rule(s) | Actual configuration and risk | Disposition / concrete alternative |
|---|---|---|---|
| 1 | EC2_INSTANCE_DETAILED_MONITORING_ENABLED | AppHost.Monitoring is absent, so basic monitoring is used. One-minute visibility is unavailable. | Documented staging exception, pending approval. Set Monitoring: true for one-minute EC2 metrics, then price metrics before approval. |
| 2 | EC2_SECURITY_GROUP_EGRESS_OPEN_TO_WORLD_RULE | The host allows TCP443 to 0.0.0.0/0 for SSM and HTTPS repositories, plus TCP5432 inside the new VPC. Unnecessary public TCP80 was removed. Outbound exfiltration remains possible if the host is compromised. | Documented exception, pending approval. Use private interface endpoints and an approved package/artifact path, remove world egress and re-price endpoint/NAT/inspection costs. No inbound host ports are allowed. |
| 3 | NO_UNRESTRICTED_ROUTE_TO_IGW | PublicRoute sends 0.0.0.0/0 to the new Gateway for the host subnet only. Internet access includes public production URLs like any other internet client. | Documented exception, pending approval. Remove the IGW default route after private SSM/package connectivity is designed. This is resource/data isolation, not a claim that every production public URL is unreachable. |
| 4 | SUBNET_AUTO_ASSIGN_PUBLIC_IP_DISABLED | AppSubnet.MapPublicIpOnLaunch=true; the two DB subnets have no public-address assignment or IGW association. The host's public address costs money but has no inbound SG rule. | Documented exception, pending approval. Set false only with a working private outbound design; otherwise SSM becomes unavailable. |
| 5 | RDS_ENHANCED_MONITORING_ENABLED | Database has no MonitoringInterval/MonitoringRoleArn. Database OS-level enhanced monitoring is absent. | Documented exception, pending approval. Add a least-privilege monitoring role, MonitoringInterval:60 and MonitoringRoleArn; price CloudWatch ingestion/storage and retention first. |
| 6 | RDS_INSTANCE_LOGGING_ENABLED | EnableCloudwatchLogsExports is absent. PostgreSQL logs remain service-managed; no CloudWatch export is prepared. | Documented exception, pending approval. Add supported postgresql/upgrade exports, explicit log-group retention and a revised variable-usage estimate. No claim of centralized log acceptance is made. |
| 7 | RDS_MASTER_USER_NAME_USES_SECURE_PARAMETER; RDS_MASTER_USER_NAME_USES_SECURE_SERVICE; RDS_MASTER_USER_NAME_NO_PLAINTEXT_PASSWORD | MasterUsername is the non-secret literal staging_owner. ManageMasterUserPassword=true generates/manages the password in Secrets Manager. No password is in the template. Three branches belong to this one failing rule file. | Checker/policy compatibility finding, documented for approval. A username dynamic reference could satisfy a username-source policy but requires another generated secret/configuration and cost review. Do not put the password in a parameter or template. |
| 8 | RDS_MASTER_USER_PASSWORD_USES_SECURE_PARAMETER | The secure-parameter alternative helper fails because RDS manages its password. Main no-plaintext and secure-service password checks pass. | Checker compatibility finding. Retain ManageMasterUserPassword=true; do not weaken password management to satisfy an alternative helper. |
| 9 | RDS_MULTI_AZ_SUPPORT | Database.MultiAZ=false. An AZ outage can interrupt disposable staging; this is unsuitable as proof of production availability. | Documented exception, pending approval. Multi-AZ requires a revised database/storage quote and acceptance criteria. |
| 10 | S3_BUCKET_DEFAULT_LOCK_ENABLED | The artifact bucket is versioned, encrypted and retained, but Object Lock is absent. Artifacts are not immutable against an authorized deleter. | Documented exception, pending approval. Set ObjectLockEnabled plus an explicit default retention policy only after retention/cleanup consequences and storage cost are approved. |
| 11 | S3_BUCKET_LOGGING_ENABLED | Server-access logging destination is absent. The foundation does not establish an S3 access-log audit trail. | Documented exception, pending approval. Add a private encrypted logging bucket, logging.s3.amazonaws.com delivery policy scoped by source bucket/account, LoggingConfiguration and lifecycle/retention; revise costs. |
| 12 | S3_BUCKET_NO_PUBLIC_RW_ACL | No AccessControl ACL is set. BucketOwnerEnforced disables ACLs; all four PublicAccessBlock settings are true and a Boolean aws:SecureTransport=false Deny is present. The rule compares an absent ACL property as failing. | Checker compatibility finding. Keep ACLs disabled; do not enable ACLs or add public permissions to silence the checker. |
| 13 | S3_BUCKET_REPLICATION_ENABLED | No replication destination/role is configured. A retained bucket in one region is not a regional-disaster recovery plan. | Documented exception, pending approval. Add an approved destination, least-privilege replication role, versioning and costed replication policy if required; no second-region resources are authorized now. |

The following are examples for a revised design, not applied configuration or provisioning commands:

```yaml
Monitoring: true                       # EC2 one-minute metrics; price first
MapPublicIpOnLaunch: false              # Requires private SSM/package connectivity
MonitoringInterval: 60                  # RDS OS metrics; needs a scoped monitoring role
MonitoringRoleArn: !GetAtt MonitorRole.Arn
EnableCloudwatchLogsExports:            # Add explicit retention and price log volume
  - postgresql
  - upgrade
MultiAZ: true                           # Availability change requires a new quote
LoggingConfiguration:
  DestinationBucketName: !Ref AccessLogs # New private bucket and delivery policy required
```

## Production separation

Static verification passes with ops/staging/verify-isolation.mjs. The template accepts only account 260234292958, region ap-south-1 and stack name trackmyrmc-staging. Only t3.small is allowed. All network, DB, bucket, role and application secrets are new resources; there are no ImportValue links, hardcoded existing VPC/subnet/SG IDs, peering links or production resource references. DBName is trackmyrmc_staging, storage is encrypted, the DB is private, and PostgreSQL ingress comes only from the new application SG. No production migration, restore, SSM command or secret-value read was performed.

The host requires IMDSv2, has no inbound ports and standard CPU credits. It may read only three new application secrets and the new bucket's releases prefix. Explicit Deny statements reject other secret/S3 object reads, non-staging SSM parameter reads, infrastructure control-plane mutations and role assumption. This closes the broad parameter-read access otherwise inherited from AmazonSSMManagedInstanceCore. The RDS-managed administrator secret is excluded from host permissions. IAM simulation using synthetic ARNs confirmed application-secret/staging-parameter/release-object access and denial of unrelated secrets, the DB administrator secret, unrelated parameters and unrelated S3 objects, plus explicit denial of role assumption. No role was created for simulation. See evidence/iam-isolation-simulation.json.

This verifies the proposal's structure and policy evaluation. Actual deployed resource IDs, routing, grants, DB users and application runtime still require post-provisioning verification. An isolated VPC is not a separate AWS account or a substitute for explicit IAM boundaries. Live providers and privileged enrollment remain disabled.

Sources: [SSM managed policy](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AmazonSSMManagedInstanceCore.html), [IAM NotResource](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_notresource.html). Pinned Guard rule sources and raw findings are retained locally.
