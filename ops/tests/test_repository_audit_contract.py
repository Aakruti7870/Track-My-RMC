"""Fail-closed documentation and environment contract regression checks.

This is an offline source check; it does not stand in for Rust integration tests,
real-device QA, infrastructure approval, or production acceptance.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def variables(path: str) -> dict[str, str]:
    result = {}
    for line in read(path).splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        result[key] = value
    return result


class RepositoryAuditContractTests(unittest.TestCase):
    def test_local_environment_examples_do_not_fail_production_cors_policy(self):
        for path in [".env.example", "backend/.env.example"]:
            with self.subTest(path=path):
                env = variables(path)
                self.assertNotEqual(env.get("APP_ENV"), "production")
                self.assertNotEqual(env.get("CORS_ORIGIN"), "*")
                self.assertIn("localhost", env["DATABASE_URL"])
                self.assertEqual(env["NATIVE_AUTOMATION_WORKER_ENABLED"], "false")
                self.assertEqual(env["NATIVE_SUPPORT_AUTOMATION_ENABLED"], "false")
                self.assertEqual(env["PRIVILEGED_RECOVERY_ENABLED"], "false")

    def test_client_example_uses_current_https_origin_without_secrets(self):
        example = variables("frontend/.env.example")
        for key in ("EXPO_PUBLIC_BACKEND_URL", "EXPO_PUBLIC_API_URL"):
            self.assertEqual(example[key], "https://trackmyrmc.com")
        self.assertNotIn("onrender.com", read("frontend/.env.example"))
        self.assertFalse(any("TOKEN" in k or "SECRET" in k for k in example))

    def test_readme_sqlx_version_and_node_toolchain_are_current(self):
        cargo = read("backend/Cargo.toml")
        match = re.search(r'sqlx\s*=\s*\{\s*version\s*=\s*"(\d+\.\d+)', cargo)
        self.assertIsNotNone(match, "Could not parse Rust SQLx dependency")
        root = read("README.md")
        self.assertIn("SQLx " + match.group(1), root)
        self.assertIn("Node.js 20+", root)
        self.assertIn("Central Admin", root)
        self.assertIn("Authority", root)
        self.assertIn("TRACKMYRMC_APPROVED_RELEASE_SHA", root)

    def test_local_markdown_links_resolve_to_tracked_sources(self):
        for path in ("README.md", "frontend/README.md"):
            md = ROOT / path
            destinations = re.findall(r"\[[^\]]+\]\(([^)]+)\)", md.read_text(encoding="utf-8"))
            for dest in destinations:
                if dest.startswith(("https:", "http:", "mailto:", "#")):
                    continue
                target = (md.parent / dest.split("#", 1)[0]).resolve()
                with self.subTest(markdown=path, link=dest):
                    self.assertTrue(target.is_file(), "Missing linked local document")

    def test_authority_support_delegation_matches_documentation(self):
        source = read("backend/src/auth/authority.rs")
        policy = read("docs/security/central-admin-authority-control-plane.md")
        allowlist = source.split("pub const DELEGABLE:", 1)[1].split("];", 1)[0]
        grants = set(re.findall(r'"([a-z._]+)"', allowlist))
        self.assertEqual(len(grants), 7)
        self.assertIn("support.view", grants)
        self.assertIn("support.reply", grants)
        self.assertNotIn("support.manage", grants)
        for grant in grants:
            with self.subTest(grant=grant):
                self.assertIn(grant, policy)

    def test_aws_release_guard_is_documented_but_not_bypassed(self):
        workflow = read(".github/workflows/deploy-aws-production.yml")
        guide = read("docs/DEPLOYMENT.md")
        for marker in (
            "vars.TRACKMYRMC_APPROVED_RELEASE_SHA != ''",
            "vars.TRACKMYRMC_APPROVED_RELEASE_SHA ==",
            "github.ref == 'refs/heads/main'",
        ):
            self.assertIn(marker, workflow)
        self.assertIn("TRACKMYRMC_APPROVED_RELEASE_SHA", guide)
        self.assertIn("AWS", guide)
        self.assertIn("not proof", guide.lower())

    def test_connection_failure_has_distinct_diagnostic(self):
        source = read("backend/src/db/pool.rs")
        self.assertIn("Database connection failed:", source)
        self.assertIn("Database migration failed:", source)
        self.assertIn('System clock unavailable', read("backend/src/auth/totp.rs"))


if __name__ == "__main__":
    unittest.main()
