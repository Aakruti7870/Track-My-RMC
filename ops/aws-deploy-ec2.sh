#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_SHA:?RELEASE_SHA is required}"
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
mkdir -p /opt/trackmyrmc/releases /opt/trackmyrmc/frontend

aws s3 cp "s3://$BUCKET/backend-$RELEASE_SHA" "/opt/trackmyrmc/releases/backend-$RELEASE_SHA"
aws s3 cp "s3://$BUCKET/frontend-$RELEASE_SHA.tgz" "/tmp/frontend-$RELEASE_SHA.tgz"
chmod 0755 "/opt/trackmyrmc/releases/backend-$RELEASE_SHA"

rm -rf /opt/trackmyrmc/frontend.new
mkdir /opt/trackmyrmc/frontend.new
tar -xzf "/tmp/frontend-$RELEASE_SHA.tgz" -C /opt/trackmyrmc/frontend.new --strip-components=1
rm -rf /opt/trackmyrmc/frontend.prev
if [ -d /opt/trackmyrmc/frontend ]; then mv /opt/trackmyrmc/frontend /opt/trackmyrmc/frontend.prev; fi
mv /opt/trackmyrmc/frontend.new /opt/trackmyrmc/frontend

APP_JSON="$(aws secretsmanager get-secret-value --secret-id "$APP_SECRET" --query SecretString --output text)"
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
  CURRENT_DB_NAME="$(python3 -c 'from urllib.parse import urlparse; import sys; print(urlparse(next(x.split("=",1)[1].strip() for x in open(sys.argv[1]) if x.startswith("DATABASE_URL="))).path.lstrip("/"))' /etc/trackmyrmc/app.env)"
fi
if [[ -n "$CURRENT_DB_NAME" && "$CURRENT_DB_NAME" != "$DB_NAME" && "${ALLOW_DATABASE_CUTOVER:-false}" != "true" ]]; then
  echo "Database cutover is blocked: runtime currently uses '$CURRENT_DB_NAME' while secret DB_NAME is '$DB_NAME'. Preserving '$CURRENT_DB_NAME' until a verified backup and data/migration parity check authorizes cutover."
  DB_NAME="$CURRENT_DB_NAME"
fi

DB_JSON="$(aws secretsmanager get-secret-value --secret-id "$RDS_SECRET" --query SecretString --output text)"
DATABASE_URL="$(printf '%s' "$DB_JSON" | TRACKMYRMC_DB_NAME="$DB_NAME" python3 -c 'import json,sys,urllib.parse as u,os; x=json.load(sys.stdin); db=os.environ["TRACKMYRMC_DB_NAME"]; print("postgres://%s:%s@trackmyrmc-postgres.cf8mmcwuuinx.ap-south-1.rds.amazonaws.com:5432/%s?sslmode=require"%(u.quote(x["username"],safe=""),u.quote(x["password"],safe=""),u.quote(db,safe="")))')"

JWT_SECRET="$(printf '%s' "$APP_JSON" | jq -r '.JWT_SECRET')"
OTP_PEPPER="$(printf '%s' "$APP_JSON" | jq -r '.OTP_PEPPER')"
META_TOKEN="$(printf '%s' "$APP_JSON" | jq -r '.META_WHATSAPP_TOKEN // empty')"
META_PHONE="$(printf '%s' "$APP_JSON" | jq -r '.META_PHONE_NUMBER_ID // empty')"
META_WABA="$(printf '%s' "$APP_JSON" | jq -r '.META_WABA_ID // empty')"
EMAIL_KEY="$(printf '%s' "$APP_JSON" | jq -r '.EMAIL_API_KEY // empty')"
EMAIL_FROM="$(printf '%s' "$APP_JSON" | jq -r '.EMAIL_FROM_ADDRESS // "noreply@trackmyrmc.com"')"

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
RUST_LOG=info,trackmyrmc_backend=debug
OTP_EXPIRATION_MINUTES=5
OTP_COOLDOWN_SECONDS=60
OTP_MAX_ATTEMPTS=5
META_WHATSAPP_TOKEN=$META_TOKEN
META_PHONE_NUMBER_ID=$META_PHONE
META_WABA_ID=$META_WABA
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

# Bootstrap HTTP virtual host for ACME HTTP-01 validation.
install -d -m 0755 /var/www/certbot/.well-known/acme-challenge
cat > /etc/nginx/sites-available/trackmyrmc <<'NGINX_BOOTSTRAP'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name trackmyrmc.com www.trackmyrmc.com _;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type text/plain;
        try_files $uri =404;
    }

    location / {
        root /opt/trackmyrmc/frontend;
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
    -d trackmyrmc.com -d www.trackmyrmc.com

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
    server_name trackmyrmc.com www.trackmyrmc.com _;

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
    server_name trackmyrmc.com www.trackmyrmc.com;

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
systemctl daemon-reload
systemctl enable trackmyrmc-backend
systemctl restart trackmyrmc-backend
systemctl enable nginx
systemctl restart nginx
if systemctl list-unit-files certbot.timer --no-legend | grep -q certbot.timer; then
    systemctl enable --now certbot.timer
fi

sleep 3
curl --resolve trackmyrmc.com:443:127.0.0.1 --fail --silent --show-error https://trackmyrmc.com/health
curl --resolve trackmyrmc.com:443:127.0.0.1 --fail --silent --show-error https://trackmyrmc.com/healthz
curl --resolve trackmyrmc.com:443:127.0.0.1 --fail --silent --show-error https://trackmyrmc.com/ | grep -F '_expo/static/' >/dev/null

echo "TrackMyRMC deployment successful: $RELEASE_SHA"
