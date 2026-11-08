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
DATABASE = "trackmyrmc_bootstrap_test"
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


def run(*, expected=DATABASE, apply=True, wrong_password=False, wrong_totp=False, ci=False):
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
            "--email", "bootstrap-fixture@example.invalid", "--name", "Synthetic Bootstrap"]
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
if sql("SELECT count(*) FROM users WHERE role IN ('central_admin','authority') OR email='bootstrap-fixture@example.invalid'") != "0":
    raise SystemExit("Bootstrap fixture database already has privileged identities or the test email")
assert run(apply=False) != 0, "Missing explicit apply must fail"
assert run(ci=True) != 0, "CI must fail even with a PTY"
assert run(expected="wrong_test_database") != 0, "Wrong database must fail"
assert run(wrong_password=True) != 0, "Password mismatch must fail"
assert run(wrong_totp=True) != 0, "Missing possession proof must fail"
assert sql("SELECT count(*) FROM users") == baseline_users, "Failures must not create identities"
# Collision checks happen before provisioning, and cannot promote an ordinary identity.
sql("INSERT INTO users(phone,email,hashed_password,full_name,role) VALUES(NULL,'bootstrap-fixture@example.invalid','unused','Synthetic Customer','customer')")
assert run() != 0, "Existing customer identity must never be promoted"
assert sql("SELECT role FROM users WHERE email='bootstrap-fixture@example.invalid'") == "customer"
sql("DELETE FROM users WHERE email='bootstrap-fixture@example.invalid'")
assert run() == 0, "Approved synthetic first bootstrap must succeed"
assert sql("SELECT count(*) FROM users WHERE role='central_admin' AND hashed_password LIKE '$argon2id$%'") == "1"
assert sql("SELECT count(*) FROM user_totp_credentials WHERE is_enabled AND cardinality(backup_codes)=8 AND last_login_totp_step IS NOT NULL") == "1"
assert sql("SELECT count(*) FROM user_totp_credentials t WHERE NOT EXISTS(SELECT 1 FROM unnest(t.backup_codes) c WHERE c !~ '^[0-9a-f]{64}$')") == "1", "Recovery codes must be hashes"
assert sql("SELECT count(*) FROM audit_logs WHERE action='control_center.bootstrap.first_admin'") == "1"
assert sql("SELECT count(*) FROM control_center_sessions") == "0", "Bootstrap must not issue a session"
assert run() != 0, "A second bootstrap must never overwrite the first identity"
assert sql("SELECT count(*) FROM users WHERE role='central_admin'") == "1"
print("PASS: bootstrap requires explicit apply, non-CI terminal, exact database, matching password and TOTP; failures roll back; duplicate bootstrap and promotion denied; audit and hashed recovery records verified")
