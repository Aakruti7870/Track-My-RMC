# TrackMyRMC launch-readiness / recovery audit — 21 October 2026

**Decision: NO-GO for unrestricted public launch or live financial transactions.**
Web/API production at commit f69ee16 (GitHub deployment 39406812502) passed trusted-origin checks. This does not prove Android device workflows, real payment providers, or complete 13-role parity.

## Verified live AWS inventory

| Control | Live observation | Decision |
| --- | --- | --- |
| RDS | trackmyrmc-postgres, available in ap-south-1 | Available |
| RDS encryption / deletion protection | Enabled / enabled | PASS |
| Automated backups | Seven days retention; recent restorable timestamp | PASS at inventory level |
| Manual snapshot | trackmyrmc-pre-url-recovery-20261016, available | Isolated restore NOT verified |
| EC2 / SSM | i-0598aad6e6d729c69, running / online | Connected |
| Configured RDS initial DBName | trackmyrmc | Does not prove the active DB |
| Direct read-only SSM runtime audit, 21 October | postgres (intended name: trackmyrmc) | Mismatch **confirmed**, no cutover |
| Cloudflare public edge | GitHub runner was challenged with HTTP 403 | Independent browser smoke required |

## Read-only recovery gate

From a trusted AWS CLI session, run:

    bash ops/release/audit-aws-recovery.sh

This uses RDS Describe and SSM to inspect the existing EC2 configuration. SSM prints **only the parsed database name**, never the database URL/password. It performs NO restore, snapshot, migration, database write, IAM change, application deployment, or credential rotation.

The corresponding Python script ops/release/recovery_gate.py fails closed when any of the following are missing: encrypted/deletion-protected/available RDS; at least seven-day automated backups and recent restorable time; a recent encrypted available manual snapshot; exact parity between verified runtime database name and intended database; and signed-off evidence of an isolated restore plus data/schema/migration validation, read-only smoke and rollback rehearsal.

After those tests have **actually been performed**, a reviewer may create a JSON evidence file and supply its path as the first argument to the audit script:

    {
      "source_instance": "trackmyrmc-postgres",
      "snapshot_id": "<recent-manual-snapshot-id>",
      "restored_instance": "<different-isolated-RDS-instance-id>",
      "verified_by": "<release-reviewer>",
      "verified_at": "<UTC ISO8601 time>",
      "checks": {
        "restored_instance_healthy": true,
        "schema_migration_parity": true,
        "sampled_data_parity": true,
        "application_read_only_smoke": true,
        "application_rollback_rehearsed": true
      }
    }

Do NOT mark these flags true just to pass CI. This is an evidence-inventory check, not cryptographic attestation. An RDS test restore may incur charges, so it requires explicit cost approval.

The same AWS audit confirmed configured fields are present for WhatsApp OTP, staff email, KYC, Cashfree, Maps, and Play reviewer access. Presence of credentials is not evidence of successful live delivery or payment acceptance.
**Payment environment:** the AWS production application's Cashfree environment selector is currently SANDBOX. This is appropriate for acceptance testing but does not authorize or enable real-money payment processing. Do not silently switch to production credentials or callbacks before controlled tests and sign-off.

**Deployment log security:** raw SSM invocation/stdout/stderr are now intentionally excluded from GitHub Actions logs in the proposed PR, leaving only status metadata and AWS command ID for authorized diagnostic retrieval.

## Monitoring design (not activated)

A further AWS read-only audit found **no CloudWatch metric alarms with TrackMyRMC naming and no CloudWatch Logs groups** in ap-south-1. Production RDS ingress was limited to a security-group reference, not public internet; EC2 ports 80 and 443 are publicly accessible as intended and SSH was not open to the entire internet.

The proposed infrastructure-as-code template at ops/monitoring/trackmyrmc-production-alarms.yml defines four opt-in EC2 status and RDS CPU/storage alarms requiring an **existing SNS topic with an active, verified subscriber**. It has NOT been deployed, and AWS alarm/SNS/log-ingestion charges require review. Configure and test CloudWatch Logs ingestion from systemd/Nginx separately; creating a log group without installing a collector would not establish production log monitoring.

## Remaining mandatory launch gates

1. **Recovery and data**: reconcile the live postgres database against intended trackmyrmc, verify migration history and actual records, independently test isolated restoration, rotate exposed database credentials and rehearse rollback. Existing draft PR #42 remains unapproved.
2. **Live customer order**: authorized test identity completes WhatsApp OTP, Sandbox KYC, plant selection, RFQ/order, production/stock, TM dispatch/GPS, challan, POD, invoice, payment, refund/void and ledger reconciliation, including negative cases.
3. **Providers**: verify production Meta WhatsApp, email/TOTP, Sandbox DigiLocker return, Cashfree webhook signature + duplicate retry idempotence, push and Google Maps restrictions using controlled test accounts and small test transactions.
4. **Android / Play**: build a fresh signed AAB from exact approved commit, test offline/background GPS and permission disclosures on real devices, verify account deletion and Play reviewer access, obtain Play production review approval. Android build success is not Play approval.
5. **13 roles and security**: complete missing authority role and specialized operator/store/fleet/quality/payroll workflows, audit all mutation tenant isolation, resolve applicable high-severity dependency findings on accepted lockfile, security/retention review and MFA recovery.
6. **Operational release**: public Cloudflare browser smoke, logging/alerts/on-call, data retention/deletion, support, costs, exact SHA+AAB+DB manifest and signed final Go/No-Go decision.

Production builds and deployed admin/staff module cards do NOT independently prove end-to-end behavior. The Customer, Plant Owner and Driver post-login cards are excluded from this safety-gate PR.

**Safety boundary:** The recovery checker and accompanying tests do not authorize a database cutover, new billable resources, real-money transactions or an uncontrolled release.
