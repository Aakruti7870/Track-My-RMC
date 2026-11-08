# TrackMyRMC — AWS-only production release guide

**Canonical production is `https://trackmyrmc.com`, served from AWS EC2/Nginx with AWS RDS PostgreSQL.** The existing AWS SHA-pinned GitHub workflow installs the Rust backend, Expo web frontend and separate admin web dashboard together. Render is not a production build, deployment, database, or API dependency. The obsolete Render backend Blueprints (`render.yaml` and `backend/render.yaml`) were removed.

**Render separation state (2026-11-09):** The separately configured Render static site may still auto-build `main` until disabled in the Render dashboard. Cloudflare's enabled `www.trackmyrmc.com` → `https://trackmyrmc.com` HTTP 301 redirect and the proxied `www` CNAME pointing to `trackmyrmc.com` were verified through Cloudflare's API. DNS no longer targets Render. An independent public HTTPS redirect smoke test remains necessary; deleting YAML does not disable existing Render dashboard services.

## Entry points and release provenance

- CI: .github/workflows/backend.yml and .github/workflows/frontend.yml.
- Release: .github/workflows/deploy-aws-production.yml.
- Instance installation: ops/aws-deploy-ec2.sh.
- Post-release smoke/asset identity: ops/verify-production-health.sh.
- Production hostname: https://trackmyrmc.com.
- API health: /health and /healthz; privileged admin web is served under /admin/.

Only a specifically approved **main** commit can release. TRACKMYRMC_APPROVED_RELEASE_SHA must be a nonempty exact match for that SHA, and the production workflow verifies both Backend CI and Frontend CI passed on a main push of the same commit. Manual dispatch cannot bypass this check.

**Do not set or change the approval variable to force a release.** Merge readiness is a different decision from production authorization. GitHub app visibility of the variable may be restricted; an authorized repository operator must verify the value.

## Pre-release acceptance

1. Confirm the exact commit, PR reviews, backend PostgreSQL 16/18 tests, frontend and admin builds and regression evidence.
2. Use an **approved scoped IAM/operator role**, never AWS root, for production changes.
3. Independently validate the live RDS TLS configuration (client certificate, hostname and trusted CA) and production database name, migration history/checksums and pending migration ordering. The backend runs pending migrations **at startup**.
4. Confirm an approved backup and tested restoration/rollback strategy. Do not delete migration ledger entries, rewrite applied migrations, revert payment data or erase reviewer access.
5. Obtain explicit provider/role-specific acceptance for live privileged operators, KYC, Cashfree and Play disclosures where applicable. Existing sandbox success is not production activation.
6. Verify live automation flags with the authorized operator. Keep NATIVE_AUTOMATION_WORKER_ENABLED and NATIVE_SUPPORT_AUTOMATION_ENABLED OFF unless a separate, specifically approved activation exists; enabling the base worker may also process other governed workflows.
7. Have the release authority independently approve the exact main SHA and record the acceptance evidence.

## Controlled deployment

Use the existing GitHub AWS production workflow. It packages the SHA-pinned Rust binary, Expo web bundle, admin-web bundle, source and deployment script, uploads the approved artifacts to the repository's production artifact bucket and deploys through SSM with a trusted origin verification.

A skipped workflow is **not** a deployment. Inspect the run's actual conclusion, deploy job, S3 artifacts, EC2 release marker, running binary SHA and health results. Green CI without released artifacts must be reported as code-only success.

When a release fails, preserve the live database and notify the scoped operator. Follow reviewed application rollback/forward-revert procedures; never improvise a destructive schema downgrade or unapproved RDS restore.

## Evidence and constraints

- [PR #157 security and release assessment](security/pr157-release-assessment.md)
- [PR #159 support authorization and production acceptance](security/pr159-release-acceptance.md)
- [Deployment verification](DEPLOYMENT_VERIFICATION.md)
- [Production release checklist](PRODUCTION_RELEASE_CHECKLIST.md)
- [Controlled plant access rollout](release/controlled-plant-access-rollout.md)
- [Payment-specific restrictions](payments/RMC_PREPAID_PLAY_COMPLIANCE_AND_ROLLOUT.md)

This guide documents the intended guarded deployment, **not proof that a release has occurred**.
