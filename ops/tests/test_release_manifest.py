"""Exercise the installer's actual release-marker writer in a temporary path."""
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest


class ReleaseIdentityTests(unittest.TestCase):
    def test_installed_marker_is_exact_sha_and_line_feed(self):
        script = Path(__file__).resolve().parents[1] / "aws-deploy-ec2.sh"
        writers = [line for line in script.read_text().splitlines()
                   if line.startswith("printf ") and "> /opt/trackmyrmc/DEPLOYED_RELEASE_SHA" in line]
        self.assertEqual(len(writers), 1)
        sha = "0123456789abcdef" * 2 + "01234567"
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "release-sha"
            command = writers[0].replace("/opt/trackmyrmc/DEPLOYED_RELEASE_SHA", shlex.quote(str(output)))
            subprocess.run(["bash", "-c", command], check=True, capture_output=True,
                           env={**os.environ, "RELEASE_SHA":sha})
            self.assertEqual(output.read_bytes(), sha.encode() + b"\n")
            self.assertEqual(output.read_text().strip(), sha)


if __name__ == "__main__":
    unittest.main()
