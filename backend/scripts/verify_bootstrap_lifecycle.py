#!/usr/bin/env python3
"""Exercise production reservation against disposable PostgreSQL.

Only a loopback database named trackmyrmc_bootstrap_test is accepted. Apply
migrations to that disposable database first. Never use a production tunnel.
"""
import os
from pathlib import Path
import subprocess
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "target/debug/trackmyrmc-backend"
DATABASE = "trackmyrmc_bootstrap_test"
PRIMARY_EMAIL = "support@trackmyrmc.com"
URL = urlparse(os.environ["DATABASE_URL"])
if URL.hostname not in ("127.0.0.1", "localhost", "::1") or URL.path != "/" + DATABASE:
    raise SystemExit("Requires the isolated loopback bootstrap test database")
PG_ENV = dict(os.environ, PGHOST=URL.hostname, PGPORT=str(URL.port or 5432),
              PGUSER=unquote(URL.username or ""), PGPASSWORD=unquote(URL.password or ""),
              PGDATABASE=DATABASE)


def sql(statement):
    result = subprocess.run(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-Atc", statement],
                            env=PG_ENV, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("Synthetic bootstrap database assertion failed")
    return result.stdout.strip()


def prepare(expected=DATABASE):
    return subprocess.run([str(BACKEND), "--prepare-primary-central-admin", expected],
                          capture_output=True, timeout=15).returncode


# Historical migrations contain disabled customer/owner/driver reviewer fixtures.
# They must remain untouched; no privileged fixture or target email may exist.
baseline_users = sql("SELECT count(*) FROM users")
if sql(f"SELECT count(*) FROM users WHERE role IN ('central_admin','authority') OR email='{PRIMARY_EMAIL}'") != "0":
    raise SystemExit("Bootstrap fixture database already has privileged identities or the test email")
assert prepare("wrong_test_database") != 0, "Preparation must verify the database"
assert sql("SELECT count(*) FROM users") == baseline_users
sql(f"INSERT INTO users(phone,email,hashed_password,full_name,role) VALUES(NULL,'{PRIMARY_EMAIL}','unused','Synthetic Customer','customer')")
assert prepare() != 0, "Preparation must not promote an existing user"
assert sql(f"SELECT role FROM users WHERE email='{PRIMARY_EMAIL}'") == "customer"
sql(f"DELETE FROM users WHERE email='{PRIMARY_EMAIL}'")
sql("INSERT INTO users(phone,email,hashed_password,full_name,role) VALUES(NULL,'other@example.invalid','unused','Synthetic Admin','central_admin')")
assert prepare() != 0, "Preparation must preserve an existing Central Admin"
assert sql("SELECT count(*) FROM users WHERE role='central_admin' AND email='other@example.invalid'") == "1"
sql("DELETE FROM users WHERE email='other@example.invalid'")

assert prepare() == 0, "Deployment preparation must succeed without a terminal"
assert prepare() == 0, "Preparation must be idempotent"
primary_id = sql(f"SELECT id FROM users WHERE role='central_admin' AND email='{PRIMARY_EMAIL}' AND NOT is_active AND NOT is_verified")
assert primary_id, "Preparation must reserve the inactive primary identity"
assert sql("SELECT count(*) FROM audit_logs WHERE action='control_center.bootstrap.prepare_primary'") == "1"
assert sql("SELECT count(*) FROM control_center_access") == "0"
assert sql("SELECT count(*) FROM user_totp_credentials") == "0"

print("PASS: preparation reserves one inactive primary account without credentials or permissions; database target, collisions and retries verified")
