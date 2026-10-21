"""Database audit safety regressions; never connect to production in CI."""
import hashlib
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / "release" / "database_audit.py"
spec = importlib.util.spec_from_file_location("database_audit", path)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class DatabaseAuditTests(unittest.TestCase):
    def test_cutover_uri_changes_database_only_and_validates_name(self):
        uri = "postgres://user:p%40ss@database:5432/postgres?sslmode=require"
        name, target = audit.database_uri(uri, "trackmyrmc")
        self.assertEqual(name, "postgres")
        self.assertEqual(target, uri.replace("/postgres?", "/trackmyrmc?"))
        for invalid in ("../postgres", "postgres;DROP TABLE users", "", "a/b"):
            with self.subTest(invalid=invalid), self.assertRaises(audit.AuditError):
                audit.database_uri(uri, invalid)

    def test_invalid_connection_error_contains_no_credentials(self):
        with self.assertRaises(audit.AuditError) as error:
            audit.database_uri("https://user:TOP_SECRET@database/postgres")
        self.assertNotIn("TOP_SECRET", str(error.exception))

    @patch.object(audit.subprocess, "run")
    def test_query_is_read_only_rollback_and_credentials_never_in_arguments(self, run):
        run.return_value = subprocess.CompletedProcess([], 0, '{"read_only":"on"}', "")
        uri = "postgres://user:TOP_SECRET@database/postgres"
        self.assertEqual(audit.query(uri, "SELECT 1")["read_only"], "on")
        args, kwargs = run.call_args
        self.assertNotIn("TOP_SECRET", str(args))
        self.assertEqual(kwargs["env"]["PGDATABASE"], "postgres")
        self.assertEqual(kwargs["env"]["PGHOST"], "database")
        self.assertEqual(kwargs["env"]["PGUSER"], "user")
        self.assertEqual(kwargs["env"]["PGPASSWORD"], "TOP_SECRET")
        self.assertEqual(kwargs["env"]["PGSSLMODE"], "require")
        self.assertIn("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;", kwargs["input"])
        self.assertTrue(kwargs["input"].endswith("ROLLBACK;\n"))
        self.assertIn("statement_timeout=15000", kwargs["env"]["PGOPTIONS"])

    @patch.object(audit.subprocess, "run")
    def test_psql_errors_are_redacted(self, run):
        run.return_value = subprocess.CompletedProcess([], 1, "", "password TOP_SECRET failed")
        with self.assertRaises(audit.AuditError) as error:
            audit.query("postgres://user:TOP_SECRET@host/postgres", "SELECT 1")
        self.assertNotIn("TOP_SECRET", str(error.exception))

    def test_migration_checksum_drift_failed_and_missing_versions_are_reported(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            (directory / "0001_initial.sql").write_bytes(b"CREATE TABLE example(id int);\n")
            (directory / "0002_next.sql").write_bytes(b"SELECT 1;\n")
            good = hashlib.sha384((directory / "0001_initial.sql").read_bytes()).hexdigest()
            rows = [{"version":1,"checksum":good,"success":True}]
            self.assertEqual(audit.migration_parity(rows, directory)["missing_versions"], [2])
            rows[0].update(checksum="wrong", success=False)
            rows.append({"version":99,"checksum":"unknown","success":True})
            result = audit.migration_parity(rows, directory)
            self.assertEqual(result["checksum_mismatch_versions"], [1])
            self.assertEqual(result["failed_versions"], [1])
            self.assertEqual(result["unknown_versions"], [99])

    def test_composite_foreign_key_audit_quotes_identifiers_and_excludes_null_keys(self):
        sql = audit.count_sql({"tables":["odd\"table"], "foreign_keys":[{
            "name":"link", "table":"odd\"table", "target_schema":"public", "target":"parent",
            "columns":[["plant_id","plant_id"],["user_id","id"]]}]})
        self.assertIn('public."odd""table"', sql)
        self.assertIn('s."plant_id" IS NOT NULL AND s."user_id" IS NOT NULL', sql)
        self.assertIn('s."plant_id"=r."plant_id" AND s."user_id"=r."id"', sql)
        self.assertNotIn("SELECT *", sql)


if __name__ == "__main__":
    unittest.main()
