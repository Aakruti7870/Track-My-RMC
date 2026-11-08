#!/usr/bin/env python3
"""Explicit, read-only RDS TLS acceptance gate; NEVER invoked by deploy or CI.

Operator must supply --execute and --expected-database after separate approval.
Runs SELECT 1 with a valid CA and proves both hostname mismatch and wrong CA
are rejected by libpq. Never emits URLs, users, passwords, SQL error text,
private keys or certificate material. No production state is modified.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile
from urllib.parse import unquote

WATCH_PATH = Path(__file__).resolve().with_name('recover-managed-rds-credential.py')
spec = importlib.util.spec_from_file_location('trackmyrmc_rds_rotation_tls', WATCH_PATH)
watch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watch)

def read_runtime(env_file, expected_database):
    if not re.fullmatch(r'[A-Za-z0-9_]+', expected_database):
        raise ValueError('Invalid database name')
    if env_file.is_symlink() or not env_file.is_file():
        raise ValueError('Runtime environment unavailable')
    uri, database = watch.loaded_database_url(env_file.read_text(encoding='utf-8'))
    if database != expected_database:
        raise ValueError('Runtime database differs from expected database')
    if not watch.RDS_CA_FILE.is_file() or watch.RDS_CA_FILE.is_symlink():
        raise ValueError('RDS trust bundle missing')
    return uri, database

def run_psql(uri, database, *, hostname=None, hostaddr=None, roots=None):
    env = dict(os.environ)
    env.update(PGHOST=hostname or watch.RDS_HOST, PGHOSTADDR=hostaddr or '',
               PGPORT='5432', PGDATABASE=database, PGUSER=unquote(uri.username),
               PGPASSWORD=unquote(uri.password), PGSSLMODE='verify-full',
               PGSSLROOTCERT=str(roots or watch.RDS_CA_FILE),
               PGSERVICE='', PGCONNECT_TIMEOUT='8',
               PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=5000')
    return subprocess.run(
        ['psql','--no-psqlrc','-X','-w','-A','-t','-q',
         '-v','ON_ERROR_STOP=1','-c','SELECT 1'],
        env=env, capture_output=True, text=True, timeout=15, check=False)

def rejected_for_certificate(result):
    # Failure from network, authentication, password expiry or missing psql
    # is NOT evidence that TLS hostname/CA verification works.
    message = result.stderr.lower()
    return result.returncode != 0 and (
        'certificate verify failed' in message
        or ('certificate' in message and (
            'does not match' in message or 'unknown ca' in message
            or 'unable to get local issuer certificate' in message)))

def run_gate(env_file, expected_database):
    uri, database = read_runtime(env_file, expected_database)
    # Proof of positive trust-chain AND hostname validation.
    positive = run_psql(uri, database)
    if positive.returncode != 0 or positive.stdout.strip() != '1':
        raise ValueError('Verified TLS database connection did not succeed')
    records = socket.getaddrinfo(watch.RDS_HOST, 5432, type=socket.SOCK_STREAM)
    addresses = [record[4][0] for record in records if record[0] == socket.AF_INET]
    if not addresses:
        raise ValueError('RDS IPv4 address could not be resolved for hostname test')
    wrong_name = run_psql(uri, database,
                          hostname='invalid-tls-name.trackmyrmc.invalid',
                          hostaddr=addresses[0])
    if not rejected_for_certificate(wrong_name):
        raise ValueError('Wrong-hostname TLS refusal not proven')
    # A temporary, unrelated CA gives a genuine chain-validation negative
    # probe, unlike an empty/nonexistent root file that would prove only
    # configuration parsing. Keep the generated key local and disposable.
    with tempfile.TemporaryDirectory(prefix='trackmyrmc-rds-tls-') as temp:
        target = Path(temp)
        certificate = target / 'untrusted-ca.pem'
        private_key = target / 'untrusted-ca.key'
        created = subprocess.run(
            ['openssl','req','-x509','-newkey','rsa:2048','-nodes',
             '-keyout',str(private_key),'-out',str(certificate),'-days','1',
             '-subj','/CN=TrackMyRMC-Invalid-Testing-CA'],
            capture_output=True, text=True, timeout=30, check=False)
        if created.returncode != 0 or not certificate.is_file():
            raise ValueError('Negative CA probe could not be prepared')
        wrong_ca = run_psql(uri, database, roots=certificate)
        if not rejected_for_certificate(wrong_ca):
            raise ValueError('Untrusted-CA TLS refusal not proven')
    return {'status':'PASS', 'positive_hostname_and_ca':True,
            'wrong_hostname_denied':True, 'untrusted_ca_denied':True,
            'database_verified':True, 'read_only':True}

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true',
                        help='Operator opt-in: run read-only live TLS probes')
    parser.add_argument('--env-file', type=Path, default=Path('/etc/trackmyrmc/app.env'))
    parser.add_argument('--expected-database', required=True)
    args = parser.parse_args(argv)
    if not args.execute:
        print(json.dumps({'status':'BLOCKED','reason':'--execute required'}))
        return 2
    try:
        print(json.dumps(run_gate(args.env_file, args.expected_database), sort_keys=True))
        return 0
    except (OSError, ValueError, subprocess.SubprocessError, socket.gaierror,
            UnicodeError, TypeError):
        print(json.dumps({'status':'BLOCKED','reason':'Read-only verified TLS proof incomplete'}))
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
