import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).with_name("summarize_gitleaks.py")
spec = importlib.util.spec_from_file_location("summarize_gitleaks", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SummaryTests(unittest.TestCase):
    def test_rules_only_counts_no_evidence(self):
        marker = "-".join(["CONFIDENTIAL", "MUST", "NOT", "APPEAR"])
        report = [{"RuleID": "generic-api-key", "File": "internal/location",
                   "Secret": marker, "Match": marker, "Commit": "private-ref"},
                  {"RuleID": "generic-api-key", "Secret": marker}]
        total, rules = module.summarize(report)
        self.assertEqual(total, 2)
        self.assertEqual(dict(rules), {"generic-api-key": 2})
        self.assertNotIn(marker, str(rules))
        self.assertNotIn("internal/location", str(rules))

    def test_rejects_malformed_report(self):
        with self.assertRaises(ValueError):
            module.summarize({"not": "a list"})
        with self.assertRaises(ValueError):
            module.summarize([None])

    def test_rule_id_is_sanitized(self):
        total, rules = module.summarize([{"RuleID": "safe\n::error::value"}])
        self.assertEqual(total, 1)
        self.assertTrue(all("\n" not in key and ":" not in key for key in rules))


if __name__ == "__main__":
    unittest.main()
