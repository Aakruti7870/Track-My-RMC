"""Offline live DigiLocker release tests. No AWS, secrets or provider calls."""
import importlib.util
import io
import os
import subprocess
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "kyc_auth", ROOT / "ops/release/verify-digilocker-credentials.py"
)
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)


class DigiLockerLiveSafety(unittest.TestCase):
    def read(self, path):
        return (ROOT / path).read_text(encoding="utf-8")

    def test_backend_uses_separate_hosts_and_live_approval(self):
        s = self.read("backend/src/routes/digilocker_kyc.rs")
        for key in (
            "https://test-api.sandbox.co.in", "https://api.sandbox.co.in",
            '"SANDBOX_KYC_API_KEY"', '"SANDBOX_KYC_API_SECRET"',
            '"LIVE_KYC_API_KEY"', '"LIVE_KYC_API_SECRET"',
            '"TRACKMYRMC_KYC_LIVE_APPROVED"', '"TRACKMYRMC_KYC_ENABLED"',
        ):
            self.assertIn(key, s)
        self.assertNotIn('env::var("KYC_API_KEY")', s)
        self.assertNotIn('env::var("KYC_API_SECRET")', s)
        self.assertIn('"provider":provider.label', s)
        self.assertIn("pending_authority_review", s)

    def test_session_reads_and_writes_use_the_selected_environment_host(self):
        # Catch a regression where Live auth/init uses the Live API but
        # session polling, Aadhaar and profile GETs leak to the Test API.
        source = self.read("backend/src/routes/digilocker_kyc.rs")
        self.assertIn('.post(provider_url(self.host, path))', source)
        self.assertIn('.get(provider_url(self.host, path))', source)
        self.assertNotIn('.get(format!("{SANDBOX_HOST}{path}"))', source)
        self.assertIn("provider_status_document_and_profile_requests_use_the_selected_host", source)

    def test_session_environment_is_explicit_and_backward_compatible(self):
        m = self.read("backend/migrations/0041_digilocker_provider_environment.sql")
        s = self.read("backend/src/routes/digilocker_kyc.rs")
        self.assertIn("DEFAULT 'sandbox'", m)
        self.assertIn("CHECK (provider_environment IN ('sandbox', 'live'))", m)
        self.assertIn("INSERT INTO customer_digilocker_sessions(user_id,provider_environment)", s)
        self.assertIn("provider_environment=$2", s)
        self.assertIn(".bind(provider.environment)", s)

    def test_aws_deploy_disallows_fallback_and_requires_approval(self):
        s = self.read("ops/aws-deploy-ec2.sh")
        subprocess.run(["bash", "-n", str(ROOT / "ops/aws-deploy-ec2.sh")], check=True)
        self.assertIn("Live DigiLocker approval is missing", s)
        self.assertIn("LIVE_KYC_API_KEY", s)
        self.assertIn("SANDBOX_KYC_API_KEY", s)
        self.assertNotIn(".SANDBOX_KYC_API_KEY // .KYC_API_KEY", s)
        self.assertNotIn(".SANDBOX_KYC_API_SECRET // .KYC_API_SECRET", s)

    def test_invalid_or_unapproved_live_auth_never_connects(self):
        for env, expected in [
            ({}, "DIGILOCKER_AUTH=BLOCKED; REASON=INVALID_ENVIRONMENT"),
            ({"TRACKMYRMC_KYC_ENV": "live"}, "DIGILOCKER_AUTH=BLOCKED; REASON=LIVE_APPROVAL_MISSING"),
            ({"TRACKMYRMC_KYC_ENV": "sandbox"}, "DIGILOCKER_AUTH=BLOCKED; REASON=ENVIRONMENT_KEYS_MISSING"),
        ]:
            out = io.StringIO()
            with patch.dict(os.environ, env, clear=True), redirect_stdout(out):
                self.assertEqual(MOD.main(), 2)
            self.assertEqual(out.getvalue().strip(), expected)

    def test_probe_response_validation(self):
        self.assertTrue(MOD.valid_response({"code":200,"data":{"access_token":"synthetic"}}))
        self.assertFalse(MOD.valid_response({"code":401,"data":{"access_token":"synthetic"}}))
        self.assertFalse(MOD.valid_response({"code":200,"data":{"access_token":""}}))

    def test_probe_redacts_transport_failure(self):
        out = io.StringIO()
        with (
            patch.dict(os.environ, {
                "TRACKMYRMC_KYC_ENV":"sandbox",
                "SANDBOX_KYC_API_KEY":"TEST-NO-REAL-CREDENTIAL",
                "SANDBOX_KYC_API_SECRET":"TEST-NO-REAL-CREDENTIAL"
            }, clear=True),
            patch.object(MOD, "urlopen", side_effect=URLError("test offline")),
            redirect_stdout(out),
        ):
            self.assertEqual(MOD.main(), 1)
        self.assertEqual(out.getvalue().strip(), "DIGILOCKER_AUTH=FAIL; REASON=CONNECTIVITY")
        self.assertNotIn("TEST-NO-REAL-CREDENTIAL", out.getvalue())


if __name__ == "__main__":
    unittest.main()
