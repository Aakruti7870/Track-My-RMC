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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=Path)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--count", action="store_true")
    mode.add_argument("--rules-only", action="store_true")
    args = parser.parse_args()
    with args.report.open(encoding="utf-8") as handle:
        total, rules = summarize(json.load(handle))
    if args.count:
        print(total)
    else:
        print("Gitleaks sanitized detector counts: " +
              ", ".join(f"{name}={rules[name]}" for name in sorted(rules)))
        # Never print File, Commit, Secret, Match, Fingerprint or untrusted scanner logs.


if __name__ == "__main__":
    main()
