#!/usr/bin/env bash
# Read-only TrackMyRMC production preflight; never disclose env secrets.
set -euo pipefail
marker=/opt/trackmyrmc/DEPLOYED_RELEASE_SHA
app_env=/etc/trackmyrmc/app.env
[[ -f "$marker" && -f "$app_env" ]] || { echo 'FAIL: deployment marker/env missing'; exit 1; }
sha="$(cat "$marker")"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'FAIL: invalid release SHA'; exit 1; }
printf 'RELEASE_SHA=%s\n' "$sha"
for service in trackmyrmc-backend nginx trackmyrmc-rds-recovery.timer; do
    systemctl is-active --quiet "$service" || { echo "FAIL: service $service inactive"; exit 1; }
    printf 'SERVICE_%s=active\n' "$service"
done
set -a
source "$app_env"
set +a
[[ -n "$DATABASE_URL" ]] || { echo 'FAIL: missing database configuration'; exit 1; }
db_name="$(python3 -c 'import os,urllib.parse; print(urllib.parse.unquote(urllib.parse.urlsplit(os.environ["DATABASE_URL"]).path.lstrip("/")))' )"
case "$db_name" in
    postgres|trackmyrmc) printf 'DATABASE_TARGET=%s\n' "$db_name" ;;
    *) echo 'FAIL: unknown database target'; exit 1 ;;
esac
version="$(psql "$DATABASE_URL" -XqtA -v ON_ERROR_STOP=1 -c 'SELECT COALESCE(MAX(version),0) FROM _sqlx_migrations' | tr -d '[:space:]')"
[[ "$version" =~ ^[0-9]+$ && "$version" -ge 40 ]] || { echo 'FAIL: missing KYC migration'; exit 1; }
printf 'SQLX_MAX_VERSION=%s\n' "$version"
printf 'KYC_SWITCH=%s\n' "$(grep '^TRACKMYRMC_KYC_ENABLED=' "$app_env" | cut -d= -f2 || echo false)"
curl --resolve trackmyrmc.com:443:127.0.0.1 --fail --silent --show-error --max-time 20 https://trackmyrmc.com/health | python3 -c 'import json,sys; j=json.load(sys.stdin); assert j.get("status")=="ok" and j.get("database")=="connected"; print("ORIGIN_HEALTH=ok")'
for route in /api/me /api/customer/kyc; do
    code="$(curl --resolve trackmyrmc.com:443:127.0.0.1 --silent --show-error --max-time 15 -o /dev/null -w '%{http_code}' "https://trackmyrmc.com$route")"
    [[ "$code" == 401 || "$code" == 403 ]] || { echo "FAIL: anonymous route $route returned $code"; exit 1; }
done
echo 'INFRA_BASELINE=PASS'
echo 'PUBLIC_LAUNCH=NOT_YET_DETERMINED'
