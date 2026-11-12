"""Read-only release guards for independent Meta WhatsApp activation switches.

Runs the isolated provider-gate shell fragment with synthetic configuration only.
It never uses AWS credentials, sends a message, or starts a worker.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import unittest

DEPLOY = Path(__file__).resolve().parents[2] / "ops" / "aws-deploy-ec2.sh"
START = "# Independent, fail-closed Meta provider release switches."
END = '\naws s3 cp "s3://$BUCKET/backend-$RELEASE_SHA"'


class ProviderActivationWiringTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = DEPLOY.read_text(encoding="utf-8")
        cls.fragment = cls.source.split(START, 1)[1].split(END, 1)[0]
        cls.fragment = START + cls.fragment

    def run_gate(self, config):
        if not shutil.which("jq"):
            self.skipTest("jq is required by the production deployment")
        env = dict(os.environ)
        env.update(
            APP_JSON=json.dumps(config),
            META_TOKEN="synthetic-meta-token",
            META_PHONE="123456789012345",
            META_WABA="987654321012345",
        )
        command = (
            "set -euo pipefail\n" + self.fragment
            + '\nprintf "%s|%s|%s|%s\\n" "$DISPATCH_WHATSAPP_ENABLED" '
            + '"$DISPATCH_WHATSAPP_MARKETING_ENABLED" '
            + '"$ADMIN_MARKETING_SEND_ENABLED" "$ADMIN_WHATSAPP_REPLIES_ENABLED"\n'
        )
        return subprocess.run(
            ["bash", "-c", command], env=env,
            capture_output=True, text=True, check=False, timeout=10,
        )

    def test_script_is_valid_bash(self):
        result = subprocess.run(
            ["bash", "-n", str(DEPLOY)], capture_output=True, text=True,
            check=False, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_default_all_off(self):
        result = self.run_gate({})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "false|false|false|false")

    def test_reject_invalid_flag_without_falling_open(self):
        result = self.run_gate({"ADMIN_MARKETING_SEND_ENABLED": "YES"})
        self.assertNotEqual(result.returncode, 0)

    def test_utility_requires_signed_webhook_and_template(self):
        result = self.run_gate({"DISPATCH_WHATSAPP_ENABLED": True})
        self.assertNotEqual(result.returncode, 0)
        result = self.run_gate({
            "DISPATCH_WHATSAPP_ENABLED": True,
            "META_APP_SECRET": "a" * 32,
            "META_WEBHOOK_VERIFY_TOKEN": "b" * 40,
        })
        self.assertNotEqual(result.returncode, 0)
        result = self.run_gate({
            "DISPATCH_WHATSAPP_ENABLED": True,
            "META_APP_SECRET": "a" * 32,
            "META_WEBHOOK_VERIFY_TOKEN": "b" * 40,
            "META_DISPATCH_TEMPLATE_NAME": "trackmyrmc_trip_dispatched",
        })
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.startswith("true|false|false|false"))

    def test_independent_admin_marketing_gate(self):
        result = self.run_gate({"ADMIN_MARKETING_SEND_ENABLED": True})
        self.assertNotEqual(result.returncode, 0)
        result = self.run_gate({
            "ADMIN_MARKETING_SEND_ENABLED": True,
            "META_APP_SECRET": "c" * 32,
            "META_WEBHOOK_VERIFY_TOKEN": "d" * 40,
        })
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.startswith("false|false|true|false"))

    def test_dispatch_promotion_needs_utility_and_own_template(self):
        config = {
            "DISPATCH_WHATSAPP_MARKETING_ENABLED": True,
            "META_APP_SECRET": "e" * 32,
            "META_WEBHOOK_VERIFY_TOKEN": "f" * 40,
            "META_MARKETING_TEMPLATE_NAME": "trackmyrmc_app_features",
        }
        self.assertNotEqual(self.run_gate(config).returncode, 0)
        config.update(DISPATCH_WHATSAPP_ENABLED=True)
        self.assertNotEqual(self.run_gate(config).returncode, 0)
        config.update(META_DISPATCH_TEMPLATE_NAME="trackmyrmc_trip_dispatched")
        result = self.run_gate(config)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.startswith("true|true|false|false"))

    def test_existing_meta_callback_preserved_as_signed_alias(self):
        routes = (DEPLOY.parents[0] / "backend" / "src" / "routes" / "mod.rs").read_text(encoding="utf-8")
        for path in ('"/api/meta/whatsapp/webhook"', '"/api/meta/dispatch-webhook"'):
            self.assertIn(path, routes)
        self.assertEqual(routes.count("get(dispatch_whatsapp::verify_meta_webhook)"), 2)
        self.assertEqual(routes.count(".post(dispatch_whatsapp::receive_meta_webhook)"), 2)

    def test_environment_exports_and_kyc_wiring_exist(self):
        for key in (
            "META_APP_SECRET", "META_WEBHOOK_VERIFY_TOKEN",
            "META_DISPATCH_TEMPLATE_NAME", "META_DISPATCH_TEMPLATE_LOCALE",
            "META_MARKETING_TEMPLATE_NAME", "META_MARKETING_TEMPLATE_LOCALE",
            "META_ADMIN_MARKETING_LOCALE", "DISPATCH_WHATSAPP_ENABLED",
            "DISPATCH_WHATSAPP_MARKETING_ENABLED", "ADMIN_MARKETING_SEND_ENABLED",
            "ADMIN_WHATSAPP_REPLIES_ENABLED", "TRACKMYRMC_KYC_ENABLED",
            "TRACKMYRMC_KYC_ENV", "TRACKMYRMC_KYC_LIVE_APPROVED",
        ):
            self.assertIn(f"{key}=${key}", self.source)
        self.assertIn('[[ "$TRACKMYRMC_KYC_LIVE_APPROVED" == \'true\' ]]', self.source)


if __name__ == "__main__":
    unittest.main()
