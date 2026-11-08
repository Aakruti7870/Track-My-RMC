"""Offline contract checks: CI passing must not authorize production deployment."""
from pathlib import Path
import unittest

WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/deploy-aws-production.yml"

class ProductionReleaseApprovalTests(unittest.TestCase):
    def test_automatic_or_manual_deploy_needs_approved_exact_sha(self):
        content = WORKFLOW.read_text()
        self.assertIn("workflow_dispatch:", content)
        self.assertIn("github.ref == 'refs/heads/main'", content)
        self.assertIn("vars.TRACKMYRMC_APPROVED_RELEASE_SHA != ''", content)
        self.assertIn("vars.TRACKMYRMC_APPROVED_RELEASE_SHA == (github.event.workflow_run.head_sha || inputs.release_sha)", content)
        self.assertIn("github.event.workflow_run.conclusion == 'success'", content)
        self.assertIn("github.event.workflow_run.event == 'push'", content)
        self.assertIn("github.event.workflow_run.head_repository.full_name == github.repository", content)
        self.assertIn('[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]', content)
        self.assertIn('test "$TRACKMYRMC_APPROVED_RELEASE_SHA" = "$RELEASE_SHA"', content)
        self.assertIn("RELEASE_SHA: ${{ github.event.workflow_run.head_sha || inputs.release_sha }}", content)
        self.assertIn("ref: ${{ env.RELEASE_SHA }}", content)

    def test_gate_is_before_aws_credentials_and_ssm(self):
        content = WORKFLOW.read_text()
        self.assertLess(content.index("vars.TRACKMYRMC_APPROVED_RELEASE_SHA != ''"),
                        content.index("name: Verify both CI workflows"))
        self.assertLess(content.index("name: Verify both CI workflows"),
                        content.index("name: Configure AWS credentials"))
        self.assertLess(content.index("name: Configure AWS credentials"),
                        content.index("name: Deploy EC2 through AWS SSM"))

if __name__ == "__main__":
    unittest.main()
