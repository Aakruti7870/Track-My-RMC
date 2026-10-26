"""Offline launch contract tests; no AWS credentials, network or paid resources."""
from pathlib import Path
import subprocess
import unittest
import json
import re

ROOT = Path(__file__).resolve().parents[2]


class LaunchContracts(unittest.TestCase):
    def read(self, path):
        return (ROOT / path).read_text(encoding="utf-8")

    def test_payment_production_fail_closed(self):
        body = self.read("backend/src/routes/cashfree_sandbox.rs")
        self.assertIn('env::var("APP_ENV")', body)
        self.assertIn('eq_ignore_ascii_case("production")', body)
        self.assertIn('env::var("CASHFREE_SANDBOX_ENABLED")', body)
        self.assertIn('env::var("CASHFREE_MODE")', body)
        self.assertIn('verify_signature(&secret, timestamp, signature, &body)', body)
        self.assertIn("cashfree_order(", body)

    def test_payment_database_has_no_unapproved_prod_auto_migration(self):
        self.assertTrue((ROOT / "ops/pending-migrations/cashfree_sandbox_intents.sql").is_file())
        self.assertFalse((ROOT / "backend/migrations/0041_cashfree_sandbox_intents.sql").exists())

    def test_thirteen_roles_cannot_bypass_plant_boundaries(self):
        source = self.read("backend/src/routes/staff_module_permissions.rs")
        self.assertIn('return owned_plant(state, user, plant).await;', source)
        self.assertIn('"Plant staff permission required for this module"', source)
        for role in ("admin", "dispatcher", "operator", "supervisor", "accountant",
                     "quality_engineer", "fleet_manager", "store_manager"):
            self.assertIn(f'"{role}"', source)
        test = self.read("backend/tests/staff_module_permissions_tests.rs")
        self.assertIn("all_thirteen_roles_fail_closed_without_plant_scope", test)
        for role in ("customer", "driver", "authority", "central_admin"):
            self.assertIn(f'"{role}"', test)

    def test_kyc_bounded_activation_and_schema(self):
        self.assertIn('TRACKMYRMC_KYC_ENABLED', self.read("backend/src/routes/digilocker_kyc.rs"))
        self.assertIn("customer_digilocker_sessions", self.read(
            "backend/migrations/0040_customer_digilocker_sessions.sql"))

    def test_android_release_is_separate_from_unreviewed_merge(self):
        workflow = self.read(".github/workflows/android-build.yml")
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("ANDROID_KEYSTORE_BASE64", workflow)
        self.assertIn("EXPECTED_PLAY_UPLOAD_SHA1", workflow)
        self.assertNotIn("pull_request:", workflow)
        self.assertIn("com.trackmyrmc.concreteking", workflow)

    def test_android_version_and_package_match_signed_candidate(self):
        app = json.loads(self.read("frontend/app.json"))["expo"]
        workflow = self.read(".github/workflows/android-build.yml")
        self.assertEqual(app["android"]["package"], "com.trackmyrmc.concreteking")
        self.assertIn(f'VERSION_NAME: "{app["version"]}"', workflow)
        self.assertIn(f'VERSION_CODE: "{app["android"]["versionCode"]}"', workflow)
        self.assertIn("EXPECTED_PLAY_UPLOAD_SHA1", workflow)
        self.assertIn("Verify required signing secrets", workflow)
        self.assertRegex(workflow, r"(?m)^  workflow_dispatch:$")

    def test_operations_preflight_has_no_mutation(self):
        script = self.read("ops/release/launch_preflight_readonly.sh")
        self.assertIn("SQLX_MAX_VERSION", script)
        self.assertIn("PUBLIC_LAUNCH=NOT_YET_DETERMINED", script)
        for dangerous in ("aws rds restore", "aws ssm put-parameter", "aws secretsmanager put-secret",
                          "psql -c 'UPDATE", "DROP TABLE", "CREATE DATABASE"):
            self.assertNotIn(dangerous, script)
        subprocess.run(["bash", "-n", str(ROOT / "ops/release/launch_preflight_readonly.sh")],
                       check=True)

    def test_alert_template_requires_verified_topic(self):
        template = self.read("ops/monitoring/trackmyrmc-production-alarms.yml")
        self.assertIn("AlertTopicArn", template)
        self.assertGreaterEqual(template.count("AWS::CloudWatch::Alarm"), 4)


if __name__ == "__main__":
    unittest.main()
