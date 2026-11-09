"""Offline tests for the PostgreSQL URI and preflight used by EC2 deployment."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, unquote, urlsplit

DEPLOY = Path(__file__).resolve().parents[1] / "aws-deploy-ec2.sh"


class PostgresUriBuilderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        content = DEPLOY.read_text(encoding="utf-8")
        # Execute the Python command actually shipped in the SSM deployment script.
        match = re.search(
            r"""TRACKMYRMC_DB_NAME="\$DB_NAME" python3 -c '([^']*)'""",
            content,
            flags=re.DOTALL,
        )
        if match is None:
            raise AssertionError("Deployment PostgreSQL URI builder was not found")
        cls.builder = match.group(1)
        preflight = re.search(
            r"""TRACKMYRMC_EXPECTED_DB_NAME="\$DB_NAME" python3 - <<'PY'\n(.*?)\nPY""",
            content,
            flags=re.DOTALL,
        )
        if preflight is None:
            raise AssertionError("Deployment PostgreSQL preflight was not found")
        cls.preflight = compile(preflight.group(1), str(DEPLOY), "exec")

    def make_uri(self, db_name="postgres", username="trackmyrmc_admin", password="synthetic"):
        result = subprocess.run(
            [sys.executable, "-c", self.builder],
            input=json.dumps({"username": username, "password": password}),
            env={**os.environ, "TRACKMYRMC_DB_NAME": db_name},
            capture_output=True,
            text=True,
            check=True,
        )
        return urlsplit(result.stdout.strip())

    def test_percent_encoded_certificate_path_and_verified_tls(self):
        parsed = self.make_uri()
        self.assertEqual(parsed.scheme, "postgres")
        self.assertEqual(parsed.hostname, "trackmyrmc-postgres.cf8mmcwuuinx.ap-south-1.rds.amazonaws.com")
        self.assertEqual(parsed.port, 5432)
        self.assertEqual(parsed.path, "/postgres")
        self.assertEqual(parse_qs(parsed.query, keep_blank_values=True), {
            "sslmode": ["verify-full"],
            "sslrootcert": ["/etc/trackmyrmc/rds-ca-bundle.pem"],
        })
        self.assertIn("%2Fetc%2Ftrackmyrmc%2Frds-ca-bundle.pem", parsed.query)

    def test_existing_and_configured_database_names_are_distinct(self):
        for name in ("postgres", "trackmyrmc"):
            with self.subTest(database=name):
                self.assertEqual(self.make_uri(db_name=name).path, f"/{name}")

    def test_reserved_characters_in_credentials_are_encoded_once(self):
        username = "test+user@example"
        password = "pass%word:@#/ ?'\\\""
        parsed = self.make_uri(username=username, password=password)
        self.assertEqual(unquote(parsed.username), username)
        self.assertEqual(unquote(parsed.password), password)
        self.assertNotIn("pass%word", parsed.geturl())
        self.assertEqual(parsed.path, "/postgres")
        self.assertFalse(parsed.fragment)

    def test_preflight_uses_verified_tls_without_inheriting_libpq_settings(self):
        uri = self.make_uri(password="test%pass:@/")
        environment = {
            "PATH": "/usr/bin",
            "PGSERVICE": "untrusted-service",
            "PGSERVICEFILE": "/tmp/untrusted-service.conf",
            "PGHOSTADDR": "127.0.0.1",
            "PGSSLMODE": "disable",
            "TRACKMYRMC_DATABASE_URL": uri.geturl(),
            "TRACKMYRMC_EXPECTED_DB_NAME": "postgres",
        }
        probe = subprocess.CompletedProcess([], 0, stdout="1\n", stderr="")
        with (
            patch.dict(os.environ, environment, clear=True),
            patch("os.path.isfile", return_value=True),
            patch("subprocess.run", return_value=probe) as run,
        ):
            exec(self.preflight, {})

        command = run.call_args.args[0]
        self.assertEqual(command[-2:], ["-c", "SELECT 1"])
        self.assertNotIn(uri.geturl(), command)
        self.assertEqual(run.call_args.kwargs["env"], {
            "PATH": "/usr/bin",
            "PGHOST": uri.hostname,
            "PGPORT": "5432",
            "PGDATABASE": "postgres",
            "PGUSER": "trackmyrmc_admin",
            "PGPASSWORD": "test%pass:@/",
            "PGSSLMODE": "verify-full",
            "PGSSLROOTCERT": "/etc/trackmyrmc/rds-ca-bundle.pem",
            "PGCONNECT_TIMEOUT": "8",
            "PGOPTIONS": "-c default_transaction_read_only=on -c statement_timeout=5000",
        })


if __name__ == "__main__":
    unittest.main()
