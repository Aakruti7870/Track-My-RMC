"""Isolated release gate tests; no AWS calls or production database access."""
import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest

p = Path(__file__).resolve().parents[1] / "release" / "recovery_gate.py"
spec = importlib.util.spec_from_file_location("recovery_gate", p)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
NOW = datetime(2026, 10, 21, 12, tzinfo=timezone.utc)

def fixture():
    rds = {"DBInstances": [{
        "DBInstanceIdentifier": "trackmyrmc-postgres", "DBName": "trackmyrmc",
        "DBInstanceStatus": "available", "StorageEncrypted": True,
        "DeletionProtection": True, "BackupRetentionPeriod": 7,
        "LatestRestorableTime": (NOW - timedelta(minutes=15)).isoformat()}]}
    snaps = {"DBSnapshots": [{
        "DBSnapshotIdentifier": "manual-restored", "DBInstanceIdentifier": "trackmyrmc-postgres",
        "Status": "available", "Encrypted": True, "SnapshotType": "manual",
        "SnapshotCreateTime": (NOW - timedelta(hours=2)).isoformat()}]}
    evidence = {"source_instance": "trackmyrmc-postgres", "snapshot_id": "manual-restored",
        "restored_instance": "isolated-restore-not-production", "verified_by": "reviewer",
        "verified_at": (NOW - timedelta(hours=1)).isoformat(), "checks": {
            "restored_instance_healthy": True, "schema_migration_parity": True,
            "sampled_data_parity": True, "application_read_only_smoke": True,
            "application_rollback_rehearsed": True}}
    return rds, snaps, evidence

class RecoveryGateTests(unittest.TestCase):
    def check(self, change=None, runtime="trackmyrmc", evidence_override=None):
        rds, snaps, evidence = fixture()
        if change:
            change(rds, snaps, evidence)
        return gate.evaluate(rds, snaps, runtime_db=runtime, clock=NOW,
                             evidence=evidence if evidence_override is None else evidence_override)

    def test_all_gates_can_pass_with_real_evidence(self):
        self.assertTrue(self.check()["ready"])

    def test_runtime_postgres_does_not_equal_expected_trackmyrmc(self):
        self.assertFalse(self.check(runtime="postgres")["ready"])

    def test_rds_initial_dbname_must_not_override_runtime(self):
        self.assertFalse(self.check(runtime="postgres")["ready"])

    def test_missing_runtime_db_blocks(self):
        self.assertFalse(self.check(runtime=None)["ready"])

    def test_missing_restore_proof_blocks(self):
        self.assertFalse(self.check(evidence_override={})["ready"])

    def test_rds_encryption_required(self):
        self.assertFalse(self.check(lambda r,s,e: r["DBInstances"][0].update(StorageEncrypted=False))["ready"])

    def test_rds_deletion_protection_required(self):
        self.assertFalse(self.check(lambda r,s,e: r["DBInstances"][0].update(DeletionProtection=False))["ready"])

    def test_backup_retention_required(self):
        self.assertFalse(self.check(lambda r,s,e: r["DBInstances"][0].update(BackupRetentionPeriod=0))["ready"])

    def test_old_manual_snapshot_blocks(self):
        self.assertFalse(self.check(lambda r,s,e: s["DBSnapshots"][0].update(
            SnapshotCreateTime=(NOW - timedelta(days=9)).isoformat()))["ready"])

    def test_unencrypted_snapshot_blocks(self):
        self.assertFalse(self.check(lambda r,s,e: s["DBSnapshots"][0].update(Encrypted=False))["ready"])

    def test_automated_snapshot_does_not_satisfy_manual_recovery_gate(self):
        self.assertFalse(self.check(lambda r,s,e: s["DBSnapshots"][0].update(SnapshotType="automated"))["ready"])

    def test_unknown_snapshot_type_blocks(self):
        self.assertFalse(self.check(lambda r,s,e: s["DBSnapshots"][0].pop("SnapshotType"))["ready"])

    def test_malformed_restore_checks_fail_closed(self):
        for invalid in (True, "all passed", [True], 1):
            with self.subTest(checks=invalid):
                self.assertFalse(self.check(lambda r,s,e: e.update(checks=invalid))["ready"])

    def test_no_isolated_restore_blocks(self):
        self.assertFalse(self.check(lambda r,s,e: e.update(
            restored_instance="trackmyrmc-postgres"))["ready"])

    def test_unrehearsed_rollback_blocks(self):
        self.assertFalse(self.check(lambda r,s,e: e["checks"].update(
            application_rollback_rehearsed=False))["ready"])

    def test_old_evidence_blocks(self):
        self.assertFalse(self.check(lambda r,s,e: e.update(
            verified_at=(NOW - timedelta(days=9)).isoformat()))["ready"])

    def test_no_current_point_in_time_restore_blocks(self):
        self.assertFalse(self.check(lambda r,s,e: r["DBInstances"][0].update(
            LatestRestorableTime=None))["ready"])

if __name__ == "__main__":
    unittest.main()
