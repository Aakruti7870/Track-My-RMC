#!/usr/bin/env python3
"""Safe, no-identity-data authentication check for the Sandbox DigiLocker *test* API.

Requires SANDBOX_KYC_API_KEY and SANDBOX_KYC_API_SECRET in the process environment.
Never prints credentials, authorization tokens, response bodies, or user data.
This only checks /authenticate; it does not create a DigiLocker session.
"""
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

TEST_AUTH_URL = "https://test-api.sandbox.co.in/authenticate"
MAX_RESPONSE_BYTES = 8192


def valid_auth_response(payload):
    return (
        isinstance(payload, dict)
        and payload.get("code") == 200
        and isinstance(payload.get("data"), dict)
        and isinstance(payload["data"].get("access_token"), str)
        and bool(payload["data"]["access_token"])
    )


def main():
    key = os.environ.get("SANDBOX_KYC_API_KEY", "").strip()
    secret = os.environ.get("SANDBOX_KYC_API_SECRET", "").strip()
    if not key or not secret:
        print("SANDBOX_AUTH=BLOCKED; REASON=TEST_CREDENTIALS_MISSING")
        return 2

    request = Request(
        TEST_AUTH_URL,
        data=b"",
        headers={"x-api-key": key, "x-api-secret": secret},
        method="POST",
    )
    try:
        with urlopen(request, timeout=12) as response:
            http_status = response.status
            raw = response.read(MAX_RESPONSE_BYTES + 1)
    except HTTPError as exc:
        print(f"SANDBOX_AUTH=FAIL; HTTP={exc.code}")
        return 1
    except (URLError, TimeoutError, OSError):
        print("SANDBOX_AUTH=FAIL; REASON=NETWORK_OR_TLS")
        return 1

    if len(raw) > MAX_RESPONSE_BYTES:
        print("SANDBOX_AUTH=FAIL; REASON=OVERSIZED_RESPONSE")
        return 1
    try:
        response_body = json.loads(raw)
    except (ValueError, UnicodeError):
        print("SANDBOX_AUTH=FAIL; REASON=INVALID_RESPONSE")
        return 1

    if http_status == 200 and valid_auth_response(response_body):
        print("SANDBOX_AUTH=PASS; ENVIRONMENT=test")
        return 0
    print(f"SANDBOX_AUTH=FAIL; HTTP={http_status}; REASON=INVALID_TOKEN_RESPONSE")
    return 1


if __name__ == "__main__":
    sys.exit(main())
