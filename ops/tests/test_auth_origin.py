"""Contracts for both phases of the generated production origin."""
import ipaddress
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = (ROOT / "ops/aws-deploy-ec2.sh").read_text()
TLS = DEPLOY.split("<<'NGINX'\n")[1].split("\nNGINX")[0]


class AuthOriginTests(unittest.TestCase):
    def test_certificate_bootstrap_never_proxies_private_requests(self):
        bootstrap = DEPLOY.split("<<'NGINX_BOOTSTRAP'\n")[1].split("\nNGINX_BOOTSTRAP")[0]
        self.assertNotIn("proxy_pass", bootstrap)
        self.assertIn("return 503;", bootstrap)
        self.assertIn("acme-challenge", bootstrap)

    def test_only_reviewed_proxy_networks_can_supply_the_address(self):
        cidrs = re.findall(r"^set_real_ip_from (.*?);$", TLS, re.M)
        networks = [ipaddress.ip_network(cidr) for cidr in cidrs]
        self.assertEqual(sum(net.version == 4 for net in networks), 15)
        self.assertEqual(sum(net.version == 6 for net in networks), 7)
        self.assertTrue(all(net.is_global and net.prefixlen >= 12 for net in networks))
        self.assertIn("real_ip_header CF-Connecting-IP;", TLS)
        self.assertNotIn("$proxy_add_x_forwarded_for", TLS)
        for block in re.findall(r"location [^{]+\{([^}]+)\}", TLS):
            if "proxy_pass http://127.0.0.1:8000;" in block:
                self.assertIn("proxy_set_header X-Real-IP $remote_addr;", block)

    def test_all_registered_authentication_paths_enter_a_limited_location(self):
        router = (ROOT / "backend/src/routes/mod.rs").read_text()
        paths = re.findall(r'"(/api/(?:[^"]*/)?auth/[^"]+|/api/account-deletion/[^"]+)"', router)
        locations = re.findall(r"location ~ (\S+) \{\s+limit_req zone=", TLS)
        self.assertIn("/api/staff/auth/send-otp", paths)
        for path in paths:
            self.assertTrue(any(re.match(pattern, path) for pattern in locations), path)
