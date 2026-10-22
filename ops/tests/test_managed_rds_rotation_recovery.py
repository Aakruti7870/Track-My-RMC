"""Offline fail-closed tests for the EC2 managed-credential rotation watch."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / 'release' / 'recover-managed-rds-credential.py'
spec = importlib.util.spec_from_file_location('rds_rotation_recovery', MODULE)
watch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watch)

OLD = ('postgres://trackmyrmc_admin:old-pass@'
       'trackmyrmc-postgres.cf8mmcwuuinx.ap-south-1.rds.amazonaws.com:5432/'
       'postgres?sslmode=require')
RAW = 'APP_ENV=production\nDATABASE_URL=' + OLD + '\nOTP_MAX_ATTEMPTS=5\n'


class RotationWatchTests(unittest.TestCase):
    def test_exact_database_identity_and_all_other_vars_preserved(self):
        uri, db = watch.loaded_database_url(RAW)
        self.assertEqual(db, 'postgres')
        new = watch.rotated_url(uri, 'trackmyrmc_admin', 'new#pass@word%')
        self.assertIn('new%23pass%40word%25@', new)
        self.assertIn('/postgres?sslmode=require', new)
        replaced = watch.replacement_env(RAW, new)
        self.assertEqual(replaced.splitlines()[0], 'APP_ENV=production')
        self.assertEqual(replaced.splitlines()[-1], 'OTP_MAX_ATTEMPTS=5')
        self.assertEqual(watch.replacement_env(replaced, OLD), RAW)

    def test_rejects_misleading_host_database_ambiguous_and_quotes(self):
        bad_values = [
            RAW.replace('trackmyrmc-postgres.', 'attacker.'),
            RAW.replace('/postgres?', '/postgres/other?'),
            RAW.replace('/postgres?', '/%2E%2E?'),
            RAW + 'DATABASE_URL=' + OLD + '\n',
            RAW.replace('DATABASE_URL=' + OLD, 'DATABASE_URL="' + OLD + '"'),
        ]
        for bad in bad_values:
            with self.subTest(bad=bad[:55]):
                with self.assertRaises(ValueError):
                    watch.loaded_database_url(bad)

    def test_healthy_does_not_access_secrets_or_restart_backend(self):
        with patch.object(watch, 'healthy', return_value=True), \
                patch.object(watch, 'active_rds_credential') as secret, \
                patch.object(watch, 'restart_backend') as restart:
            self.assertEqual(watch.repair_if_rotated(), 0)
            secret.assert_not_called()
            restart.assert_not_called()

    def test_same_password_or_different_user_never_restarts(self):
        with tempfile.TemporaryDirectory() as d:
            env = Path(d) / 'app.env'
            env.write_text(RAW)
            with patch.object(watch, 'ENV_FILE', env), \
                    patch.object(watch, 'healthy', return_value=False), \
                    patch.object(watch, 'restart_backend') as restart:
                with patch.object(watch, 'active_rds_credential', return_value=('trackmyrmc_admin', 'old-pass')):
                    with self.assertRaisesRegex(ValueError, 'has not rotated'):
                        watch.repair_if_rotated()
                with patch.object(watch, 'active_rds_credential', return_value=('wrong-user', 'new-pass')):
                    with self.assertRaisesRegex(ValueError, 'user differs'):
                        watch.repair_if_rotated()
                restart.assert_not_called()
            self.assertEqual(env.read_text(), RAW)

    def test_failed_new_secret_preflight_leaves_env_unchanged(self):
        with tempfile.TemporaryDirectory() as d:
            env = Path(d) / 'app.env'
            env.write_text(RAW)
            with patch.object(watch, 'ENV_FILE', env), \
                    patch.object(watch, 'healthy', return_value=False), \
                    patch.object(watch, 'active_rds_credential', return_value=('trackmyrmc_admin', 'new-pass')), \
                    patch.object(watch, 'verify_new_credential', return_value=False), \
                    patch.object(watch, 'restart_backend') as restart:
                with self.assertRaisesRegex(ValueError, 'preflight'):
                    watch.repair_if_rotated()
                restart.assert_not_called()
            self.assertEqual(env.read_text(), RAW)

    def test_successful_rotation_changes_only_db_url_and_restarts_once(self):
        with tempfile.TemporaryDirectory() as d:
            env = Path(d) / 'app.env'
            env.write_text(RAW)
            with patch.object(watch, 'ENV_FILE', env), \
                    patch.object(watch, 'healthy', return_value=False), \
                    patch.object(watch, 'active_rds_credential', return_value=('trackmyrmc_admin', 'new-pass')), \
                    patch.object(watch, 'verify_new_credential', return_value=True), \
                    patch.object(watch, 'restart_backend', return_value=True) as restart, \
                    patch.object(watch, 'wait_until_healthy', return_value=True):
                self.assertEqual(watch.repair_if_rotated(), 0)
                restart.assert_called_once()
            self.assertIn('new-pass@', env.read_text())
            self.assertIn('OTP_MAX_ATTEMPTS=5', env.read_text())
            self.assertEqual(env.stat().st_mode & 0o777, 0o600)

    def test_unhealthy_restart_rolls_back_every_env_change(self):
        with tempfile.TemporaryDirectory() as d:
            env = Path(d) / 'app.env'
            env.write_text(RAW)
            with patch.object(watch, 'ENV_FILE', env), \
                    patch.object(watch, 'healthy', return_value=False), \
                    patch.object(watch, 'active_rds_credential', return_value=('trackmyrmc_admin', 'new-pass')), \
                    patch.object(watch, 'verify_new_credential', return_value=True), \
                    patch.object(watch, 'restart_backend', return_value=True) as restart, \
                    patch.object(watch, 'wait_until_healthy', return_value=False):
                with self.assertRaisesRegex(ValueError, 'restored'):
                    watch.repair_if_rotated()
                self.assertEqual(restart.call_count, 2)
            self.assertEqual(env.read_text(), RAW)

    def test_restart_exception_also_rolls_back(self):
        with tempfile.TemporaryDirectory() as d:
            env = Path(d) / 'app.env'
            env.write_text(RAW)
            with patch.object(watch, 'ENV_FILE', env), \
                    patch.object(watch, 'healthy', return_value=False), \
                    patch.object(watch, 'active_rds_credential', return_value=('trackmyrmc_admin', 'new-pass')), \
                    patch.object(watch, 'verify_new_credential', return_value=True), \
                    patch.object(watch, 'restart_backend', side_effect=[OSError('fake failure'), True]):
                with self.assertRaises(OSError):
                    watch.repair_if_rotated()
            self.assertEqual(env.read_text(), RAW)

    def test_preflight_select_one_is_read_only_and_never_logs_postgres_stderr(self):
        dummy = type('Result', (), {'returncode': 0, 'stdout': '1\n'})()
        with patch.object(watch.subprocess, 'run', return_value=dummy) as run:
            self.assertTrue(watch.verify_new_credential('trackmyrmc_admin', 'secret-pass', 'postgres'))
            args, kwargs = run.call_args
            self.assertIn('SELECT 1', args[0]); self.assertEqual(kwargs['env']['PGPASSWORD'], 'secret-pass')
            self.assertIn('default_transaction_read_only=on', kwargs['env']['PGOPTIONS'])
            self.assertTrue(kwargs['capture_output'])


class InstallationContractTests(unittest.TestCase):
    def test_service_timer_and_deploy_share_a_lock(self):
        installer = (MODULE.parents[2] / 'aws-deploy-ec2.sh')
        if installer.exists():
            content = installer.read_text()
            self.assertIn('trackmyrmc-production.lock', content)
            self.assertIn('trackmyrmc-rds-recovery.timer', content)
            self.assertIn('recover-managed-rds-credential.py', content)


if __name__ == '__main__':
    unittest.main()
