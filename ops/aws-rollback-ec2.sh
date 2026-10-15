#!/usr/bin/env bash
# Emergency application rollback after an external HTTPS smoke-test failure.
# Restores previous application assets/service configuration ONLY. It does not
# roll back RDS migrations, so backward-compatible schema is a release gate.
set -Eeuo pipefail
: "${RELEASE_SHA:?RELEASE_SHA required}"
[[ "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ ]] || { echo "Invalid release SHA"; exit 1; }
ROLLBACK_DIR="/var/lib/trackmyrmc/release-backups/$RELEASE_SHA"
test -d "$ROLLBACK_DIR" || { echo "No rollback backup for this release"; exit 1; }
CURRENT_SHA="$(cat /opt/trackmyrmc/DEPLOYED_RELEASE_SHA 2>/dev/null || true)"
if [ "$CURRENT_SHA" != "$RELEASE_SHA" ]; then
  echo "Refusing rollback: server no longer runs requested release." >&2
  exit 1
fi
echo "Restoring application backup after failed public smoke check."
for item in frontend admin-web source; do
  if [ -d "$ROLLBACK_DIR/$item" ]; then
    rm -rf "/opt/trackmyrmc/$item"
    cp -a "$ROLLBACK_DIR/$item" "/opt/trackmyrmc/$item"
  fi
done
for pair in \
  "app.env:/etc/trackmyrmc/app.env" \
  "backend.service:/etc/systemd/system/trackmyrmc-backend.service" \
  "nginx.conf:/etc/nginx/sites-available/trackmyrmc" \
  "deployed_sha:/opt/trackmyrmc/DEPLOYED_RELEASE_SHA"; do
  from="${pair%%:*}"
  to="${pair#*:}"
  if [ -f "$ROLLBACK_DIR/$from" ]; then cp -a "$ROLLBACK_DIR/$from" "$to"; fi
done
systemctl daemon-reload
nginx -t
systemctl restart trackmyrmc-backend
systemctl restart nginx
curl --fail --silent --show-error --retry 10 --retry-delay 2 \
  http://127.0.0.1:8000/health >/dev/null
echo "Application rollback completed and local backend health recovered."
