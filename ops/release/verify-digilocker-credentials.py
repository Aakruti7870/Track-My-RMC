#!/usr/bin/env python3
"""Redacted Sandbox DigiLocker auth probe, no identity session.

Run only in a secure environment with selected API key and secret available as
environment variables. Never prints keys, response bodies or bearer tokens.
"""
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

HOSTS = {"sandbox": "https://test-api.sandbox.co.in", "live": "https://api.sandbox.co.in"}
KEY_NAMES = {
    "sandbox": ("SANDBOX_KYC_API_KEY", "SANDBOX_KYC_API_SECRET"),
    "live": ("LIVE_KYC_API_KEY", "LIVE_KYC_API_SECRET"),
}
MAX_RESPONSE_BYTES = 8192


def valid_response(body):
    return (
        isinstance(body, dict)
        and body.get("code") == 200
        and isinstance(body.get("data"), dict)
        and isinstance(body["data"].get("access_token"), str)
        and 0 < len(body["data"]["access_token"]) < MAX_RESPONSE_BYTES
    )


def main():
    mode = os.getenv("TRACKMYRMC_KYC_ENV", "")
    if mode not in HOSTS:
        print("DIGILOCKER_AUTH=BLOCKED; REASON=INVALID_ENVIRONMENT")
        return 2
    if mode == "live" and os.getenv("TRACKMYRMC_KYC_LIVE_APPROVED") != "true":
        print("DIGILOCKER_AUTH=BLOCKED; REASON=LIVE_APPROVAL_MISSING")
        return 2
    key_name, secret_name = KEY_NAMES[mode]
    key, secret = os.getenv(key_name, "").strip(), os.getenv(secret_name, "").strip()
    if not key or not secret:
        print("DIGILOCKER_AUTH=BLOCKED; REASON=ENVIRONMENT_KEYS_MISSING")
        return 2
    request = Request(
        HOSTS[mode] + "/authenticate",
        data=b"",
        headers={"x-api-key": key, "x-api-secret": secret},
        method="POST",
    )
    try:
        with urlopen(request, timeout=12) as response:
            code, raw = response.status, response.read(MAX_RESPONSE_BYTES + 1)
    except HTTPError as error:
        print(f"DIGILOCKER_AUTH=FAIL; HTTP={error.code}")
        return 1
    except (URLError, TimeoutError, OSError):
        print("DIGILOCKER_AUTH=FAIL; REASON=CONNECTIVITY")
        return 1
    if len(raw) > MAX_RESPONSE_BYTES:
        print("DIGILOCKER_AUTH=FAIL; REASON=OVERSIZED_RESPONSE")
        return 1
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeError):
        print("DIGILOCKER_AUTH=FAIL; REASON=INVALID_JSON")
        return 1
    if code == 200 and valid_response(body):
        print(f"DIGILOCKER_AUTH=PASS; ENVIRONMENT={mode}")
        return 0
    print(f"DIGILOCKER_AUTH=FAIL; HTTP={code}; REASON=INVALID_AUTH_RESPONSE")
    return 1


if __name__ == "__main__":
    sys.exit(main())
