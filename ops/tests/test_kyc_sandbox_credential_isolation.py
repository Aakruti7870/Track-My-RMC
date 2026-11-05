"""Offline KYC environment separation guard. No secrets or network are required."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class SandboxKycIsolation(unittest.TestCase):
    def test_backend_requires_explicit_sandbox_keys(self):
        source = (ROOT / "backend/src/routes/digilocker_kyc.rs").read_text()
        self.assertIn('env::var("TRACKMYRMC_KYC_ENABLED")', source)
        self.assertIn('env::var("TRACKMYRMC_KYC_ENV")', source)
        self.assertIn('env::var("SANDBOX_KYC_API_KEY")', source)
        self.assertIn('env::var("SANDBOX_KYC_API_SECRET")', source)
        self.assertNotIn('env::var("KYC_API_KEY")', source)
        self.assertNotIn('env::var("KYC_API_SECRET")', source)
        self.assertIn('const SANDBOX_HOST: &str = "https://test-api.sandbox.co.in";', source)

    def test_deploy_fails_closed_without_sandbox_credentials(self):
        source = (ROOT / "ops/aws-deploy-ec2.sh").read_text()
        self.assertIn("TRACKMYRMC_KYC_ENABLED", source)
        self.assertIn('SANDBOX_KYC_API_KEY=', source)
        self.assertIn('SANDBOX_KYC_API_SECRET=', source)
        self.assertIn("'Missing Sandbox test KYC credentials'", source)
        self.assertNotIn('.SANDBOX_KYC_API_KEY // .KYC_API_KEY', source)
        self.assertNotIn('.SANDBOX_KYC_API_SECRET // .KYC_API_SECRET', source)
        self.assertIn("https://trackmyrmc.com/kyc/return", source)


if __name__ == "__main__":
    unittest.main()
