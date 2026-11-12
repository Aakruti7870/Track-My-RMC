"""Offline tests for fail-closed DigiLocker Live activation; no provider IO."""
from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT / "ops" / "aws-deploy-ec2.sh"
CHECKER = ROOT / "ops" / "release" / "verify-digilocker-credentials.py"


class FakeResponse:
    status = 200

    def __init__(self, content):
        self.content = content

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def read(self, size=-1):
        return self.content


def checker_module():
    spec = importlib.util.spec_from_file_location("digilocker_credential_verifier", CHECKER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DigiLockerLiveActivationTests(unittest.TestCase):
    def test_live_preflight_before_binary_or_environment_change(self):
        source = DEPLOY.read_text(encoding="utf-8")
        self.assertIn('if [[ "$TRACKMYRMC_KYC_ENABLED" == "true" && "$TRACKMYRMC_KYC_ENV" == "live" ]]; then', source)
        self.assertIn('LIVE_KYC_PREFLIGHT="$RELEASE_STAGE/source/ops/release/verify-digilocker-credentials.py"', source)
        self.assertIn('LIVE_KYC_API_KEY="$LIVE_KYC_API_KEY"', source)
        self.assertIn('LIVE_KYC_API_SECRET="$LIVE_KYC_API_SECRET"', source)
        self.assertIn('PYTHONDONTWRITEBYTECODE=1 python3 "$LIVE_KYC_PREFLIGHT"', source)
        self.assertLess(source.index('PYTHONDONTWRITEBYTECODE=1 python3 "$LIVE_KYC_PREFLIGHT"'),
                        source.index('mv -Tf -- "$RELEASE_STAGE/backend"'))
        self.assertLess(source.index('PYTHONDONTWRITEBYTECODE=1 python3 "$LIVE_KYC_PREFLIGHT"'),
                        source.index('APP_ENV_TMP="$(mktemp /etc/trackmyrmc/.app.env.'))
        self.assertIn("preserving current deployment and KYC flags", source)

    def test_live_approval_required_before_any_network(self):
        module = checker_module()
        called = []
        with patch.dict("os.environ", {
            "TRACKMYRMC_KYC_ENV": "live",
            "TRACKMYRMC_KYC_LIVE_APPROVED": "false",
            "LIVE_KYC_API_KEY": "key_live_example_for_ci",
            "LIVE_KYC_API_SECRET": "secret_live_example_for_ci",
        }, clear=True), patch.object(module, "urlopen", side_effect=lambda *args, **kwargs: called.append(args)):
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(module.main(), 2)
        self.assertIn("LIVE_APPROVAL_MISSING", output.getvalue())
        self.assertEqual(called, [])

    def test_live_auth_redacts_token_and_never_initiates_identity_session(self):
        module = checker_module()
        token = "synthetic_provider_token_do_not_print"
        key = "key_live_ci_synthetic"
        secret = "secret_live_ci_synthetic"
        payload = json.dumps({"code": 200, "data": {"access_token": token}}).encode()
        requested_urls = []

        def fake_urlopen(request, timeout):
            requested_urls.append(request.full_url)
            self.assertEqual(request.get_header("X-api-key"), key)
            self.assertEqual(request.get_header("X-api-secret"), secret)
            return FakeResponse(payload)

        with patch.dict("os.environ", {
            "TRACKMYRMC_KYC_ENV": "live",
            "TRACKMYRMC_KYC_LIVE_APPROVED": "true",
            "LIVE_KYC_API_KEY": key,
            "LIVE_KYC_API_SECRET": secret,
        }, clear=True), patch.object(module, "urlopen", side_effect=fake_urlopen):
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertEqual(module.main(), 0)
        self.assertEqual(requested_urls, ["https://api.sandbox.co.in/authenticate"])
        self.assertIn("DIGILOCKER_AUTH=PASS; ENVIRONMENT=live", output.getvalue())
        for value in (token, key, secret):
            self.assertNotIn(value, output.getvalue())

    def test_bad_live_auth_fails_closed(self):
        module = checker_module()
        with patch.dict("os.environ", {
            "TRACKMYRMC_KYC_ENV": "live",
            "TRACKMYRMC_KYC_LIVE_APPROVED": "true",
            "LIVE_KYC_API_KEY": "key_live_ci_synthetic",
            "LIVE_KYC_API_SECRET": "secret_live_ci_synthetic",
        }, clear=True), patch.object(module, "urlopen", return_value=FakeResponse(b'{"code":401}')):
            output = io.StringIO()
            with redirect_stdout(output):
                self.assertNotEqual(module.main(), 0)
        self.assertNotIn("PASS", output.getvalue())


if __name__ == "__main__":
    unittest.main()
