#!/usr/bin/env python3
"""Fail closed on RustSec advisories in full Cargo.lock.

The full lockfile can contain optional crates. Findings are not suppressed
automatically; a separate reviewed reachability/risk decision is required.
"""
import json
import os
import sys
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit("Usage: assess-cargo-audit.py <cargo-audit.json>")
try:
    raw = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
except (OSError, ValueError) as exc:
    raise SystemExit(f"BLOCKED: missing/invalid RustSec JSON: {exc}")
v = raw.get("vulnerabilities")
if not isinstance(v, dict) or not isinstance(v.get("list"), list):
    raise SystemExit("BLOCKED: RustSec audit returned incomplete vulnerability data")
findings = []
for item in v["list"]:
    advisory = item.get("advisory", {})
    package = item.get("package", {})
    findings.append({
        "id": advisory.get("id", "unknown"),
        "crate": package.get("name", "unknown"),
        "version": package.get("version", "unknown"),
        "url": advisory.get("url"),
    })
warnings = raw.get("warnings", {})
warning_counts = {name: len(items) for name, items in warnings.items()
                  if isinstance(items, list)} if isinstance(warnings, dict) else {}
summary = {"status": "BLOCKED" if findings else "PASS",
           "vulnerability_count": len(findings),
           "vulnerabilities": findings, "warning_counts": warning_counts}
print(json.dumps(summary, sort_keys=True, indent=2))
path = os.environ.get("GITHUB_STEP_SUMMARY")
if path:
    with open(path, "a", encoding="utf-8") as handle:
        handle.write("## RustSec full Cargo.lock\n\nResult: **" + summary["status"] +
                     "**. Vulnerabilities: " + str(len(findings)) +
                     "; warning groups: " + json.dumps(warning_counts) + ".\n\n")
        for finding in findings:
            handle.write("- " + finding["id"] + ": " + finding["crate"] +
                         " " + str(finding["version"]) + "\n")
        handle.write("\n")
if findings:
    raise SystemExit(1)
