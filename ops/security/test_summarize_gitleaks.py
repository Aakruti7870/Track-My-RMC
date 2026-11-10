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

    def test_private_categories_are_bounded(self):
        marker = "TOP_SECRET"
        sample = [
            {"File": "/tmp/run/.github/workflows/ci.yml", "Secret": marker},
            {"File": "frontend/google-services.json", "Secret": marker},
            {"File": "backend/src/routes/auth.rs", "Secret": marker},
            {"File": "ops/staging/foundation.json", "Secret": marker},
            {"File": "other/private-location.log", "Secret": marker},
        ]
        counts = module.count_categories(sample)
        self.assertEqual(sum(counts.values()), 5)
        self.assertEqual(counts["ci-workflow"], 1)
        self.assertEqual(counts["firebase-public-config"], 1)
        self.assertEqual(counts["source-code"], 1)
        self.assertEqual(counts["operations"], 1)
        self.assertEqual(counts["other-unclassified"], 1)
        self.assertNotIn(marker, str(counts))
        self.assertNotIn("private-location", str(counts))

    def test_review_buckets_never_emit_untrusted_path(self):
        marker = "PRIVATE_PATH_UNSAFE"
        sample=[{"File": "/tmp/" + marker + "/ops/more.py","Secret": marker}]
        labels=module.count_review_buckets(sample)
        self.assertEqual(dict(labels), {"other-operations": 1})
        self.assertNotIn(marker, str(labels))

    def test_known_diagnostic_groups_preserve_privacy(self):
        testcases = [
            ("docs/payments/RMC_PREPAID_PLAY_COMPLIANCE_AND_ROLLOUT.md", "payment-policy-document"),
            ("ops/staging/evidence/iam-isolation-simulation.json", "iam-simulation-record"),
            ("backend/tests/single_session_staff_slot_tests.rs", "session-test-fixture"),
            ("backend/examples/mobile_browser_fixture.rs", "browser-demo-fixture"),
        ]
        for file, expected in testcases:
            labels = module.count_review_buckets([{"File": file, "Secret": "REDACTED"}])
            self.assertEqual(dict(labels), {expected: 1})

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
