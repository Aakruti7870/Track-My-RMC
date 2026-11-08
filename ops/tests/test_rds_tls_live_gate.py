"""Offline tests for opt-in production TLS acceptance, never contact an RDS host."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / 'release' / 'verify-rds-tls.py'
spec = importlib.util.spec_from_file_location('trackmyrmc_rds_tls_test', MODULE)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

class TlsAcceptanceTests(unittest.TestCase):
    def test_default_refuses_all_live_queries(self):
        with patch.object(gate, 'run_gate') as remote:
            self.assertEqual(gate.main(['--expected-database','postgres']), 2)
            remote.assert_not_called()

    def test_rejects_invalid_db_identity_and_unverified_bundle(self):
        with tempfile.TemporaryDirectory() as tmp:
            envfile = Path(tmp) / 'app.env'
            envfile.write_text('APP_ENV=production\n')
            with self.assertRaises(ValueError):
                gate.read_runtime(envfile, 'postgres;DROP TABLE users')
            with self.assertRaises(ValueError):
                gate.read_runtime(envfile, 'postgres')
            envfile.unlink()
            envfile.symlink_to(Path(tmp) / 'target')
            with self.assertRaises(ValueError):
                gate.read_runtime(envfile, 'postgres')

    def test_probe_uses_full_chain_and_host_verification(self):
        uri = type('Uri',(),{'username':'admin','password':'dummy'})()
        completed = subprocess.CompletedProcess([], 0, '1\n', '')
        with patch.object(gate.subprocess,'run',return_value=completed) as runner:
            result = gate.run_psql(uri,'postgres',hostname='test.invalid',
                                   hostaddr='127.0.0.1',roots=Path('/tmp/root.pem'))
            self.assertEqual(result.stdout.strip(),'1')
            args,opts=runner.call_args
            self.assertNotIn('dummy',repr(args))
            self.assertEqual(opts['env']['PGSSLMODE'],'verify-full')
            self.assertEqual(opts['env']['PGHOST'],'test.invalid')
            self.assertEqual(opts['env']['PGHOSTADDR'],'127.0.0.1')
            self.assertEqual(opts['env']['PGSSLROOTCERT'],'/tmp/root.pem')
            self.assertIn('default_transaction_read_only=on',opts['env']['PGOPTIONS'])
            self.assertTrue(opts['capture_output'])

    def test_network_or_bad_password_failure_does_not_count_as_tls_proof(self):
        for err in ['connection refused','password authentication failed','timed out','']:
            with self.subTest(err=err):
                self.assertFalse(gate.rejected_for_certificate(
                    subprocess.CompletedProcess([],1,'',err)))
        self.assertTrue(gate.rejected_for_certificate(subprocess.CompletedProcess(
            [],1,'','SSL error: certificate verify failed')))
        self.assertTrue(gate.rejected_for_certificate(subprocess.CompletedProcess(
            [],1,'','server certificate for "db" does not match host name "wrong.invalid"')))
        self.assertFalse(gate.rejected_for_certificate(subprocess.CompletedProcess(
            [],0,'1\n','server certificate does not match')))

    def test_operator_executes_only_after_opt_in(self):
        with patch.object(gate, 'run_gate',return_value={'status':'PASS'}) as remote:
            self.assertEqual(gate.main(['--execute','--expected-database','postgres']),0)
            remote.assert_called_once()

if __name__ == '__main__':
    unittest.main()
