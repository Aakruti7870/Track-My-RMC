# Staging shutdown and cleanup

Status: PARTIAL. Procedure prepared; no cloud staging exists to rehearse it. No command below has been executed. Future stop/delete actions require authorization for the exact staging resource inventory. Never substitute production IDs.

## Preconditions for any action

1. Verify GetCallerIdentity returns account 260234292958 and use ap-south-1 explicitly.
2. Read DescribeStacks and ListStackResources for trackmyrmc-staging. Save only IDs/ARNs, tags and states, never secret values.
3. Match AppHost, Database, Vpc, volumes, bucket and secrets to that stack's physical IDs. Verify Project=TrackMyRMC and Environment=staging. Stop on any mismatch, shared attachment, unexpected dependency or unknown owner.
4. Exclude production EC2 i-0598aad6e6d729c69, RDS trackmyrmc-postgres, production VPC/SG/secrets/artifact bucket and all GOLD-e resources. Do not select resources using a broad account-wide tag or name-prefix delete.
5. Agree on retention of fixtures, artifacts and snapshots. Any later real data needs a separate authorized backup/retention plan. Stop application writes before stopping the database.

## Temporary shutdown

After verifying the exact stack-owned host and database, use graceful EC2 StopInstances and RDS StopDBInstance, then wait for stopped states. Example command templates:

```text
aws ec2 stop-instances --region ap-south-1 --instance-ids <VERIFIED_APPHOST_ID_FROM_STACK>
aws ec2 wait instance-stopped --region ap-south-1 --instance-ids <VERIFIED_APPHOST_ID_FROM_STACK>
aws rds stop-db-instance --region ap-south-1 --db-instance-identifier trackmyrmc-staging-postgres
aws rds wait db-instance-stopped --region ap-south-1 --db-instance-identifier trackmyrmc-staging-postgres
```

RDS automatically restarts after seven consecutive stopped days. Temporary shutdown is not permanent cost prevention. Plan an authorized restart or full cleanup before that deadline; no scheduler/Lambda/automatic stop action is created by this review. A later start may change the EC2 public IPv4 address, so access must use the approved SSM workflow.

With the reviewed 30GiB EBS,20GiB RDS storage,four secrets and assumed5GiB S3, temporarily stopped persistent costs are approximately USD 7.081/month before backups, requests, versions and tax. Python Decimal calculated this scenario from the same rates as the USD 42.413 running baseline. RDS restart resumes compute charges. EC2 instance-hour charges stop, but EBS continues. This estimate is not a guarantee of zero spend.

## Full cleanup

1. Produce and approve a manifest of every physical resource and every retained item, with an owner and expiry. Snapshot retention requires explicit storage-cost acknowledgement.
2. Delete the CloudFormation stack only after the exact inventory is approved. Retain policies intentionally keep RDS, the artifact bucket and three application secrets. RDS deletion protection remains in effect. A successful stack deletion does not mean billing has stopped.
3. Verify the terminated host's DeleteOnTermination EBS volume is gone and its automatically assigned public IPv4 is released. Investigate any remaining stack-owned volume, snapshot, network interface or address individually.
4. For the retained staging DB only, obtain destructive cleanup approval, disable its deletion protection and decide whether a final snapshot/retained automated backups are required. Delete the exact staging DB, wait for deletion and separately inventory retained snapshots/backups. Do not use SkipFinalSnapshot unless explicitly approved for the verified synthetic data.
5. For the retained staging bucket only, approve removal of all versions and delete markers, inspect/abort incomplete multipart uploads, empty it and delete it. A recursive current-object delete alone does not empty a versioned bucket. Do not introduce Object Lock merely to pass Guard; locked retention can prevent cleanup.
6. For the three retained staging application secrets, schedule deletion with an approved recovery window. Handle the RDS-managed administrator secret according to RDS ownership/lifecycle; never retrieve or broadly delete secrets by prefix. Do not use immediate forced deletion without separate approval.
7. Check retained/manual snapshots, backup storage, EBS volumes, S3 versions/uploads, secrets, public IPs and any later-added log groups/endpoints/NAT/DNS resources. Keep a retained-item ledger with expected continuing charges. Leave the account-wide cost budget active unless its deletion is separately requested.
8. Verify the exact stack-owned resources are absent and reconcile subsequent AWS billing/Cost Explorer usage, allowing for billing delays. Record remaining retained costs explicitly. Production resource metadata must remain unchanged.

No destructive database rollback or production restore is part of this procedure. Do not run broad aws s3 rm --recursive, DeleteSecret, DeleteDBInstance or bulk resource deletion against inferred names.

Sources: [RDS stop/restart and ongoing storage charges](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html), [EC2 stop/start](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Stop_Start.html).
