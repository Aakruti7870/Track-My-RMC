"""Exercise the installer's actual release-marker writer in a temporary path."""
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest


class ReleaseIdentityTests(unittest.TestCase):
    def test_deployment_stages_root_code_outside_application_write_access(self):
        root = Path(__file__).resolve().parents[2]
        script = (root / "ops/aws-deploy-ec2.sh").read_text()
        workflow = (root / ".github/workflows/deploy-aws-production.yml").read_text()
        self.assertIn("mktemp -d /tmp/trackmyrmc-deploy.XXXXXX", workflow)
        self.assertNotIn("/opt/trackmyrmc/deploy-cache", workflow)
        self.assertIn('[[ -L "$directory" ]]', script)
        self.assertIn('chown -h root:root -- "$directory"', script)
        self.assertNotIn("chown -R trackmyrmc", script)
        self.assertLess(script.index("secure_release_directory /opt/trackmyrmc\n"),
                        script.index("secure_release_directory /opt/trackmyrmc/release-tools"))
        self.assertLess(script.index('python3 -m py_compile "$RELEASE_STAGE/recover-managed-rds-credential.py"'),
                        script.index('mv -Tf -- "$RELEASE_STAGE/recover-managed-rds-credential.py"'))

    def test_installed_marker_is_exact_sha_and_line_feed(self):
        script = Path(__file__).resolve().parents[1] / "aws-deploy-ec2.sh"
        content = script.read_text()
        writer = next(line for line in content.splitlines()
                      if line.startswith("printf ") and ' "$RELEASE_STAGE/DEPLOYED_RELEASE_SHA"' in line)
        publish = next(line for line in content.splitlines()
                       if line.startswith("mv ") and line.endswith(" /opt/trackmyrmc/DEPLOYED_RELEASE_SHA"))
        self.assertLess(content.index('https://trackmyrmc.com$ADMIN_JS'), content.index(writer))
        self.assertLess(content.index(writer), content.index(publish))
        sha = "0123456789abcdef" * 2 + "01234567"
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory) / "stage"
            stage.mkdir()
            output = Path(directory) / "release-sha"
            output.write_text("previous\n")
            command = publish.replace("/opt/trackmyrmc/DEPLOYED_RELEASE_SHA", shlex.quote(str(output)))
            subprocess.run(["bash", "-ec", f"{writer}\n{command}"], check=True, capture_output=True,
                           env={**os.environ, "RELEASE_SHA": sha, "RELEASE_STAGE": str(stage)})
            self.assertEqual(output.read_bytes(), sha.encode() + b"\n")
            self.assertEqual(output.read_text().strip(), sha)


if __name__ == "__main__":
    unittest.main()
