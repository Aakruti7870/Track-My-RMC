import pathlib
import tomllib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]

class GitleaksConfigTests(unittest.TestCase):
    def test_default_scanners_remain_enabled(self):
        cfg=tomllib.loads((ROOT / ".gitleaks.toml").read_text())
        self.assertEqual(cfg["extend"], {"useDefault": True})
        self.assertNotIn("allowlists", cfg, "No unconditional global exceptions")
        self.assertEqual({r["id"] for r in cfg["rules"]}, {"generic-api-key", "gcp-api-key"})
        for rule in cfg["rules"]:
            self.assertNotIn("regex", rule, "Do not override default secret detectors")
            for allow in rule["allowlists"]:
                self.assertEqual(allow["condition"], "AND")
                self.assertEqual(allow["regexTarget"], "line")
                self.assertTrue(allow["paths"] and allow["regexes"])
                self.assertTrue(all(s.startswith("'''") is False for s in allow["regexes"]))
    def test_history_exceptions_are_specific_findings(self):
        entries = [
            line for line in (ROOT / ".gitleaksignore").read_text().splitlines()
            if line and not line.startswith("#")
        ]
        self.assertEqual(len(entries), 8)
        self.assertEqual(len(set(entries)), len(entries))
        for fingerprint in entries:
            self.assertRegex(fingerprint, r"^[a-f0-9]{40}:[^:*?]+:generic-api-key:[1-9][0-9]*$")
        source = (ROOT / ".github/workflows/prelaunch-security.yml").read_text()
        self.assertEqual(source.count("--gitleaks-ignore-path"), 1)
        self.assertIn('cd "$RUNNER_TEMP/gitleaks-head"', source)

    def test_scans_use_config(self):
        source=(ROOT / ".github/workflows/prelaunch-security.yml").read_text()
        self.assertEqual(source.count('--config "$GITHUB_WORKSPACE/.gitleaks.toml"'), 2)
        self.assertIn('git .',source)
        self.assertIn('dir "$RUNNER_TEMP/gitleaks-head"',source)

if __name__ == "__main__":
    unittest.main()
