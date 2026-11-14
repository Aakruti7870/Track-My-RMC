"""Offline DigiLocker live release contract: no secrets or provider traffic."""
from pathlib import Path
import unittest
import subprocess

ROOT = Path(__file__).resolve().parents[2]


class DigiLockerLiveReleaseGate(unittest.TestCase):
    def read(self, relative):
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_backend_environment_and_keys_are_isolated(self):
        src = self.read("backend/src/routes/digilocker_kyc.rs")
        self.assertIn('const SANDBOX_HOST: &str = "https://test-api.sandbox.co.in";', src)
        self.assertIn('const LIVE_HOST: &str = "https://api.sandbox.co.in";', src)
        for name in ("LIVE_KYC_API_KEY", "LIVE_KYC_API_SECRET",
                     "SANDBOX_KYC_API_KEY", "SANDBOX_KYC_API_SECRET",
                     "TRACKMYRMC_KYC_LIVE_APPROVED"):
            self.assertIn(name, src)
        self.assertNotIn('env::var("KYC_API_KEY")', src)
        self.assertNotIn('env::var("KYC_API_SECRET")', src)
        self.assertIn('"live_digilocker"', src)
        self.assertIn('"sandbox_digilocker"', src)

    def test_session_environment_never_reuses_other_mode(self):
        sql = self.read("backend/migrations/0041_digilocker_provider_environment.sql")
        src = self.read("backend/src/routes/digilocker_kyc.rs")
        self.assertIn("DEFAULT 'sandbox'", sql)
        self.assertIn("CHECK (provider_environment IN ('sandbox', 'live'))", sql)
        self.assertIn("INSERT INTO customer_digilocker_sessions(user_id,provider_environment,review_baseline_id)", src)
        self.assertIn("consent_still_authorized", src)
        self.assertIn("provider_environment=$2", src)
        self.assertIn(".bind(provider.environment)", src)
        self.assertIn("pending_authority_review", src)

    def test_deploy_requires_explicit_live_approval_and_separate_keys(self):
        deploy = self.read("ops/aws-deploy-ec2.sh")
        self.assertIn("TRACKMYRMC_KYC_LIVE_APPROVED", deploy)
        self.assertIn("Live DigiLocker approval is missing", deploy)
        self.assertIn("LIVE_KYC_API_KEY", deploy)
        self.assertIn("LIVE_KYC_API_SECRET", deploy)
        self.assertIn("SANDBOX_KYC_API_KEY", deploy)
        self.assertNotIn(".SANDBOX_KYC_API_KEY // .KYC_API_KEY", deploy)
        self.assertNotIn(".SANDBOX_KYC_API_SECRET // .KYC_API_SECRET", deploy)
        subprocess.run(["bash", "-n", str(ROOT / "ops/aws-deploy-ec2.sh")], check=True)


if __name__ == "__main__":
    unittest.main()
