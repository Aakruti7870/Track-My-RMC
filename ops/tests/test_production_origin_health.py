"""Fail-closed regression tests for production health verification output."""
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "verify-production-health.sh"

class ProductionOriginSafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = SCRIPT.read_text(encoding="utf-8")

    def test_release_sha_format_is_strict(self):
        self.assertIn("^[0-9a-f]{40}$", self.source)
        self.assertIn("Running backend release does not match", self.source)

    def test_installed_marker_is_verified(self):
        self.assertIn("/opt/trackmyrmc/DEPLOYED_RELEASE_SHA", self.source)
        self.assertIn('$(wc -c < "$marker_file")', self.source)
        self.assertIn('[[ "$(cat "$marker_file")" == "$EXPECTED_SHA" ]]', self.source)

    def test_ssm_streams_are_never_emitted_to_ci(self):
        self.assertIn("jq -c '{Status, ResponseCode}'", self.source)
        self.assertNotIn("jq -r '.StandardOutputContent", self.source)
        self.assertNotIn("jq -r '.StandardErrorContent", self.source)
        self.assertNotIn('echo "$INVOCATION"', self.source)
        self.assertIn("Trusted origin health verification failed", self.source)

    def test_authenticated_origin_still_checks_services(self):
        for expected in ("trackmyrmc-backend.service", "/health", "/healthz",
                         "/admin/", "/_expo/static/"):
            self.assertIn(expected, self.source)

    def test_cloudflare_challenge_not_claimed_publicly_verified(self):
        self.assertIn("cf-mitigated:", self.source)
        self.assertIn("public edge remains independently unverified", self.source)

if __name__ == "__main__":
    unittest.main()
