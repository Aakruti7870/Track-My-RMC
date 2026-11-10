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
    """Bounded classifications only. Never print matching values or source paths."""
    if not isinstance(report, list) or any(not isinstance(x, dict) for x in report):
        raise ValueError("Malformed Gitleaks report")
    counts = collections.Counter()
    for finding in report:
        location = str(finding.get("File", "")).replace("\\", "/").lower()
        if location.endswith("/docs/api.md") or location == "docs/api.md":
            label = "documentation-demo-auth"
        elif location.endswith("/docs/cashfree_sandbox_integration_review.md"):
            label = "documentation-payment-request"
        elif location.endswith("/frontend/google-services.json"):
            label = "firebase-client-json"
        elif location.endswith("/ops/staging/evidence/iam-isolation-simulation.json"):
            label = "staging-iam-policy-artifact"
        elif "/ops/" in "/" + location:
            label = "other-operations"
        elif location.endswith("/backend/tests/single_session_staff_slot_tests.rs"):
            label = "session-test-fixture"
        elif "/tests/" in "/" + location or "/fixtures/" in "/" + location:
            label = "other-test-fixture"
        elif location.endswith("/backend/examples/mobile_browser_fixture.rs"):
            label = "browser-demo-fixture"
        elif "/.github/workflows/" in "/" + location:
            label = "ci-fixture"
        elif "/docs/" in "/" + location:
            label = "other-documentation"
        else:
            label = "other-unclassified"
        counts[label] += 1
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
