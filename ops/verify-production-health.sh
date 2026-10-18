#!/usr/bin/env bash
# Verify Cloudflare's public edge without bypassing site security, then verify
# the exact deployed release and web/API assets through the trusted EC2 origin.
set -euo pipefail

: "${AWS_REGION:?Missing AWS_REGION}"
: "${INSTANCE_ID:?Missing INSTANCE_ID}"
: "${RELEASE_SHA:?Missing RELEASE_SHA}"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid release SHA' >&2; exit 1; }

BASE_URL='https://trackmyrmc.com'
probe_dir="$(mktemp -d)"
trap 'rm -rf "$probe_dir"' EXIT

# A security challenge to a non-browser runner is not an application failure.
# Only accept that exact Cloudflare challenge as the public-edge exception.
# Any other public HTTP error or network failure remains a deployment failure.
public_status="$(curl --retry 2 --retry-delay 2 --connect-timeout 10 --max-time 25 \
  -sS -D "$probe_dir/headers" -o "$probe_dir/body" -w '%{http_code}' \
  "$BASE_URL/health")" || {
  echo 'Public health request failed due to transport/network error.' >&2
  exit 1
}
if [[ "$public_status" == '200' ]]; then
  jq -e '.status == "ok" and .database == "connected"' "$probe_dir/body" >/dev/null || {
    echo 'Public health returned 200 without a healthy JSON payload.' >&2
    exit 1
  }
  echo 'Public Cloudflare-edge health: 200, application and database healthy.'
elif [[ "$public_status" == '403' ]] && \
     grep -Eiq '^cf-mitigated:[[:space:]]*challenge[[:space:]]*$' "$probe_dir/headers" && \
     grep -Eiq '^server:[[:space:]]*cloudflare[[:space:]]*$' "$probe_dir/headers"; then
  echo '::warning::Cloudflare challenged the GitHub Actions CLI probe (HTTP 403, cf-mitigated: challenge).'
  echo '::warning::The public edge remains independently unverified for this runner; validating the exact release through trusted EC2 origin.'
else
  echo "Public health failure: HTTP $public_status; not an identifiable Cloudflare security challenge." >&2
  sed -n '1,18p' "$probe_dir/headers" >&2
  exit 1
fi

# Deploy was performed via AWS SSM; verify it again, independently, with TLS
# Host/SNI validation, but without passing through Cloudflare's bot challenge.
ORIGIN_SCRIPT="$(cat <<'REMOTE'
set -euo pipefail
service='trackmyrmc-backend.service'
[[ "$(systemctl is-active "$service")" == 'active' ]] || { echo 'Backend service not active' >&2; exit 1; }
exec_line="$(systemctl show "$service" -p ExecStart --value)"
[[ "$exec_line" == *"/opt/trackmyrmc/releases/backend-${EXPECTED_SHA}"* ]] || {
  echo 'Running backend release does not match verified main commit' >&2
  exit 1
}
base='https://trackmyrmc.com'
curl_opts=(--fail --silent --show-error --max-time 15 --resolve 'trackmyrmc.com:443:127.0.0.1')
health="$(curl "${curl_opts[@]}" "$base/health")"
if ! printf '%s' "$health" | jq -e '.status == "ok" and .database == "connected"' >/dev/null; then
  echo 'Origin health JSON is not healthy' >&2
  exit 1
fi
healthz="$(curl "${curl_opts[@]}" "$base/healthz")"
[[ "$healthz" == 'ok' ]] || { echo 'Origin /healthz mismatch' >&2; exit 1; }
home_html="$(curl "${curl_opts[@]}" "$base/")"
[[ "$home_html" == *'_expo/static/'* ]] || { echo 'Expo bundle missing at origin' >&2; exit 1; }
admin_html="$(curl "${curl_opts[@]}" "$base/admin/")"
if [[ "$admin_html" =~ src=\"(/admin/assets/[^\"]+\.js)\" ]]; then
  admin_js="${BASH_REMATCH[1]}"
else
  echo 'Admin JS asset reference missing' >&2
  exit 1
fi
curl "${curl_opts[@]}" -o /dev/null "$base$admin_js"
echo "Trusted origin verification passed: release $EXPECTED_SHA, API, Expo and admin asset."
REMOTE
)"
# AWS-RunShellScript invokes /bin/sh by default. Explicitly launch Bash:
# array arguments and [[ ... ]] are used in the trusted-origin assertions.
REMOTE_COMMAND="bash <<'TRACKMYRMC_ORIGIN_CHECK'"$'\n'"EXPECTED_SHA='${RELEASE_SHA}'"$'\n'"$ORIGIN_SCRIPT"$'\n''TRACKMYRMC_ORIGIN_CHECK'
PARAMS="$(jq -nc --arg command "$REMOTE_COMMAND" '{commands: [$command]}')"
COMMAND_ID="$(aws ssm send-command \
  --region "$AWS_REGION" \
  --instance-ids "$INSTANCE_ID" \
  --document-name 'AWS-RunShellScript' \
  --comment 'Verify TrackMyRMC pinned production release at trusted origin' \
  --parameters "$PARAMS" \
  --query 'Command.CommandId' --output text)"

# Retrieve full result even if the remote operation fails, and do not log secrets.
aws ssm wait command-executed --region "$AWS_REGION" \
  --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" || true
INVOCATION="$(aws ssm get-command-invocation --region "$AWS_REGION" \
  --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --output json)"
STATUS="$(jq -r '.Status // "Unknown"' <<< "$INVOCATION")"
jq -r '.StandardOutputContent // ""' <<< "$INVOCATION"
if [[ "$STATUS" != 'Success' ]]; then
  jq -r '.StandardErrorContent // ""' <<< "$INVOCATION" >&2
  echo "Trusted origin health verification failed: $STATUS" >&2
  exit 1
fi

echo 'Production verification passed: trusted origin healthy and Cloudflare edge classified.'
