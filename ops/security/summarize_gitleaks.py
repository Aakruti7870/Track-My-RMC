#!/usr/bin/env python3
"""Print only safe aggregate Gitleaks counts; never leak matching content or paths."""
import argparse
import collections
import json
import re
from pathlib import Path


def summarize(report):
    if not isinstance(report, list):
        raise ValueError("Gitleaks report must be a JSON array")
    counts = collections.Counter()
    for finding in report:
        if not isinstance(finding, dict):
            raise ValueError("Malformed Gitleaks finding")
        raw = str(finding.get("RuleID", "unknown"))
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", raw)[:64] or "unknown"
        counts[safe] += 1
    return len(report), counts


def categorize_finding(finding):
    """Bucket locations without revealing original filenames or arbitrary text."""
    path = str(finding.get("File", "")).replace("\\\\", "/").lower()
    if "/.github/workflows/" in "/" + path or path.startswith(".github/workflows/"):
        return "ci-workflow"
    if "/google-services.json" in "/" + path:
        return "firebase-public-config"
    if path.endswith(".env.example"):
        return "environment-example"
    if "/tests/" in "/" + path or "/fixtures/" in "/" + path:
        return "test-fixture"
    if "/docs/" in "/" + path or path.startswith("docs/"):
        return "documentation"
    if "/ops/" in "/" + path or path.startswith("ops/"):
        return "operations"
    if "/src/" in "/" + path or path.startswith("src/"):
        return "source-code"
    return "other-unclassified"


def count_categories(report):
    if not isinstance(report, list) or any(not isinstance(x, dict) for x in report):
        raise ValueError("Malformed Gitleaks report")
    return collections.Counter(categorize_finding(finding) for finding in report)


def count_review_buckets(report):
    """Print aggregate fixed categories only; never expose paths or credential values."""
    if not isinstance(report, list) or any(not isinstance(x, dict) for x in report):
        raise ValueError("Malformed Gitleaks report")
    counts = collections.Counter()
    for finding in report:
        path = "/" + str(finding.get("File", "")).replace("\\", "/").lower().lstrip("/")
        # Exact paths first. Broad categories come last; avoid shadowing.
        if path.endswith("/docs/api.md") or path == "docs/api.md":
            category = "documentation-demo-auth"
        elif path.endswith("/docs/cashfree_sandbox_integration_review.md"):
            category = "documentation-payment-request"
        elif path.endswith("/docs/payments/rmc_prepaid_play_compliance_and_rollout.md"):
            category = "payment-policy-document"
        elif path.endswith("/docs/kyc_sandbox_digilocker_integration.md"):
            category = "kyc-documentation"
        elif path.endswith("/frontend/google-services.json"):
            category = "firebase-client-json"
        elif path.endswith("/ops/staging/evidence/iam-isolation-simulation.json"):
            category = "iam-simulation-record"
        elif path.endswith("/ops/release/verify-digilocker-credentials.py"):
            category = "kyc-verifier-source"
        elif path.endswith("/backend/tests/single_session_staff_slot_tests.rs"):
            category = "session-test-fixture"
        elif path.endswith("/backend/tests/authority_web_security_tests.rs"):
            category = "authority-test-fixture"
        elif path.endswith("/backend/tests/parity_workflow_tests.rs"):
            category = "parity-test-fixture"
        elif path.endswith("/backend/examples/mobile_browser_fixture.rs"):
            category = "browser-demo-fixture"
        elif "/docs/security/" in "/" + path:
            category = "security-documentation"
        elif "/docs/release/" in "/" + path:
            category = "release-documentation"
        elif "/docs/" in "/" + path:
            category = "other-documentation"
        elif "/ops/staging/evidence/" in "/" + path:
            category = "other-staging-evidence"
        elif "/ops/release/" in "/" + path:
            category = "other-release-script"
        elif "/ops/" in "/" + path:
            category = "other-operations"
        elif "/backend/tests/" in "/" + path:
            category = "other-backend-test"
        elif "/tests/" in "/" + path or "/fixtures/" in "/" + path:
            category = "other-test-fixture"
        elif "/backend/migrations/" in "/" + path:
            category = "database-schema-example"
        elif "/frontend/scripts/" in "/" + path:
            category = "frontend-script"
        elif "/.github/workflows/" in "/" + path:
            category = "ci-fixture"
        elif "/backend/examples/" in "/" + path:
            category = "other-backend-example"
        else:
            category = "other-unclassified"
        counts[category] += 1
    return counts

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--count", action="store_true")
    mode.add_argument("--rules-only", action="store_true")
    mode.add_argument("--categories-only", action="store_true")
    mode.add_argument("--review-buckets", action="store_true")
    args = parser.parse_args()
    with args.report.open(encoding="utf-8") as handle:
        report = json.load(handle)
    total, rules = summarize(report)
    if args.count:
        print(total)
    elif args.review_buckets:
        labels = count_review_buckets(report)
        print("Gitleaks bounded review categories: " +
              ", ".join(f"{name}={labels[name]}" for name in sorted(labels)))
    elif args.categories_only:
        categories = count_categories(report)
        print("Gitleaks risk-triage source categories: " +
              ", ".join(f"{name}={categories[name]}" for name in sorted(categories)))
    else:
        print("Gitleaks sanitized detector counts: " +
              ", ".join(f"{name}={rules[name]}" for name in sorted(rules)))
        # Never print File, Commit, Secret, Match, Fingerprint or untrusted scanner logs.


if __name__ == "__main__":
    main()
