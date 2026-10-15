#!/usr/bin/env bash
# Read-only application database and service gate. NEVER print DATABASE_URL.
set -Eeuo pipefail

EXPECTED_DB="trackmyrmc"
EXPECTED_HOST="trackmyrmc-postgres.cf8mmcwuuinx.ap-south-1.rds.amazonaws.com"
APP_SECRET="trackmyrmc/app-runtime"
ENV_FILE="/etc/trackmyrmc/app.env"

command -v python3 >/dev/null || { echo "BLOCKED: python3 unavailable"; exit 1; }
command -v aws >/dev/null || { echo "BLOCKED: AWS CLI unavailable"; exit 1; }
command -v jq >/dev/null || { echo "BLOCKED: jq unavailable"; exit 1; }
test -r "$ENV_FILE" || { echo "BLOCKED: existing production app.env unavailable"; exit 1; }

# shlex handles double/single quoted env values; urlsplit handles percent-encoded
# credentials. Only return the database name and host, never the URL or password.
DB_INFO="$(python3 - "$ENV_FILE" <<'PY'
import pathlib, shlex, sys
from urllib.parse import urlsplit

path = pathlib.Path(sys.argv[1])
rows = [line.split("=", 1)[1] for line in path.read_text().splitlines()
        if line.startswith("DATABASE_URL=")]
if len(rows) != 1:
    sys.exit("BLOCKED: exactly one DATABASE_URL is required")
values = shlex.split(rows[0])
if len(values) != 1:
    sys.exit("BLOCKED: invalid quoted DATABASE_URL")
parsed = urlsplit(values[0])
name = parsed.path.lstrip("/")
if not parsed.hostname or not name or parsed.scheme not in ("postgres", "postgresql"):
    sys.exit("BLOCKED: malformed DATABASE_URL")
print(name)
print(parsed.hostname)
PY
)"
RUNTIME_DB="$(printf '%s\n' "$DB_INFO" | sed -n '1p')"
RUNTIME_HOST="$(printf '%s\n' "$DB_INFO" | sed -n '2p')"

if [ "$RUNTIME_HOST" != "$EXPECTED_HOST" ] || [ "$RUNTIME_DB" != "$EXPECTED_DB" ]; then
  echo "BLOCKED: production runtime DB/host does not match approved destination."
  echo "Current database: $RUNTIME_DB; required database: $EXPECTED_DB."
  echo "No deployment and no automatic database cutover is permitted."
  exit 1
fi

# Check only the DB_NAME field; never print the secret document or credentials.
SECRET_DB="$(aws secretsmanager get-secret-value --secret-id "$APP_SECRET" \
  --query SecretString --output text | jq -er '.DB_NAME')"
if [ "$SECRET_DB" != "$EXPECTED_DB" ]; then
  echo "BLOCKED: runtime secret DB_NAME differs from approved production database."
  exit 1
fi

systemctl is-active --quiet trackmyrmc-backend || { echo "BLOCKED: backend service inactive"; exit 1; }
systemctl is-active --quiet nginx || { echo "BLOCKED: nginx inactive"; exit 1; }

# The deployment's public smoke checks must also pass after release cutover.
echo "PASS: approved database name, runtime secret, RDS host and services agree."
