#!/usr/bin/env python3
"""Exercise the real bootstrap executable using private synthetic PTYs.

Only a loopback database named trackmyrmc_bootstrap_test is accepted. Apply
migrations to that disposable database first. Never use a production tunnel.
Captured provisioning secrets are held in memory and never printed or saved.
"""
import base64
import fcntl
import hashlib
import hmac
import os
from pathlib import Path
import pty
import re
import select
import struct
import subprocess
import termios
import time
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / "target/debug/examples/bootstrap_central_admin"
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


def code_for(secret):
    counter = struct.pack(">Q", int(time.time()) // 30)
    digest = hmac.new(base64.b32decode(secret), counter, hashlib.sha1).digest()
    offset = digest[-1] & 15
    return str((struct.unpack(">I", digest[offset:offset+4])[0] & 0x7fffffff) % 1000000).zfill(6)


def prepare(expected=DATABASE):
    return subprocess.run([str(BACKEND), "--prepare-primary-central-admin", expected],
                          capture_output=True, timeout=15).returncode


def run(*, expected=DATABASE, email=PRIMARY_EMAIL, apply=True, wrong_password=False,
        wrong_totp=False, ci=False):
    master, slave = pty.openpty()

    def terminal():
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)

    env = dict(os.environ)
    env.pop("CI", None)
    env.pop("GITHUB_ACTIONS", None)
    if ci:
        env["CI"] = "true"
    args = [str(BINARY), "--expected-database", expected,
            "--email", email, "--name", "Synthetic Bootstrap"]
    if apply:
        args.append("--apply")
    proc = subprocess.Popen(args, stdin=slave, stdout=slave, stderr=slave,
                            env=env, preexec_fn=terminal, close_fds=True)
    os.close(slave)
    output = ""
    handled = set()
    deadline = time.monotonic() + 20
    while proc.poll() is None and time.monotonic() < deadline:
        readable, _, _ = select.select([master], [], [], 0.1)
        if readable:
            try:
                output += os.read(master, 65536).decode(errors="replace")
            except OSError:
                break
        for prompt in ("New Central Admin password (16-128 bytes):", "Confirm Central Admin password:",
                       "Enter a current six-digit authenticator code:"):
            if prompt not in output or prompt in handled:
                continue
            handled.add(prompt)
            answer = "Synthetic-Bootstrap-Only-Password-2026!"
            if prompt.startswith("Confirm") and wrong_password:
                answer = "A-different-synthetic-password!"
            if prompt.startswith("Enter"):
                match = re.search(r"secret=([A-Z2-7]+)", output)
                if not match:
                    proc.kill()
                    raise RuntimeError("Provisioning did not produce a synthetic secret")
                answer = "invalid" if wrong_totp else code_for(match.group(1))
            os.write(master, (answer + "\n").encode())
    if proc.poll() is None:
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            raise RuntimeError("Synthetic bootstrap timed out") from None
    os.close(master)
    # Never return or print the captured secrets, including on failure.
    return proc.returncode


# Historical migrations contain disabled customer/owner/driver reviewer fixtures.
# They must remain untouched; no privileged fixture or target email may exist.
baseline_users = sql("SELECT count(*) FROM users")
if sql(f"SELECT count(*) FROM users WHERE role IN ('central_admin','authority') OR email='{PRIMARY_EMAIL}'") != "0":
    raise SystemExit("Bootstrap fixture database already has privileged identities or the test email")
assert run() != 0, "Enrollment must require the prepared identity"
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

assert run(apply=False) != 0, "Missing explicit apply must fail"
assert run(ci=True) != 0, "CI must fail even with a PTY"
assert run(expected="wrong_test_database") != 0, "Wrong database must fail"
assert run(email="other@example.invalid") != 0, "Only the reserved email can enroll"
assert run(wrong_password=True) != 0, "Password mismatch must fail"
assert run(wrong_totp=True) != 0, "Missing possession proof must fail"
assert sql("SELECT count(*) FROM control_center_access") == "0", "Failures must not grant access"
assert sql("SELECT count(*) FROM user_totp_credentials") == "0", "Failures must not install credentials"
assert run() == 0, "Approved synthetic first bootstrap must succeed"
assert sql("SELECT id FROM users WHERE role='central_admin' AND is_active AND is_verified AND hashed_password LIKE '$argon2id$%'") == primary_id
assert sql("SELECT count(*) FROM control_center_access WHERE approved AND 'admin_access.manage'=ANY(permissions)") == "1"
assert sql("SELECT count(*) FROM user_totp_credentials WHERE is_enabled AND cardinality(backup_codes)=8 AND last_login_totp_step IS NOT NULL") == "1"
assert sql("SELECT count(*) FROM user_totp_credentials t WHERE NOT EXISTS(SELECT 1 FROM unnest(t.backup_codes) c WHERE c !~ '^[0-9a-f]{64}$')") == "1", "Recovery codes must be hashes"
assert sql("SELECT count(*) FROM audit_logs WHERE action='control_center.bootstrap.first_admin'") == "1"
assert sql("SELECT count(*) FROM control_center_sessions") == "0", "Bootstrap must not issue a session"
assert run() != 0, "A second bootstrap must never overwrite the first identity"
assert prepare() == 0, "Redeploying must preserve the enrolled account"
assert sql("SELECT count(*) FROM users WHERE role='central_admin'") == "1"
print("PASS: preparation reserves one inactive primary account; private enrollment requires password and TOTP; conflicts, retries, audit, and credential storage verified")
