#!/usr/bin/env python3
"""RustSec full-lockfile gate with one transparent, feature-proven optional finding.

This does not pass --ignore to cargo-audit: all advisories are collected and
reported. Only RUSTSEC-2023-0071 in optional rsa 0.9.10 may be classified
as an unselected-code-graph risk, if independently checked against the exact
production feature tree. Any other vulnerability or selected RSA is BLOCKED.
The release itself still requires independent operator approval.
"""
import json
import os
import re
import sys
from pathlib import Path

if len(sys.argv) != 4:
    raise SystemExit("Usage: assess-cargo-audit.py <cargo-audit.json> <selected-cargo-tree.txt> <audit-stderr.txt>")
try:
    raw = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    tree = Path(sys.argv[2]).read_text(encoding="utf-8")
    diagnostics = Path(sys.argv[3]).read_text(encoding="utf-8")
except (OSError, ValueError) as exc:
    raise SystemExit(f"BLOCKED: missing/invalid RustSec or production dependency-tree data: {exc}")
v = raw.get("vulnerabilities")
if not isinstance(v, dict) or not isinstance(v.get("list"), list):
    raise SystemExit("BLOCKED: RustSec audit returned incomplete vulnerability data")
if "trackmyrmc-backend v" not in tree or "sqlx-postgres v" not in tree:
    raise SystemExit("BLOCKED: dependency tree does not establish the PostgreSQL application target")
selected_rsa = bool(re.search(r"(?m)^rsa v", tree))
selected_mysql = bool(re.search(r"(?m)^sqlx-mysql v", tree))
if selected_rsa:
    raise SystemExit("BLOCKED: any RSA version selected in production dependency graph")
if selected_mysql:
    raise SystemExit("BLOCKED: SQLx MySQL feature unexpectedly selected in production dependency graph")
# A partially failed crates.io yanked-index lookup can leave valid audit JSON.
# Reject any RustSec diagnostic output; never treat missing yanked warnings as proof.
if diagnostics.strip():
    raise SystemExit("BLOCKED: RustSec emitted stderr diagnostics; investigate index/lookup completeness")
findings = []
unselected_optional = []
for item in v["list"]:
    advisory = item.get("advisory", {})
    package = item.get("package", {})
    finding = {
        "id": advisory.get("id", "unknown"),
        "crate": package.get("name", "unknown"),
        "version": package.get("version", "unknown"),
        "url": advisory.get("url"),
    }
    findings.append(finding)
    if (
        finding["id"] == "RUSTSEC-2023-0071"
        and finding["crate"] == "rsa"
        and finding["version"] == "0.9.10"
        and not selected_rsa
    ):
        unselected_optional.append(finding)
active = [f for f in findings if f not in unselected_optional]
warnings = raw.get("warnings", {})
warning_counts = {
    name: len(items) for name, items in warnings.items() if isinstance(items, list)
} if isinstance(warnings, dict) else {}
if warning_counts.get("yanked", 0) > 0:
    raise SystemExit("BLOCKED: Cargo.lock contains a yanked crate")
status = "BLOCKED" if active else ("PASS_WITH_DOCUMENTED_OPTIONAL_RISK" if findings else "PASS")
summary = {
    "status": status,
    "vulnerability_count_full_lock": len(findings),
    "all_findings": findings,
    "selected_production_graph_findings": active,
    "unselected_optional_risk_requiring_independent_release_approval": unselected_optional,
    "selected_rsa": selected_rsa,
    "selected_sqlx_mysql": selected_mysql,
    "warning_counts": warning_counts,
}
print(json.dumps(summary, sort_keys=True, indent=2))
path = os.environ.get("GITHUB_STEP_SUMMARY")
if path:
    with open(path, "a", encoding="utf-8") as handle:
        handle.write("## RustSec full Cargo.lock with selected-feature proof\n\n")
        handle.write(f"**{status}**. Full-lock vulnerabilities: {len(findings)}; "
                     f"selected-feature vulnerabilities: {len(active)}.\n\n")
        for finding in findings:
            handle.write("- " + finding["id"] + ": " + finding["crate"] +
                         " " + str(finding["version"]) +
                         (" (unselected, release risk acceptance required)" if finding in unselected_optional else " (BLOCKED)") + "\n")
        handle.write("\n")
if active:
    raise SystemExit(1)
