# AWS production auto-deployment — release readiness

Status: **BLOCKED / AUTO-DEPLOY DISABLED**. This documents a fail-closed
pipeline, not approval to deploy, cut over a database or spend on AWS snapshots.

## Verified AWS findings (2026-10-16)

- Account 260234292958; region ap-south-1.
- Existing EC2 `i-0598aad6e6d729c69` running; Systems Manager online.
- RDS instance `trackmyrmc-postgres` is available, encrypted, deletion-protected;
  database name reported as `trackmyrmc`; automated backup retention is 7 days.
- The *running application's* environment file targets a DIFFERENT database,
  `postgres`. These databases are not interchangeable. Data parity and migration
  history have **not** been established.
- No manually created RDS snapshot was observed in the account at audit time.
  An isolated restore rehearsal has not been verified.
- Existing application saves `frontend.prev`, `source.prev` and `admin-web.prev`,
  but previously had no automatic rollback to those files on a failed release.
- A read-only Systems Manager diagnostic unexpectedly included a credential-bearing
  connection URL in the command output because `DATABASE_URL` is quoted in the
  environment file. Treat this as a credential-exposure event. Rotate the affected
  database credential using a controlled procedure and review command-history access
  before enabling automation. Never post or copy that URL into issues/artifacts.
- The `TrackMyRMC-GitHubDeploy` IAM role currently lacks RDS description and
  snapshot actions. The new workflow intentionally fails closed until least-privilege
  authorization is reviewed and granted.

## Pipeline behavior

The `Deploy TrackMyRMC AWS Production` workflow listens for completion of the
Backend, Frontend and Android Build Validation workflows on `main`, but **does
not run the deploy job by default**. Both repository configuration variables
`TRACKMYRMC_RECOVERY_VERIFIED` and `TRACKMYRMC_AUTO_PRODUCTION_ENABLED`
must be explicitly set to the string `true` for unattended deployment.

When enabled, the job:
1. Verifies its release SHA is the current `main` HEAD and the three successful
   `push` workflow runs all match that exact SHA.
2. Rebuilds and tests the pinned SHA.
3. Checks RDS instance status, encryption, backup retention, deletion protection,
   and an available recovery point.
4. Runs a read-only Systems Manager database-parity preflight on the production
   server before changing files. **Current production fails this step.**
5. Creates and waits for a completed manual RDS recovery snapshot before
   uploading and deploying the release. This can incur additional AWS charges.
6. Keeps a per-release copy of the previous application assets, systemd unit,
   Nginx config and environment file. The script restores the previous application
   after a failed internal health check. The workflow also triggers a SHA-scoped
   rollback when the public HTTPS smoke test fails.
7. Does not claim rollback of incompatible or irreversible PostgreSQL migrations.
   This is a separate release prerequisite.

## Requirements before enabling (all mandatory)

- [ ] Audit both production databases, table counts, migration checksums and
      customer/order/financial data. Agree on ONE canonical database name and
      demonstrate no data loss. Plan any cutover as a separate approved change.
- [ ] Rotate the database credential after the diagnostic-output exposure,
      reconcile the application environment and managed RDS secret, and verify
      login plus service health. Do not log passwords or connection URLs.
- [ ] Create a verified recovery point and complete an isolated restore rehearsal,
      including an application rollback test and migration compatibility review.
- [ ] Review the IAM role's OIDC trust (restricted to main), and grant only required
      RDS describe and snapshot access, including snapshot resources
      `arn:aws:rds:ap-south-1:260234292958:snapshot:trackmyrmc-release-*`.
      Confirm allowed actions using IAM simulation. Do not broaden unrelated access.
- [ ] Confirm S3 snapshot/backup costs, RDS snapshot retention/cleanup, alerting,
      recovery operator, and availability of enough EC2 disk for app backups.
- [ ] Resolve the outstanding production checklist blockers for authentication,
      live-provider verification, device acceptance, dependencies, security, and
      historical migration. Obtain the required independent review/sign-off.
- [ ] Set `TRACKMYRMC_RECOVERY_VERIFIED=true` only after evidence is accepted.
- [ ] Set `TRACKMYRMC_AUTO_PRODUCTION_ENABLED=true` only after final
      production auto-deploy authorization.

Do not enable either variable as a shortcut. A clean CI build alone does not
certify the production database, restore or safety prerequisites. A merge to
`main` never constitutes permission to remove these protections.

For emergencies: disable `TRACKMYRMC_AUTO_PRODUCTION_ENABLED`, inspect the
RDS recovery point and SSM history, then use an approved rollback/restore
procedure; never restore a database automatically without an impact review.
