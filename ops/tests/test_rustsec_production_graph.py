"""Contract tests for explicit RustSec selected-feature risk classification.

These tests must not import live AWS, use credentials or suppress RustSec findings.
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

CHECKER = Path(__file__).resolve().parents[1] / "security" / "assess-cargo-audit.py"
TREE = "trackmyrmc-backend v1.0.0 (/test/backend)\nsqlx-postgres v0.8.6\n"


def fixture(id="RUSTSEC-2023-0071", crate="rsa", version="0.9.10", warnings=None):
    return {
        "vulnerabilities": {
            "list": [{"advisory": {"id": id}, "package": {"name": crate, "version": version}}]
        },
        "warnings": warnings or {},
    }


class RustSecGateTests(unittest.TestCase):
    def check(self, data, tree=TREE, diagnostics=""):
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / "audit.json"
            graph = Path(tmp) / "tree.txt"
            stderr = Path(tmp) / "audit-stderr.txt"
            report.write_text(json.dumps(data), encoding="utf-8")
            graph.write_text(tree, encoding="utf-8")
            stderr.write_text(diagnostics, encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(CHECKER), str(report), str(graph), str(stderr)],
                capture_output=True, text=True, check=False,
            )

    def test_full_lock_rsa_is_reported_not_hidden_when_unselected(self):
        output = self.check(fixture())
        self.assertEqual(output.returncode, 0, output.stderr)
        self.assertIn("PASS_WITH_DOCUMENTED_OPTIONAL_RISK", output.stdout)
        self.assertIn("RUSTSEC-2023-0071", output.stdout)
        self.assertIn("independent_release_approval", output.stdout)

    def test_selected_rsa_blocks(self):
        self.assertNotEqual(self.check(fixture(), TREE + "rsa v0.9.10\n").returncode, 0)

    def test_selected_other_rsa_versions_also_block(self):
        self.assertNotEqual(self.check(fixture(), TREE + "rsa v0.10.0\n").returncode, 0)

    def test_any_selected_rsa_blocks_even_without_vulnerability_entry(self):
        self.assertNotEqual(
            self.check({"vulnerabilities": {"list": []}, "warnings": {}}, TREE + "rsa v0.9.10\n").returncode, 0
        )

    def test_partial_yanked_index_lookup_diagnostics_block(self):
        self.assertNotEqual(
            self.check(fixture(), diagnostics="ERROR failed to inspect crates.io index\n").returncode, 0
        )

    def test_selected_mysql_blocks_even_if_rsa_unselected(self):
        self.assertNotEqual(self.check(fixture(), TREE + "sqlx-mysql v0.8.6\n").returncode, 0)

    def test_any_other_advisory_blocks(self):
        self.assertNotEqual(
            self.check(fixture("RUSTSEC-2026-0384", "tokio", "1.54.0")).returncode, 0
        )

    def test_malformed_graph_blocks(self):
        self.assertNotEqual(self.check(fixture(), "irrelevant v0.1\n").returncode, 0)

    def test_yanked_version_blocks(self):
        self.assertNotEqual(
            self.check(fixture(warnings={"yanked": [{"name": "test"}]})).returncode, 0
        )

    def test_missing_audit_data_blocks(self):
        self.assertNotEqual(self.check({"vulnerabilities": {}}).returncode, 0)


if __name__ == "__main__":
    unittest.main()
