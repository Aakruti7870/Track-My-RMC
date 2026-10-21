"""Prevent regression of unredacted EC2 SSM output into public CI logs."""
from pathlib import Path
import unittest

WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "deploy-aws-production.yml"

class DeploymentLoggingSafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = WORKFLOW.read_text(encoding="utf-8")
        start = cls.content.index("- name: Deploy EC2 through AWS SSM")
        end = cls.content.index("- name: Verify production release via trusted origin")
        cls.deployment = cls.content[start:end]

    def test_only_structured_command_status_emitted(self):
        self.assertIn("jq -c '{Status, ResponseCode}'", self.deployment)

    def test_raw_ssm_invocation_and_streams_not_published(self):
        for forbidden in (
            'echo "=== SSM invocation JSON ==="',
            '.StandardOutputContent //',
            '.StandardErrorContent //',
            'printf "%s" "$INVOCATION_JSON"',
        ):
            self.assertNotIn(forbidden, self.deployment)

    def test_deploy_must_abort_on_unsuccessful_ssm_status(self):
        self.assertIn('if [ "$STATUS" != "Success" ]', self.deployment)
        self.assertIn('exit 1', self.deployment)

if __name__ == "__main__":
    unittest.main()
