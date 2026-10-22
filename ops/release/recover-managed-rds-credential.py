#!/usr/bin/env python3
"""Fail-closed, local TrackMyRMC recovery after RDS-managed secret rotation.

This timer makes a local /health request without consulting AWS when healthy.
On a failure, it authenticates to the *existing database* with AWSCURRENT,
changes only DATABASE_URL in the installed root-owned environment file, and
restarts the backend. The previous environment is restored if health fails.
No connection URLs, secret values, subprocess stderr or HTTP bodies are logged.
"""

import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from urllib.parse import quote, unquote, urlsplit, urlunsplit
from urllib.request import urlopen

ENV_FILE = Path('/etc/trackmyrmc/app.env')
LOCK_FILE = Path('/run/lock/trackmyrmc-production.lock')
HEALTH_URL = 'http://127.0.0.1:8000/health'
RDS_HOST = 'trackmyrmc-postgres.cf8mmcwuuinx.ap-south-1.rds.amazonaws.com'
RDS_SECRET = 'arn:aws:secretsmanager:ap-south-1:260234292958:secret:rds!db-725487fe-ba11-4b7a-acdd-6c60010aa20f-CdtJlW'
SERVICE = 'trackmyrmc-backend.service'


def healthy():
    try:
        with urlopen(HEALTH_URL, timeout=5) as response:
            if response.status != 200:
                return False
            body = json.loads(response.read(2048))
            return body.get('status') == 'ok' and body.get('database') == 'connected'
    except (OSError, ValueError, KeyError, TimeoutError):
        return False


def loaded_database_url(data):
    matches = [line for line in data.splitlines() if line.startswith('DATABASE_URL=')]
    if len(matches) != 1:
        raise ValueError('ambiguous runtime database configuration')
    raw = matches[0].split('=', 1)[1]
    if raw != raw.strip() or any(c in raw for c in '\r\n\'"'):
        raise ValueError('invalid runtime database value')
    uri = urlsplit(raw)
    database = unquote(uri.path.lstrip('/'))
    if (uri.scheme not in ('postgres', 'postgresql') or uri.hostname != RDS_HOST
            or (uri.port or 5432) != 5432 or not uri.username
            or not uri.password or not re.fullmatch(r'[A-Za-z0-9_]+', database)):
        raise ValueError('unexpected production database identity')
    return uri, database


def active_rds_credential():
    command = ['aws', 'secretsmanager', 'get-secret-value', '--region', 'ap-south-1',
               '--secret-id', RDS_SECRET, '--version-stage', 'AWSCURRENT',
               '--query', 'SecretString', '--output', 'text']
    result = subprocess.run(command, capture_output=True, check=True, text=True,
                            timeout=20)
    value = json.loads(result.stdout)
    if not isinstance(value, dict) or not isinstance(value.get('password'), str):
        raise ValueError('invalid current secret format')
    if not value.get('username') or not value['password']:
        raise ValueError('current database credential unavailable')
    return value['username'], value['password']


def verify_new_credential(username, password, database):
    # Read-only preflight against the *unchanged* database; no migrations/writes.
    env = dict(os.environ)
    env.update(PGHOST=RDS_HOST, PGPORT='5432', PGDATABASE=database, PGUSER=username,
               PGPASSWORD=password, PGSSLMODE='require', PGCONNECT_TIMEOUT='8',
               PGOPTIONS='-c default_transaction_read_only=on')
    result = subprocess.run(['psql', '--no-psqlrc', '-X', '-w', '-A', '-t', '-q',
                             '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT 1'], env=env,
                            capture_output=True, text=True, timeout=15)
    return result.returncode == 0 and result.stdout.strip() == '1'


def rotated_url(uri, username, password):
    # Keep the existing scheme, host, port, database path and query untouched.
    netloc = f'{quote(username, safe="")}:{quote(password, safe="")}@{RDS_HOST}:5432'
    value = urlunsplit((uri.scheme, netloc, uri.path, uri.query, uri.fragment))
    if any(ch in value for ch in '\n\r\'"'):
        raise ValueError('new credential cannot be encoded safely in environment file')
    return value


def replacement_env(original, new_url):
    lines = original.splitlines(keepends=True)
    indexes = [i for i, line in enumerate(lines) if line.startswith('DATABASE_URL=')]
    if len(indexes) != 1:
        raise ValueError('database environment changed while inspecting')
    index = indexes[0]
    ending = '\r\n' if lines[index].endswith('\r\n') else '\n' if lines[index].endswith('\n') else ''
    lines[index] = f'DATABASE_URL={new_url}{ending}'
    return ''.join(lines)


def atomic_write_env(data):
    mode = ENV_FILE.stat()
    fd, name = tempfile.mkstemp(prefix='.app.env.rotation.', dir=str(ENV_FILE.parent))
    try:
        os.fchmod(fd, 0o600)
        os.fchown(fd, mode.st_uid, mode.st_gid)
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, ENV_FILE)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def restart_backend():
    completed = subprocess.run(['systemctl', 'restart', SERVICE], capture_output=True,
                               text=True, timeout=45)
    return completed.returncode == 0


def wait_until_healthy():
    for _ in range(12):
        if healthy():
            return True
        time.sleep(2)
    return False


def repair_if_rotated():
    if healthy():
        print('Rotation watch: database healthy; no AWS secret fetch or restart')
        return 0
    original = ENV_FILE.read_text(encoding='utf-8')
    uri, database = loaded_database_url(original)
    username, password = active_rds_credential()
    if unquote(uri.username) != username:
        raise ValueError('managed secret user differs from configured database user')
    if unquote(uri.password) == password:
        raise ValueError('database unhealthy but managed credential has not rotated')
    if not verify_new_credential(username, password, database):
        raise ValueError('new managed credential failed read-only database preflight')
    proposed = replacement_env(original, rotated_url(uri, username, password))
    # Only the first DATABASE_URL entry changes; verify no other settings drift.
    if replacement_env(proposed, urlunsplit(uri)) != original:
        raise ValueError('credential update would modify unrelated settings')
    atomic_write_env(proposed)
    success = False
    try:
        success = restart_backend() and wait_until_healthy()
        if success:
            print('Rotation watch: validated managed credential recovered backend health')
            return 0
    finally:
        if not success:
            # Restore the entire previous file even if restart/health polling
            # raises an exception. Never leave a half-applied credential change.
            atomic_write_env(original)
            restart_backend()
    raise ValueError('backend health failed after rotation; original env restored')


def main():
    if os.geteuid() != 0:
        print('Rotation watch: requires root service account')
        return 1
    # Shared with the release deploy script: never race app.env replacement.
    fd = os.open(LOCK_FILE, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Rotation watch: deployment active; will check next interval')
            return 0
        try:
            return repair_if_rotated()
        except (OSError, ValueError, KeyError, json.JSONDecodeError,
                subprocess.SubprocessError, UnicodeError):
            # Never emit raw exception messages; psql/CLI errors can contain secrets.
            print('Rotation watch: fail-closed; no recovery confirmed')
            return 1
    finally:
        os.close(fd)


if __name__ == '__main__':
    sys.exit(main())
