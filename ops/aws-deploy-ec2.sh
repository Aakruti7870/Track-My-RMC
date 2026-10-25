#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_SHA:?RELEASE_SHA is required}"
# The recovery timer and deployments must never rewrite app.env concurrently.
# Take the lock before changing certificates, binaries, or runtime credentials.
install -d -m 0755 /run/lock
exec 200>/run/lock/trackmyrmc-production.lock
flock -x 200

REGION="ap-south-1"
BUCKET="trackmyrmc-prod-artifacts-260234292958-ap-south-1"
RDS_SECRET="arn:aws:secretsmanager:ap-south-1:260234292958:secret:rds!db-725487fe-ba11-4b7a-acdd-6c60010aa20f-CdtJlW"
APP_SECRET="trackmyrmc/app-runtime"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx curl ca-certificates jq unzip certbot >/dev/null

if ! command -v aws >/dev/null 2>&1; then
  curl -fsSL https://awscli.amazonaws.com/v2/install.sh | bash -s -- --system
fi

id -u trackmyrmc >/dev/null 2>&1 || useradd --system --home /opt/trackmyrmc --shell /usr/sbin/nologin trackmyrmc
DEPLOY_CACHE_DIR="/opt/trackmyrmc/deploy-cache"
mkdir -p /opt/trackmyrmc/releases /opt/trackmyrmc/frontend "$DEPLOY_CACHE_DIR"
chown -R trackmyrmc:trackmyrmc "$DEPLOY_CACHE_DIR" || true
chmod 0700 "$DEPLOY_CACHE_DIR" || true

cleanup_release_archives() {
  rm -f "$DEPLOY_CACHE_DIR/frontend-$RELEASE_SHA.tgz" \
        "$DEPLOY_CACHE_DIR/source-$RELEASE_SHA.tgz" \
        "$DEPLOY_CACHE_DIR/admin-web-$RELEASE_SHA.tgz"
}
trap cleanup_release_archives EXIT

# Obtain a certificate only when absent; routine deploys keep HTTPS online.
if [ ! -s /etc/letsencrypt/live/trackmyrmc.com/fullchain.pem ] || [ ! -s /etc/letsencrypt/live/trackmyrmc.com/privkey.pem ]; then
# Bootstrap HTTP virtual host for ACME HTTP-01 validation.
install -d -m 0755 /var/www/certbot/.well-known/acme-challenge
cat > /etc/nginx/sites-available/trackmyrmc <<'NGINX_BOOTSTRAP'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name trackmyrmc.com _;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type text/plain;
        try_files $uri =404;
    }

    location = /healthz {
        default_type text/plain;
        return 200 "ok";
    }

    location = /kyc/return {
        proxy_pass http://127.0.0.1:8000/kyc/return;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }

    location = /health {
        proxy_pass http://127.0.0.1:8000/health;
        proxy_set_header Host $host;
    }

    location /_expo/static/ {
        root /opt/trackmyrmc/frontend;
        try_files $uri =404;
    }

    location / {
        root /opt/trackmyrmc/frontend;
        index index.html;
        try_files $uri /index.html;
    }
}
NGINX_BOOTSTRAP

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/trackmyrmc /etc/nginx/sites-enabled/trackmyrmc
nginx -t
systemctl enable nginx
systemctl restart nginx

# Obtain/renew a publicly trusted certificate through the existing proxied HTTP origin.
certbot certonly --webroot -w /var/www/certbot \
    --non-interactive --agree-tos --register-unsafely-without-email \
    --keep-until-expiring --cert-name trackmyrmc.com \
    -d trackmyrmc.com
fi

test -s /etc/letsencrypt/live/trackmyrmc.com/fullchain.pem
test -s /etc/letsencrypt/live/trackmyrmc.com/privkey.pem

install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx <<'HOOK'
#!/bin/sh
systemctl reload nginx
HOOK
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx

cat > /etc/nginx/sites-available/trackmyrmc <<'NGINX'
# HTTP remains available for ACME renewal; all application traffic uses HTTPS.
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name trackmyrmc.com _;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type text/plain;
        try_files $uri =404;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name trackmyrmc.com;

    ssl_certificate /etc/letsencrypt/live/trackmyrmc.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/trackmyrmc.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:TrackMyRMCTLS:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    add_header Strict-Transport-Security "max-age=31536000" always;

    root /opt/trackmyrmc/frontend;
    index index.html;

    location = /healthz {
        default_type text/plain;
        return 200 "ok";
    }

    # Admin dashboard is a separately built SPA mounted under /admin/.
    location = /admin {
        return 301 /admin/;
    }

    location = /admin/ {
        # Use root + an explicit file lookup. An alias to index.html makes
        # Nginx's index module append a second "index.html" and return HTTP 500.
        root /opt/trackmyrmc/admin-web;
        try_files /index.html =404;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    location ^~ /admin/assets/ {
        alias /opt/trackmyrmc/admin-web/assets/;
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location ^~ /admin/ {
        # The alias maps dashboard files directly; missing files naturally 404.
        alias /opt/trackmyrmc/admin-web/;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;
    }

    location = /health {
        proxy_pass http://127.0.0.1:8000/health;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location = /.well-known/assetlinks.json {
        proxy_pass http://127.0.0.1:8000/.well-known/assetlinks.json;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /kyc/return {
        proxy_pass http://127.0.0.1:8000/kyc/return;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /_expo/static/ {
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        try_files $uri /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
}
NGINX

nginx -t

systemctl enable nginx
systemctl restart nginx

APP_JSON="$(aws secretsmanager get-secret-value --secret-id "$APP_SECRET" --query SecretString --output text)"
printf '%s' "$APP_JSON" | jq -e '
  (.JWT_SECRET | type == "string" and length >= 64) and
  (.OTP_PEPPER | type == "string" and length >= 32) and
  (.META_WHATSAPP_TOKEN | type == "string" and length > 0) and
  (.META_PHONE_NUMBER_ID | type == "string" and length > 0) and
  (.META_WABA_ID | type == "string" and length > 0) and
  (.EMAIL_API_KEY | type == "string" and length > 0) and
  (.EMAIL_FROM_ADDRESS | type == "string" and length > 0) and
  (if (.PLAY_REVIEW_ACCESS_CODE // "") == "" then true else ((.PLAY_REVIEW_ACCESS_CODE | type) == "string" and (.PLAY_REVIEW_ACCESS_CODE | test("^[0-9]{6}$"))) end) and
  (.DB_NAME == "trackmyrmc")
' >/dev/null || {
  echo "Required production runtime fields are missing or invalid; refusing release." >&2
  exit 1
}
DB_NAME="$(printf '%s' "$APP_JSON" | jq -r '.DB_NAME // "trackmyrmc"')"
if [[ ! "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "DB_NAME contains unsupported characters; refusing deployment." >&2
  exit 1
fi

# Do not cut production data over to a different database as a side effect of
# a web/backend release. Until the database parity/backup gate is completed,
# preserve the database already configured by the running release.
CURRENT_DB_NAME=""
if [ -r /etc/trackmyrmc/app.env ]; then
  CURRENT_DB_NAME="$(python3 - /etc/trackmyrmc/app.env <<'PY'
import sys
from urllib.parse import urlsplit, unquote
with open(sys.argv[1], encoding="utf-8") as f:
    values = [line.split("=", 1)[1].strip() for line in f if line.startswith("DATABASE_URL=")]
if len(values) != 1:
    sys.exit("Expected exactly one DATABASE_URL")
parsed = urlsplit(values[0].strip("\\\"'"))
if parsed.scheme not in ("postgres", "postgresql") or not parsed.hostname:
    sys.exit("Malformed existing DATABASE_URL; refusing deployment")
name = unquote(parsed.path.lstrip("/"))
if not name or any(ch in name for ch in ("/", ":", "%", '"')):
    sys.exit("Invalid existing database name; refusing deployment")
print(name)
PY
)"
fi
# Production database cutovers are NEVER authorized through a web release flag.
# Reconcile data and migrations out of band, after isolated restore evidence.
if [[ -n "$CURRENT_DB_NAME" && "$CURRENT_DB_NAME" != "$DB_NAME" ]]; then
  echo "Database cutover is blocked: runtime currently uses '$CURRENT_DB_NAME' while secret DB_NAME is '$DB_NAME'. Preserving '$CURRENT_DB_NAME' until a verified backup and data/migration parity check authorizes cutover."
  DB_NAME="$CURRENT_DB_NAME"
fi

DB_JSON="$(aws secretsmanager get-secret-value --secret-id "$RDS_SECRET" --query SecretString --output text)"
DATABASE_URL="$(printf '%s' "$DB_JSON" | TRACKMYRMC_DB_NAME="$DB_NAME" python3 -c 'import json,sys,urllib.parse as u,os; x=json.load(sys.stdin); db=os.environ["TRACKMYRMC_DB_NAME"]; print("postgres://%s:%s@trackmyrmc-postgres.cf8mmcwuuinx.ap-south-1.rds.amazonaws.com:5432/%s?sslmode=require"%(u.quote(x["username"],safe=""),u.quote(x["password"],safe=""),u.quote(db,safe="")))')"

# Validate the generated connection string without exposing credentials.
TRACKMYRMC_DATABASE_URL="$DATABASE_URL" TRACKMYRMC_EXPECTED_DB_NAME="$DB_NAME" python3 - <<'PY'
import os
from urllib.parse import urlsplit, unquote
url = os.environ["TRACKMYRMC_DATABASE_URL"]
parsed = urlsplit(url)
name = unquote(parsed.path.lstrip("/"))
if (parsed.scheme not in ("postgres", "postgresql")
        or not parsed.hostname or not parsed.username or not parsed.password
        or name != os.environ["TRACKMYRMC_EXPECTED_DB_NAME"]
        or any(ch in url for ch in ('"', "'", "\\n", "\\r"))):
    raise SystemExit("Invalid PostgreSQL connection configuration; deployment blocked")
PY

JWT_SECRET="$(printf '%s' "$APP_JSON" | jq -r '.JWT_SECRET')"
OTP_PEPPER="$(printf '%s' "$APP_JSON" | jq -r '.OTP_PEPPER')"
META_TOKEN="$(printf '%s' "$APP_JSON" | jq -r '.META_WHATSAPP_TOKEN // empty')"
META_PHONE="$(printf '%s' "$APP_JSON" | jq -r '.META_PHONE_NUMBER_ID // empty')"
META_WABA="$(printf '%s' "$APP_JSON" | jq -r '.META_WABA_ID // empty')"
EMAIL_KEY="$(printf '%s' "$APP_JSON" | jq -r '.EMAIL_API_KEY // empty')"
EMAIL_FROM="$(printf '%s' "$APP_JSON" | jq -r '.EMAIL_FROM_ADDRESS // "noreply@trackmyrmc.com"')"
META_GRAPH_API_VERSION="$(printf '%s' "$APP_JSON" | jq -r '.META_GRAPH_API_VERSION // "v26.0"')"
PLAY_SIGNING_SHA256="$(printf '%s' "$APP_JSON" | jq -r '.PLAY_SIGNING_SHA256 // empty')"
PLAY_REVIEW_ACCESS_CODE="$(printf '%s' "$APP_JSON" | jq -r '.PLAY_REVIEW_ACCESS_CODE // empty')"
GOOGLE_PLACES_API_KEY="$(printf '%s' "$APP_JSON" | jq -r '.GOOGLE_PLACES_API_KEY // empty')"
# KYC is opt-in and fail-closed. Never silently expose the existing secret as
# a production-enabled verification provider.
TRACKMYRMC_KYC_ENABLED="$(printf '%s' "$APP_JSON" | jq -r '.TRACKMYRMC_KYC_ENABLED // "false" | tostring')"
TRACKMYRMC_KYC_ENV="$(printf '%s' "$APP_JSON" | jq -r '.TRACKMYRMC_KYC_ENV // "disabled"')"
KYC_API_KEY=''
KYC_API_SECRET=''
if [[ "$TRACKMYRMC_KYC_ENABLED" != 'false' && "$TRACKMYRMC_KYC_ENABLED" != 'true' ]]; then
  echo 'Invalid TRACKMYRMC_KYC_ENABLED switch: expected true or false' >&2
  exit 1
fi
if [[ "$TRACKMYRMC_KYC_ENABLED" == 'true' ]]; then
  [[ "$TRACKMYRMC_KYC_ENV" == 'sandbox' ]] || { echo 'KYC enablement requires explicitly verified sandbox environment' >&2; exit 1; }
  KYC_API_KEY="$(printf '%s' "$APP_JSON" | jq -r '.SANDBOX_KYC_API_KEY // .KYC_API_KEY // empty')"
  KYC_API_SECRET="$(printf '%s' "$APP_JSON" | jq -r '.SANDBOX_KYC_API_SECRET // .KYC_API_SECRET // empty')"
  REDIRECT="$(printf '%s' "$APP_JSON" | jq -r '.KYC_REDIRECT_URL // empty')"
  [[ "$REDIRECT" == 'https://trackmyrmc.com/kyc/return' ]] || { echo 'Unapproved KYC redirect URL' >&2; exit 1; }
  [[ -n "$KYC_API_KEY" && -n "$KYC_API_SECRET" ]] || { echo 'Missing server-side KYC credentials' >&2; exit 1; }
  for value in "$KYC_API_KEY" "$KYC_API_SECRET"; do
    [[ ${#value} -le 4096 && "$value" != *

aws s3 cp "s3://$BUCKET/backend-$RELEASE_SHA" "/opt/trackmyrmc/releases/backend-$RELEASE_SHA"
aws s3 cp "s3://$BUCKET/frontend-$RELEASE_SHA.tgz" "$DEPLOY_CACHE_DIR/frontend-$RELEASE_SHA.tgz"
aws s3 cp "s3://$BUCKET/source-$RELEASE_SHA.tgz" "$DEPLOY_CACHE_DIR/source-$RELEASE_SHA.tgz"
aws s3 cp "s3://$BUCKET/admin-web-$RELEASE_SHA.tgz" "$DEPLOY_CACHE_DIR/admin-web-$RELEASE_SHA.tgz"
chmod 0755 "/opt/trackmyrmc/releases/backend-$RELEASE_SHA"

rm -rf /opt/trackmyrmc/frontend.new
mkdir /opt/trackmyrmc/frontend.new
tar -xzf "$DEPLOY_CACHE_DIR/frontend-$RELEASE_SHA.tgz" -C /opt/trackmyrmc/frontend.new --strip-components=1
rm -rf /opt/trackmyrmc/frontend.prev
if [ -d /opt/trackmyrmc/frontend ]; then mv /opt/trackmyrmc/frontend /opt/trackmyrmc/frontend.prev; fi
mv /opt/trackmyrmc/frontend.new /opt/trackmyrmc/frontend

# Keep a complete, SHA-pinned source checkout and the separately built admin dashboard on EC2.
rm -rf /opt/trackmyrmc/source.new
install -d -o trackmyrmc -g trackmyrmc /opt/trackmyrmc/source.new
tar -xzf "$DEPLOY_CACHE_DIR/source-$RELEASE_SHA.tgz" -C /opt/trackmyrmc/source.new
test -f /opt/trackmyrmc/source.new/backend/Cargo.toml
test -f /opt/trackmyrmc/source.new/frontend/package.json
test -f /opt/trackmyrmc/source.new/admin-web/package.json
if [ -d /opt/trackmyrmc/source ]; then
  rm -rf /opt/trackmyrmc/source.prev
  mv /opt/trackmyrmc/source /opt/trackmyrmc/source.prev
fi
mv /opt/trackmyrmc/source.new /opt/trackmyrmc/source


# Install the lightweight, local-only RDS rotation health watch. No new AWS
# infrastructure is created. Secrets Manager is queried only if /health fails.
test -x "$(command -v psql)"
install -d -m 0755 /opt/trackmyrmc/release-tools
install -m 0755 /opt/trackmyrmc/source/ops/release/recover-managed-rds-credential.py \
    /opt/trackmyrmc/release-tools/recover-managed-rds-credential.py
python3 -m py_compile /opt/trackmyrmc/release-tools/recover-managed-rds-credential.py

cat > /etc/systemd/system/trackmyrmc-rds-recovery.service <<'ROTATION_SERVICE'
[Unit]
Description=TrackMyRMC RDS managed-secret rotation health recovery
After=network-online.target trackmyrmc-backend.service
Wants=network-online.target
ConditionPathExists=/etc/trackmyrmc/app.env

[Service]
Type=oneshot
User=root
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ExecStart=/usr/bin/python3 /opt/trackmyrmc/release-tools/recover-managed-rds-credential.py
ROTATION_SERVICE

cat > /etc/systemd/system/trackmyrmc-rds-recovery.timer <<'ROTATION_TIMER'
[Unit]
Description=Local TrackMyRMC database health check and rotation recovery

[Timer]
OnBootSec=2min
OnUnitInactiveSec=1min
AccuracySec=15s
Persistent=false
Unit=trackmyrmc-rds-recovery.service

[Install]
WantedBy=timers.target
ROTATION_TIMER


rm -rf /opt/trackmyrmc/admin-web.new
install -d -o trackmyrmc -g trackmyrmc /opt/trackmyrmc/admin-web.new
tar -xzf "$DEPLOY_CACHE_DIR/admin-web-$RELEASE_SHA.tgz" -C /opt/trackmyrmc/admin-web.new
test -s /opt/trackmyrmc/admin-web.new/index.html
if [ -d /opt/trackmyrmc/admin-web ]; then
  rm -rf /opt/trackmyrmc/admin-web.prev
  mv /opt/trackmyrmc/admin-web /opt/trackmyrmc/admin-web.prev
fi
mv /opt/trackmyrmc/admin-web.new /opt/trackmyrmc/admin-web

# Safe cleanup of extracted release archives from deploy cache
cleanup_release_archives
find "$DEPLOY_CACHE_DIR" -maxdepth 1 -name '*.tgz' -type f -mtime +1 -delete 2>/dev/null || true

printf '%s\n' "$RELEASE_SHA" > /opt/trackmyrmc/DEPLOYED_RELEASE_SHA

install -d -m 0750 /etc/trackmyrmc
cat > /etc/trackmyrmc/app.env <<EOF
APP_ENV=production
DATABASE_URL=$DATABASE_URL
JWT_SECRET=$JWT_SECRET
OTP_PEPPER=$OTP_PEPPER
JWT_EXPIRATION_HOURS=72
PORT=8000
HOST=127.0.0.1
CORS_ORIGIN=https://trackmyrmc.com,https://www.trackmyrmc.com
RUST_LOG=info
OTP_EXPIRATION_MINUTES=5
OTP_COOLDOWN_SECONDS=60
OTP_MAX_ATTEMPTS=5
META_WHATSAPP_TOKEN=$META_TOKEN
META_PHONE_NUMBER_ID=$META_PHONE
META_WABA_ID=$META_WABA
META_GRAPH_API_VERSION=$META_GRAPH_API_VERSION
PLAY_SIGNING_SHA256=$PLAY_SIGNING_SHA256
PLAY_REVIEW_ACCESS_CODE=$PLAY_REVIEW_ACCESS_CODE
GOOGLE_PLACES_API_KEY=$GOOGLE_PLACES_API_KEY
TRACKMYRMC_KYC_ENABLED=$TRACKMYRMC_KYC_ENABLED
TRACKMYRMC_KYC_ENV=$TRACKMYRMC_KYC_ENV
KYC_API_KEY=$KYC_API_KEY
KYC_API_SECRET=$KYC_API_SECRET
EMAIL_API_KEY=$EMAIL_KEY
EMAIL_FROM_ADDRESS=$EMAIL_FROM
EOF
chmod 0600 /etc/trackmyrmc/app.env

cat > /etc/systemd/system/trackmyrmc-backend.service <<'UNIT'
[Unit]
Description=TrackMyRMC Rust Backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=trackmyrmc
Group=trackmyrmc
WorkingDirectory=/opt/trackmyrmc
EnvironmentFile=/etc/trackmyrmc/app.env
ExecStart=/opt/trackmyrmc/releases/backend-PLACEHOLDER
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
UNIT
sed -i "s/backend-PLACEHOLDER/backend-$RELEASE_SHA/" /etc/systemd/system/trackmyrmc-backend.service

chown -R trackmyrmc:trackmyrmc /opt/trackmyrmc

systemctl daemon-reload
systemctl enable trackmyrmc-backend
systemctl restart trackmyrmc-backend
systemctl enable --now trackmyrmc-rds-recovery.timer
systemctl is-enabled --quiet trackmyrmc-rds-recovery.timer
systemctl is-active --quiet trackmyrmc-rds-recovery.timer
systemctl enable nginx
systemctl restart nginx
if systemctl list-unit-files certbot.timer --no-legend | grep -q certbot.timer; then
    systemctl enable --now certbot.timer
fi

# Allow the backend time to start, but fail clearly if it never becomes healthy.
health_ok=0
for attempt in $(seq 1 15); do
    if curl --resolve trackmyrmc.com:443:127.0.0.1 --fail --silent --show-error https://trackmyrmc.com/health; then
        health_ok=1
        break
    fi
    if [ "$attempt" -lt 15 ]; then
        echo "Backend health check attempt $attempt/15 failed; retrying in 2 seconds..."
        sleep 2
    fi
done
if [ "$health_ok" -ne 1 ]; then
    echo "ERROR: TrackMyRMC backend did not become healthy after 15 attempts." >&2
    systemctl --no-pager --full status trackmyrmc-backend || true
    journalctl -u trackmyrmc-backend -n 100 --no-pager || true
    exit 1
fi
curl --resolve trackmyrmc.com:443:127.0.0.1 --fail --silent --show-error https://trackmyrmc.com/healthz
curl --resolve trackmyrmc.com:443:127.0.0.1 --fail --silent --show-error https://trackmyrmc.com/ | grep -F '_expo/static/' >/dev/null

# Verify the separate admin SPA and one real JavaScript asset before reporting
# a successful deployment; this catches Nginx alias/index regressions.
ADMIN_HTML="$(curl --resolve trackmyrmc.com:443:127.0.0.1 --fail --silent --show-error https://trackmyrmc.com/admin/)"
ADMIN_JS="$(printf '%s' "$ADMIN_HTML" | grep -Eo 'src="/admin/assets/[^"]+\.js"' | head -n 1 | cut -d '"' -f 2)"
test -n "$ADMIN_JS"
curl --resolve trackmyrmc.com:443:127.0.0.1 --fail --silent --show-error "https://trackmyrmc.com$ADMIN_JS" >/dev/null

echo "TrackMyRMC deployment successful: $RELEASE_SHA"
\\n'* && "$value" != *

aws s3 cp "s3://$BUCKET/backend-$RELEASE_SHA" "/opt/trackmyrmc/releases/backend-$RELEASE_SHA"
aws s3 cp "s3://$BUCKET/frontend-$RELEASE_SHA.tgz" "$DEPLOY_CACHE_DIR/frontend-$RELEASE_SHA.tgz"
aws s3 cp "s3://$BUCKET/source-$RELEASE_SHA.tgz" "$DEPLOY_CACHE_DIR/source-$RELEASE_SHA.tgz"
aws s3 cp "s3://$BUCKET/admin-web-$RELEASE_SHA.tgz" "$DEPLOY_CACHE_DIR/admin-web-$RELEASE_SHA.tgz"
chmod 0755 "/opt/trackmyrmc/releases/backend-$RELEASE_SHA"

rm -rf /opt/trackmyrmc/frontend.new
mkdir /opt/trackmyrmc/frontend.new
tar -xzf "$DEPLOY_CACHE_DIR/frontend-$RELEASE_SHA.tgz" -C /opt/trackmyrmc/frontend.new --strip-components=1
rm -rf /opt/trackmyrmc/frontend.prev
if [ -d /opt/trackmyrmc/frontend ]; then mv /opt/trackmyrmc/frontend /opt/trackmyrmc/frontend.prev; fi
mv /opt/trackmyrmc/frontend.new /opt/trackmyrmc/frontend

# Keep a complete, SHA-pinned source checkout and the separately built admin dashboard on EC2.
rm -rf /opt/trackmyrmc/source.new
install -d -o trackmyrmc -g trackmyrmc /opt/trackmyrmc/source.new
tar -xzf "$DEPLOY_CACHE_DIR/source-$RELEASE_SHA.tgz" -C /opt/trackmyrmc/source.new
test -f /opt/trackmyrmc/source.new/backend/Cargo.toml
test -f /opt/trackmyrmc/source.new/frontend/package.json
test -f /opt/trackmyrmc/source.new/admin-web/package.json
if [ -d /opt/trackmyrmc/source ]; then
  rm -rf /opt/trackmyrmc/source.prev
  mv /opt/trackmyrmc/source /opt/trackmyrmc/source.prev
fi
mv /opt/trackmyrmc/source.new /opt/trackmyrmc/source


# Install the lightweight, local-only RDS rotation health watch. No new AWS
# infrastructure is created. Secrets Manager is queried only if /health fails.
test -x "$(command -v psql)"
install -d -m 0755 /opt/trackmyrmc/release-tools
install -m 0755 /opt/trackmyrmc/source/ops/release/recover-managed-rds-credential.py \
    /opt/trackmyrmc/release-tools/recover-managed-rds-credential.py
python3 -m py_compile /opt/trackmyrmc/release-tools/recover-managed-rds-credential.py

cat > /etc/systemd/system/trackmyrmc-rds-recovery.service <<'ROTATION_SERVICE'
[Unit]
Description=TrackMyRMC RDS managed-secret rotation health recovery
After=network-online.target trackmyrmc-backend.service
Wants=network-online.target
ConditionPathExists=/etc/trackmyrmc/app.env

[Service]
Type=oneshot
User=root
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ExecStart=/usr/bin/python3 /opt/trackmyrmc/release-tools/recover-managed-rds-credential.py
ROTATION_SERVICE

cat > /etc/systemd/system/trackmyrmc-rds-recovery.timer <<'ROTATION_TIMER'
[Unit]
Description=Local TrackMyRMC database health check and rotation recovery

[Timer]
OnBootSec=2min
OnUnitInactiveSec=1min
AccuracySec=15s
Persistent=false
Unit=trackmyrmc-rds-recovery.service

[Install]
WantedBy=timers.target
ROTATION_TIMER


rm -rf /opt/trackmyrmc/admin-web.new
install -d -o trackmyrmc -g trackmyrmc /opt/trackmyrmc/admin-web.new
tar -xzf "$DEPLOY_CACHE_DIR/admin-web-$RELEASE_SHA.tgz" -C /opt/trackmyrmc/admin-web.new
test -s /opt/trackmyrmc/admin-web.new/index.html
if [ -d /opt/trackmyrmc/admin-web ]; then
  rm -rf /opt/trackmyrmc/admin-web.prev
  mv /opt/trackmyrmc/admin-web /opt/trackmyrmc/admin-web.prev
fi
mv /opt/trackmyrmc/admin-web.new /opt/trackmyrmc/admin-web

# Safe cleanup of extracted release archives from deploy cache
cleanup_release_archives
find "$DEPLOY_CACHE_DIR" -maxdepth 1 -name '*.tgz' -type f -mtime +1 -delete 2>/dev/null || true

printf '%s\n' "$RELEASE_SHA" > /opt/trackmyrmc/DEPLOYED_RELEASE_SHA

install -d -m 0750 /etc/trackmyrmc
cat > /etc/trackmyrmc/app.env <<EOF
APP_ENV=production
DATABASE_URL=$DATABASE_URL
JWT_SECRET=$JWT_SECRET
OTP_PEPPER=$OTP_PEPPER
JWT_EXPIRATION_HOURS=72
PORT=8000
HOST=127.0.0.1
CORS_ORIGIN=https://trackmyrmc.com,https://www.trackmyrmc.com
RUST_LOG=info
OTP_EXPIRATION_MINUTES=5
OTP_COOLDOWN_SECONDS=60
OTP_MAX_ATTEMPTS=5
META_WHATSAPP_TOKEN=$META_TOKEN
META_PHONE_NUMBER_ID=$META_PHONE
META_WABA_ID=$META_WABA
META_GRAPH_API_VERSION=$META_GRAPH_API_VERSION
PLAY_SIGNING_SHA256=$PLAY_SIGNING_SHA256
PLAY_REVIEW_ACCESS_CODE=$PLAY_REVIEW_ACCESS_CODE
GOOGLE_PLACES_API_KEY=$GOOGLE_PLACES_API_KEY
EMAIL_API_KEY=$EMAIL_KEY
EMAIL_FROM_ADDRESS=$EMAIL_FROM
EOF
chmod 0600 /etc/trackmyrmc/app.env

cat > /etc/systemd/system/trackmyrmc-backend.service <<'UNIT'
[Unit]
Description=TrackMyRMC Rust Backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=trackmyrmc
Group=trackmyrmc
WorkingDirectory=/opt/trackmyrmc
EnvironmentFile=/etc/trackmyrmc/app.env
ExecStart=/opt/trackmyrmc/releases/backend-PLACEHOLDER
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
UNIT
sed -i "s/backend-PLACEHOLDER/backend-$RELEASE_SHA/" /etc/systemd/system/trackmyrmc-backend.service

chown -R trackmyrmc:trackmyrmc /opt/trackmyrmc

systemctl daemon-reload
systemctl enable trackmyrmc-backend
systemctl restart trackmyrmc-backend
systemctl enable --now trackmyrmc-rds-recovery.timer
systemctl is-enabled --quiet trackmyrmc-rds-recovery.timer
systemctl is-active --quiet trackmyrmc-rds-recovery.timer
systemctl enable nginx
systemctl restart nginx
if systemctl list-unit-files certbot.timer --no-legend | grep -q certbot.timer; then
    systemctl enable --now certbot.timer
fi

# Allow the backend time to start, but fail clearly if it never becomes healthy.
health_ok=0
for attempt in $(seq 1 15); do
    if curl --resolve trackmyrmc.com:443:127.0.0.1 --fail --silent --show-error https://trackmyrmc.com/health; then
        health_ok=1
        break
    fi
    if [ "$attempt" -lt 15 ]; then
        echo "Backend health check attempt $attempt/15 failed; retrying in 2 seconds..."
        sleep 2
    fi
done
if [ "$health_ok" -ne 1 ]; then
    echo "ERROR: TrackMyRMC backend did not become healthy after 15 attempts." >&2
    systemctl --no-pager --full status trackmyrmc-backend || true
    journalctl -u trackmyrmc-backend -n 100 --no-pager || true
    exit 1
fi
curl --resolve trackmyrmc.com:443:127.0.0.1 --fail --silent --show-error https://trackmyrmc.com/healthz
curl --resolve trackmyrmc.com:443:127.0.0.1 --fail --silent --show-error https://trackmyrmc.com/ | grep -F '_expo/static/' >/dev/null

# Verify the separate admin SPA and one real JavaScript asset before reporting
# a successful deployment; this catches Nginx alias/index regressions.
ADMIN_HTML="$(curl --resolve trackmyrmc.com:443:127.0.0.1 --fail --silent --show-error https://trackmyrmc.com/admin/)"
ADMIN_JS="$(printf '%s' "$ADMIN_HTML" | grep -Eo 'src="/admin/assets/[^"]+\.js"' | head -n 1 | cut -d '"' -f 2)"
test -n "$ADMIN_JS"
curl --resolve trackmyrmc.com:443:127.0.0.1 --fail --silent --show-error "https://trackmyrmc.com$ADMIN_JS" >/dev/null

echo "TrackMyRMC deployment successful: $RELEASE_SHA"
\\r'* ]] || { echo 'Invalid KYC credential encoding' >&2; exit 1; }
  done
fi


aws s3 cp "s3://$BUCKET/backend-$RELEASE_SHA" "/opt/trackmyrmc/releases/backend-$RELEASE_SHA"
aws s3 cp "s3://$BUCKET/frontend-$RELEASE_SHA.tgz" "$DEPLOY_CACHE_DIR/frontend-$RELEASE_SHA.tgz"
aws s3 cp "s3://$BUCKET/source-$RELEASE_SHA.tgz" "$DEPLOY_CACHE_DIR/source-$RELEASE_SHA.tgz"
aws s3 cp "s3://$BUCKET/admin-web-$RELEASE_SHA.tgz" "$DEPLOY_CACHE_DIR/admin-web-$RELEASE_SHA.tgz"
chmod 0755 "/opt/trackmyrmc/releases/backend-$RELEASE_SHA"

rm -rf /opt/trackmyrmc/frontend.new
mkdir /opt/trackmyrmc/frontend.new
tar -xzf "$DEPLOY_CACHE_DIR/frontend-$RELEASE_SHA.tgz" -C /opt/trackmyrmc/frontend.new --strip-components=1
rm -rf /opt/trackmyrmc/frontend.prev
if [ -d /opt/trackmyrmc/frontend ]; then mv /opt/trackmyrmc/frontend /opt/trackmyrmc/frontend.prev; fi
mv /opt/trackmyrmc/frontend.new /opt/trackmyrmc/frontend

# Keep a complete, SHA-pinned source checkout and the separately built admin dashboard on EC2.
rm -rf /opt/trackmyrmc/source.new
install -d -o trackmyrmc -g trackmyrmc /opt/trackmyrmc/source.new
tar -xzf "$DEPLOY_CACHE_DIR/source-$RELEASE_SHA.tgz" -C /opt/trackmyrmc/source.new
test -f /opt/trackmyrmc/source.new/backend/Cargo.toml
test -f /opt/trackmyrmc/source.new/frontend/package.json
test -f /opt/trackmyrmc/source.new/admin-web/package.json
if [ -d /opt/trackmyrmc/source ]; then
  rm -rf /opt/trackmyrmc/source.prev
  mv /opt/trackmyrmc/source /opt/trackmyrmc/source.prev
fi
mv /opt/trackmyrmc/source.new /opt/trackmyrmc/source


# Install the lightweight, local-only RDS rotation health watch. No new AWS
# infrastructure is created. Secrets Manager is queried only if /health fails.
test -x "$(command -v psql)"
install -d -m 0755 /opt/trackmyrmc/release-tools
install -m 0755 /opt/trackmyrmc/source/ops/release/recover-managed-rds-credential.py \
    /opt/trackmyrmc/release-tools/recover-managed-rds-credential.py
python3 -m py_compile /opt/trackmyrmc/release-tools/recover-managed-rds-credential.py

cat > /etc/systemd/system/trackmyrmc-rds-recovery.service <<'ROTATION_SERVICE'
[Unit]
Description=TrackMyRMC RDS managed-secret rotation health recovery
After=network-online.target trackmyrmc-backend.service
Wants=network-online.target
ConditionPathExists=/etc/trackmyrmc/app.env

[Service]
Type=oneshot
User=root
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ExecStart=/usr/bin/python3 /opt/trackmyrmc/release-tools/recover-managed-rds-credential.py
ROTATION_SERVICE

cat > /etc/systemd/system/trackmyrmc-rds-recovery.timer <<'ROTATION_TIMER'
[Unit]
Description=Local TrackMyRMC database health check and rotation recovery

[Timer]
OnBootSec=2min
OnUnitInactiveSec=1min
AccuracySec=15s
Persistent=false
Unit=trackmyrmc-rds-recovery.service

[Install]
WantedBy=timers.target
ROTATION_TIMER


rm -rf /opt/trackmyrmc/admin-web.new
install -d -o trackmyrmc -g trackmyrmc /opt/trackmyrmc/admin-web.new
tar -xzf "$DEPLOY_CACHE_DIR/admin-web-$RELEASE_SHA.tgz" -C /opt/trackmyrmc/admin-web.new
test -s /opt/trackmyrmc/admin-web.new/index.html
if [ -d /opt/trackmyrmc/admin-web ]; then
  rm -rf /opt/trackmyrmc/admin-web.prev
  mv /opt/trackmyrmc/admin-web /opt/trackmyrmc/admin-web.prev
fi
mv /opt/trackmyrmc/admin-web.new /opt/trackmyrmc/admin-web

# Safe cleanup of extracted release archives from deploy cache
cleanup_release_archives
find "$DEPLOY_CACHE_DIR" -maxdepth 1 -name '*.tgz' -type f -mtime +1 -delete 2>/dev/null || true

printf '%s\n' "$RELEASE_SHA" > /opt/trackmyrmc/DEPLOYED_RELEASE_SHA

install -d -m 0750 /etc/trackmyrmc
cat > /etc/trackmyrmc/app.env <<EOF
APP_ENV=production
DATABASE_URL=$DATABASE_URL
JWT_SECRET=$JWT_SECRET
OTP_PEPPER=$OTP_PEPPER
JWT_EXPIRATION_HOURS=72
PORT=8000
HOST=127.0.0.1
CORS_ORIGIN=https://trackmyrmc.com,https://www.trackmyrmc.com
RUST_LOG=info
OTP_EXPIRATION_MINUTES=5
OTP_COOLDOWN_SECONDS=60
OTP_MAX_ATTEMPTS=5
META_WHATSAPP_TOKEN=$META_TOKEN
META_PHONE_NUMBER_ID=$META_PHONE
META_WABA_ID=$META_WABA
META_GRAPH_API_VERSION=$META_GRAPH_API_VERSION
PLAY_SIGNING_SHA256=$PLAY_SIGNING_SHA256
PLAY_REVIEW_ACCESS_CODE=$PLAY_REVIEW_ACCESS_CODE
GOOGLE_PLACES_API_KEY=$GOOGLE_PLACES_API_KEY
EMAIL_API_KEY=$EMAIL_KEY
EMAIL_FROM_ADDRESS=$EMAIL_FROM
EOF
chmod 0600 /etc/trackmyrmc/app.env

cat > /etc/systemd/system/trackmyrmc-backend.service <<'UNIT'
[Unit]
Description=TrackMyRMC Rust Backend
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=trackmyrmc
Group=trackmyrmc
WorkingDirectory=/opt/trackmyrmc
EnvironmentFile=/etc/trackmyrmc/app.env
ExecStart=/opt/trackmyrmc/releases/backend-PLACEHOLDER
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
UNIT
sed -i "s/backend-PLACEHOLDER/backend-$RELEASE_SHA/" /etc/systemd/system/trackmyrmc-backend.service

chown -R trackmyrmc:trackmyrmc /opt/trackmyrmc

systemctl daemon-reload
systemctl enable trackmyrmc-backend
systemctl restart trackmyrmc-backend
systemctl enable --now trackmyrmc-rds-recovery.timer
systemctl is-enabled --quiet trackmyrmc-rds-recovery.timer
systemctl is-active --quiet trackmyrmc-rds-recovery.timer
systemctl enable nginx
systemctl restart nginx
if systemctl list-unit-files certbot.timer --no-legend | grep -q certbot.timer; then
    systemctl enable --now certbot.timer
fi

# Allow the backend time to start, but fail clearly if it never becomes healthy.
health_ok=0
for attempt in $(seq 1 15); do
    if curl --resolve trackmyrmc.com:443:127.0.0.1 --fail --silent --show-error https://trackmyrmc.com/health; then
        health_ok=1
        break
    fi
    if [ "$attempt" -lt 15 ]; then
        echo "Backend health check attempt $attempt/15 failed; retrying in 2 seconds..."
        sleep 2
    fi
done
if [ "$health_ok" -ne 1 ]; then
    echo "ERROR: TrackMyRMC backend did not become healthy after 15 attempts." >&2
    systemctl --no-pager --full status trackmyrmc-backend || true
    journalctl -u trackmyrmc-backend -n 100 --no-pager || true
    exit 1
fi
curl --resolve trackmyrmc.com:443:127.0.0.1 --fail --silent --show-error https://trackmyrmc.com/healthz
curl --resolve trackmyrmc.com:443:127.0.0.1 --fail --silent --show-error https://trackmyrmc.com/ | grep -F '_expo/static/' >/dev/null

# Verify the separate admin SPA and one real JavaScript asset before reporting
# a successful deployment; this catches Nginx alias/index regressions.
ADMIN_HTML="$(curl --resolve trackmyrmc.com:443:127.0.0.1 --fail --silent --show-error https://trackmyrmc.com/admin/)"
ADMIN_JS="$(printf '%s' "$ADMIN_HTML" | grep -Eo 'src="/admin/assets/[^"]+\.js"' | head -n 1 | cut -d '"' -f 2)"
test -n "$ADMIN_JS"
curl --resolve trackmyrmc.com:443:127.0.0.1 --fail --silent --show-error "https://trackmyrmc.com$ADMIN_JS" >/dev/null

echo "TrackMyRMC deployment successful: $RELEASE_SHA"
