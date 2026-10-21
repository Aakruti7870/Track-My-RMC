#!/usr/bin/env python3
"""Fail-closed read-only assessment of TrackMyRMC production recovery readiness.

RDS DBName is the *initial* database and does not identify the database currently
used by EC2. --runtime-db must come from the live process configuration.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys

DEFAULT_INSTANCE = "trackmyrmc-postgres"
DEFAULT_EXPECTED_DB = "trackmyrmc"

def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def date_utc(raw):
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return value.astimezone(timezone.utc) if value.tzinfo else None
    except ValueError:
        return None

def evaluate(rds, snapshots, runtime_db=None, evidence=None, instance=DEFAULT_INSTANCE,
             expected_db=DEFAULT_EXPECTED_DB, clock=None):
    clock = clock or datetime.now(timezone.utc)
    checks = []
    def add(name, ok, detail):
        checks.append({"gate": name, "passed": bool(ok), "detail": detail})

    candidates = [d for d in rds.get("DBInstances", [])
                  if d.get("DBInstanceIdentifier") == instance]
    db = candidates[0] if len(candidates) == 1 else {}
    add("exact_rds_instance", len(candidates) == 1, "Exactly one expected RDS instance")
    add("rds_available", db.get("DBInstanceStatus") == "available", "RDS available")
    add("rds_encrypted", db.get("StorageEncrypted") is True, "RDS storage encrypted")
    add("rds_deletion_protected", db.get("DeletionProtection") is True,
        "RDS deletion protection enabled")
    days = db.get("BackupRetentionPeriod")
    add("automated_backup_retention", type(days) is int and days >= 7,
        "At least seven days of automated backup retention")
    point = date_utc(db.get("LatestRestorableTime"))
    add("recent_point_in_time_restore", point is not None and
        timedelta(0) <= clock - point <= timedelta(hours=48),
        "Recent point-in-time restore timestamp")

    candidates = [s for s in snapshots.get("DBSnapshots", [])
                  if s.get("DBInstanceIdentifier") == instance and
                  s.get("SnapshotType") == "manual" and
                  s.get("Status") == "available" and s.get("Encrypted") is True and
                  date_utc(s.get("SnapshotCreateTime")) is not None and
                  timedelta(0) <= clock - date_utc(s["SnapshotCreateTime"]) <= timedelta(days=7)]
    add("recent_encrypted_manual_snapshot", bool(candidates),
        "Available encrypted manual snapshot taken in last seven days")
    add("runtime_database_parity", isinstance(runtime_db, str) and runtime_db == expected_db,
        "Verified EC2 runtime database must match expected database; never auto-cutover")

    verified = False
    if isinstance(evidence, dict):
        snapshot_ids = {s["DBSnapshotIdentifier"] for s in candidates}
        timestamp = date_utc(evidence.get("verified_at"))
        flags = evidence.get("checks")
        flags = flags if isinstance(flags, dict) else {}
        verified = (evidence.get("source_instance") == instance and
                    evidence.get("snapshot_id") in snapshot_ids and
                    bool(evidence.get("restored_instance")) and
                    evidence.get("restored_instance") != instance and
                    isinstance(evidence.get("verified_by"), str) and
                    bool(evidence["verified_by"].strip()) and
                    timestamp is not None and timedelta(0) <= clock - timestamp <= timedelta(days=7)
                    and all(flags.get(key) is True for key in (
                        "restored_instance_healthy", "schema_migration_parity",
                        "sampled_data_parity", "application_read_only_smoke",
                        "application_rollback_rehearsed")))
    add("isolated_restore_and_rollback_rehearsal", verified,
        "Approved and recent isolated restore, data/schema checks and rollback evidence")
    return {"ready": all(c["passed"] for c in checks), "checks": checks,
            "evaluated_at": clock.isoformat(), "instance": instance}

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rds-json", type=Path, required=True)
    parser.add_argument("--snapshots-json", type=Path, required=True)
    parser.add_argument("--runtime-db", help="Name from verified EC2 runtime, not RDS DBName")
    parser.add_argument("--restore-evidence", type=Path)
    parser.add_argument("--instance", default=DEFAULT_INSTANCE)
    parser.add_argument("--expected-db", default=DEFAULT_EXPECTED_DB)
    parser.add_argument("--format", choices=("text", "json"), default="text")
    parser.add_argument("--inventory-only", action="store_true",
                        help="Show findings without blocking; never grants launch approval")
    args = parser.parse_args(argv)
    try:
        report = evaluate(read_json(args.rds_json), read_json(args.snapshots_json),
                          runtime_db=args.runtime_db,
                          evidence=read_json(args.restore_evidence) if args.restore_evidence else None,
                          instance=args.instance, expected_db=args.expected_db)
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as e:
        print(f"Cannot evaluate recovery evidence: {type(e).__name__}", file=sys.stderr)
        return 2
    if args.format == "json":
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        for check in report["checks"]:
            print(f"{'PASS' if check['passed'] else 'BLOCK'} {check['gate']}: {check['detail']}")
        print("RECOVERY READY" if report["ready"] else "LAUNCH BLOCKED: recovery evidence incomplete")
    return 0 if report["ready"] or args.inventory_only else 1

if __name__ == "__main__":
    raise SystemExit(main())
