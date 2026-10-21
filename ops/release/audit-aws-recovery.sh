#!/usr/bin/env bash
# Read-only release recovery evidence: RDS Describe + EC2 runtime database name.
# Does not snapshot, restore, migrate, modify RDS or deploy application code.
set -euo pipefail

REGION="$(printenv AWS_REGION || echo ap-south-1)"
EC2="$(printenv TRACKMYRMC_EC2_INSTANCE_ID || echo i-0598aad6e6d729c69)"
RDS="$(printenv TRACKMYRMC_RDS_INSTANCE_ID || echo trackmyrmc-postgres)"
EXPECTED_DB="$(printenv TRACKMYRMC_EXPECTED_DATABASE || echo trackmyrmc)"
if (( $# > 1 )); then
  echo "At most one restore evidence path is accepted" >&2
  exit 2
fi
EVIDENCE=""
if (( $# == 1 )); then EVIDENCE="$1"; fi
HERE="$(cd "$(dirname "$0")" && pwd)"
for tool in aws jq python3; do
  command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 2; }
done
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
aws rds describe-db-instances --region "$REGION" \
  --db-instance-identifier "$RDS" --output json > "$TEMP/rds.json"
aws rds describe-db-snapshots --region "$REGION" \
  --db-instance-identifier "$RDS" --snapshot-type manual \
  --output json > "$TEMP/snapshots.json"

# SSM command outputs only the database name. It cannot print credentials.
REMOTE="$(cat <<'PY'
python3 - <<'INNER'
from pathlib import Path
from urllib.parse import unquote, urlsplit
lines = Path("/etc/trackmyrmc/app.env").read_text(encoding="utf-8").splitlines()
values = [line.split("=", 1)[1].strip() for line in lines if line.startswith("DATABASE_URL=")]
if len(values) != 1:
    raise SystemExit("Exactly one runtime DATABASE_URL required")
parsed = urlsplit(values[0].strip().strip('"').strip("'"))
name = unquote(parsed.path.lstrip("/"))
if parsed.scheme not in ("postgres", "postgresql") or not parsed.hostname or not name or "/" in name:
    raise SystemExit("Invalid runtime PostgreSQL configuration")
print(name)
INNER
PY
)"
PARAMS="$(jq -cn --arg command "$REMOTE" '{commands:[$command]}')"
COMMAND="$(aws ssm send-command --region "$REGION" \
  --instance-ids "$EC2" --document-name AWS-RunShellScript \
  --comment 'TrackMyRMC read-only database-name audit; no secrets' \
  --parameters "$PARAMS" --query 'Command.CommandId' --output text)"
aws ssm wait command-executed --region "$REGION" \
  --command-id "$COMMAND" --instance-id "$EC2"
aws ssm get-command-invocation --region "$REGION" \
  --command-id "$COMMAND" --instance-id "$EC2" --output json > "$TEMP/ssm.json"
test "$(jq -r .Status "$TEMP/ssm.json")" = Success || {
  echo "Unable to establish runtime DB identity" >&2; exit 2;
}
RUNTIME_DB="$(jq -r '.StandardOutputContent // ""' "$TEMP/ssm.json" | tr -d '\r\n')"
[[ "$RUNTIME_DB" =~ ^[A-Za-z0-9_]+$ ]] || {
  echo "Unexpected runtime DB name; refusing assessment" >&2; exit 2;
}
args=(--rds-json "$TEMP/rds.json" --snapshots-json "$TEMP/snapshots.json"
      --runtime-db "$RUNTIME_DB" --instance "$RDS" --expected-db "$EXPECTED_DB")
if [[ -n "$EVIDENCE" ]]; then
  args+=(--restore-evidence "$EVIDENCE")
fi
python3 "$HERE/recovery_gate.py" "${args[@]}"
