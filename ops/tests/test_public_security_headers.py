"""Regression for public Expo security headers in the generated AWS Nginx host.

The Admin route has explicit security headers; the public SPA and immutable
assets must retain equivalent baseline protections after Nginx add_header
inheritance resets on a location-level directive.
"""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
DEPLOY = ROOT / "ops" / "aws-deploy-ec2.sh"


class PublicSecurityHeadersTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        script = DEPLOY.read_text(encoding="utf-8")
        cls.nginx = script.split(
            "cat > /etc/nginx/sites-available/trackmyrmc <<'NGINX'\n", 1
        )[1].split("\nNGINX", 1)[0]

    def location_body(self, location):
        # The tested locations contain no nested location blocks.
        begin = "    location " + location + " {\n"
        self.assertIn(begin, self.nginx)
        return self.nginx.rsplit(begin, 1)[1].split("\n    }", 1)[0]

    def test_public_spa_and_static_assets_keep_security_headers(self):
        for location in ["/", "/_expo/static/"]:
            with self.subTest(location=location):
                body = self.location_body(location)
                for header in [
                    "Strict-Transport-Security",
                    "X-Content-Type-Options",
                    "Referrer-Policy",
                    "Content-Security-Policy",
                ]:
                    self.assertIn("add_header " + header + " ", body)
                self.assertIn("always;", body)

    def test_aws_api_proxy_does_not_use_legacy_cloud_run(self):
        self.assertNotIn("tracking-preview-api-", self.nginx)
        self.assertIn("proxy_pass http://127.0.0.1:8000;", self.nginx)


if __name__ == "__main__":
    unittest.main()
