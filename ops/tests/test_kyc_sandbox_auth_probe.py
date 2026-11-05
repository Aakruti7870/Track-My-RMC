"""Offline tests for redacted Sandbox test-auth preflight (no network, no secrets)."""
import importlib.util
import io
import os
from pathlib import Path
from contextlib import redirect_stdout
from unittest import TestCase
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "sandbox_auth_probe", ROOT / "ops/release/verify-sandbox-digilocker-auth.py"
)
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)


class SandboxAuthProbeTests(TestCase):
    def test_requires_explicit_sandbox_credentials(self):
        output = io.StringIO()
        with patch.dict(os.environ, {}, clear=True), redirect_stdout(output):
            self.assertEqual(PROBE.main(), 2)
        self.assertEqual(
            output.getvalue().strip(),
            "SANDBOX_AUTH=BLOCKED; REASON=TEST_CREDENTIALS_MISSING"
        )

    def test_contract_token_is_never_used_as_success_without_code_200(self):
        self.assertFalse(PROBE.valid_auth_response({}))
        self.assertFalse(PROBE.valid_auth_response({"code": 200, "data": {}}))
        self.assertFalse(PROBE.valid_auth_response({"code": 401, "data": {"access_token": "fake"}}))
        self.assertFalse(PROBE.valid_auth_response({"code": 200, "data": {"access_token": ""}}))
        self.assertTrue(PROBE.valid_auth_response({"code": 200, "data": {"access_token": "synthetic-test"}}))

    def test_network_exception_never_prints_credential_values(self):
        from urllib.error import URLError
        output = io.StringIO()
        with (
            patch.dict(os.environ, {
                "SANDBOX_KYC_API_KEY": "FAKE_FOR_UNIT_TEST_KEY",
                "SANDBOX_KYC_API_SECRET": "FAKE_FOR_UNIT_TEST_SECRET"
            }, clear=True),
            patch.object(PROBE, "urlopen", side_effect=URLError("unreachable")),
            redirect_stdout(output),
        ):
            self.assertEqual(PROBE.main(), 1)
        self.assertEqual(output.getvalue().strip(), "SANDBOX_AUTH=FAIL; REASON=NETWORK_OR_TLS")
        self.assertNotIn("FAKE_FOR_UNIT_TEST", output.getvalue())
