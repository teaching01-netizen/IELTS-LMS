#!/usr/bin/env bash
# Backup rehearsal (plan E1): restore the latest backup to scratch MySQL
# and prove it boots. A backup that has never restored is not a backup.
#
# Fail-closed: every step aborts non-zero (set -euo pipefail + explicit
# checks). A missing scratch DSN exits non-zero with a message - there is
# no silent skip, so a misconfigured cron goes red instead of green.
# The monthly cron (.github/workflows/backup-rehearsal-cron.yml) documents
# the intentional skip: rehearsals only run on schedule with repository
# secrets present; a manually-triggered run without a scratch DSN fails.
#
# Usage (from the repo root):
#   BACKUP_REHEARSAL_DSN='root:root@tcp(127.0.0.1:3306)/ielts_rehearsal?parseTime=true&multiStatements=true' \
#     bash scripts/backup-rehearsal.sh [--dump=/path/to/dump.sql] [--dir=/tmp/restore]
# Optional: BACKUP_REHEARSAL_DB overrides the scratch database name.
# Optional: PORT / API_PORT sets the probe port (default 4100).
# Env passed to the Go steps (mirrors ci.yml conventions): AUTH_SECRET,
# API_HOST, APP_ENV/ENVIRONMENT, MIGRATIONS_DIR, COOKIE_SECURE,
# SESSION_COOKIE_NAME, CSRF_COOKIE_NAME.
set -euo pipefail

DUMP="${BACKUP_DUMP:-}"
DIR="/tmp/ielts-restore-$$"
for arg in "$@"; do
  case "$arg" in
    --dump=*) DUMP="${arg#--dump=}" ;;
    --dir=*) DIR="${arg#--dir=}" ;;
    --dump|--dir) echo "backup-rehearsal: $arg requires =value" >&2; exit 2 ;;
    --latest) ;;
    *) echo "backup-rehearsal: unknown arg $arg (want --dump=PATH | --dir=PATH | --latest)" >&2; exit 2 ;;
  esac
done

SCRATCH_DSN="${BACKUP_REHEARSAL_DSN:-${DATABASE_URL:-}}"
if [ -z "$SCRATCH_DSN" ]; then
  echo "backup-rehearsal: FAIL-CLOSED: set BACKUP_REHEARSAL_DSN to a scratch MySQL DSN (never production)" >&2
  exit 1
fi
case "$SCRATCH_DSN" in
  *"/prod"*|*"/production"*|*"/ielts"*)
    echo "backup-rehearsal: FAIL-CLOSED: scratch DSN looks like a live database; use a scratch database" >&2
    exit 1
    ;;
esac

GO_DIR="backend/go"
if [ ! -d "$GO_DIR" ]; then
  echo "backup-rehearsal: must run from the repo root (backend/go missing)" >&2
  exit 1
fi
command -v mysql >/dev/null 2>&1 || { echo "backup-rehearsal: mysql client required" >&2; exit 1; }
command -v go >/dev/null 2>&1 || { echo "backup-rehearsal: go toolchain required" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "backup-rehearsal: curl required (readyz probe)" >&2; exit 1; }

mkdir -p "$DIR"
echo "backup-rehearsal: dir=$DIR"

# Scratch connection comes from MYSQL_* env (MYSQL_HOST/PORT/USER/PASSWORD),
# defaulting to the ci.yml MySQL service shape. BACKUP_REHEARSAL_DB names
# the scratch database (default ielts_rehearsal - never the live ielts db).
SCRATCH_DB="${BACKUP_REHEARSAL_DB:-ielts_rehearsal}"
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-root}"
if [ -z "${MYSQL_PASSWORD:-}" ] && [ -z "${MYSQL_PWD:-}" ]; then
  echo "backup-rehearsal: FAIL-CLOSED: set MYSQL_PASSWORD (scratch MySQL password)" >&2
  exit 1
fi
export MYSQL_PWD="${MYSQL_PASSWORD:-${MYSQL_PWD:-}}"
MYSQL_OPTS=(-h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" --protocol=tcp)

# Step 1/3: restore the latest backup into scratch. With --dump=PATH the
# dump is loaded via the mysql client (mysqldump|S3|XtraBackup output);
# otherwise the script verifies the scratch server answers before
# proceeding (the operator pipes the dump tool here).
if [ -n "$DUMP" ]; then
  if [ ! -f "$DUMP" ]; then
    echo "backup-rehearsal: dump not found: $DUMP" >&2
    exit 1
  fi
  echo "backup-rehearsal: step 1/3 - create scratch db + restore $DUMP"
  mysql "${MYSQL_OPTS[@]}" -e "CREATE DATABASE IF NOT EXISTS \`$SCRATCH_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  mysql "${MYSQL_OPTS[@]}" "$SCRATCH_DB" < "$DUMP"
else
  echo "backup-rehearsal: step 1/3 - no --dump given; verifying scratch MySQL answers"
fi
if ! mysql "${MYSQL_OPTS[@]}" -e "SELECT 1" "$SCRATCH_DB" >/dev/null 2>&1; then
  echo "backup-rehearsal: scratch database '$SCRATCH_DB' not reachable; check MYSQL_* env and BACKUP_REHEARSAL_DB" >&2
  exit 1
fi
echo "backup-rehearsal: scratch '$SCRATCH_DB' answers"

# Step 2/3: validate-only migration gate (VerifyRuntimeSchema + pending
# migration report). Applies nothing; exits non-zero on drift.
echo "backup-rehearsal: step 2/3 - migrate --validate-only against scratch"
(cd "$GO_DIR" && \
  DATABASE_URL="$SCRATCH_DSN" \
  AUTH_SECRET="${AUTH_SECRET:-ci-only-secret-with-at-least-32-characters}" \
  API_HOST="${API_HOST:-127.0.0.1}" \
  APP_ENV="${APP_ENV:-${ENVIRONMENT:-test}}" ENVIRONMENT="${ENVIRONMENT:-${APP_ENV:-test}}" \
  MIGRATIONS_DIR="${MIGRATIONS_DIR:-migrations}" \
  COOKIE_SECURE="${COOKIE_SECURE:-false}" SESSION_COOKIE_NAME="${SESSION_COOKIE_NAME:-session}" CSRF_COOKIE_NAME="${CSRF_COOKIE_NAME:-csrf}" \
  go run ./cmd/migrate --validate-only)

# Step 3/3: boot the api against scratch, probe /readyz, tear down.
PROBE_PORT="${PORT:-${API_PORT:-4100}}"
echo "backup-rehearsal: step 3/3 - boot api on :$PROBE_PORT, probe /readyz"
(cd "$GO_DIR" && go build -o "$OLDPWD/$DIR/api-rehearsal" ./cmd/api)
(
  cd "$GO_DIR"
  DATABASE_URL="$SCRATCH_DSN" \
  AUTH_SECRET="${AUTH_SECRET:-ci-only-secret-with-at-least-32-characters}" \
  API_HOST="${API_HOST:-127.0.0.1}" PORT="$PROBE_PORT" \
  APP_ENV="${APP_ENV:-${ENVIRONMENT:-test}}" ENVIRONMENT="${ENVIRONMENT:-${APP_ENV:-test}}" \
  MIGRATIONS_DIR="${MIGRATIONS_DIR:-migrations}" \
  COOKIE_SECURE="${COOKIE_SECURE:-false}" SESSION_COOKIE_NAME="${SESSION_COOKIE_NAME:-session}" CSRF_COOKIE_NAME="${CSRF_COOKIE_NAME:-csrf}" \
  exec "$OLDPWD/$DIR/api-rehearsal"
) &
API_PID=$!
cleanup() {
  kill "$API_PID" 2>/dev/null || true
  wait "$API_PID" 2>/dev/null || true
  rm -rf "$DIR"
}
trap cleanup EXIT
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PROBE_PORT/readyz" -o "$DIR/readyz.json"; then
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "backup-rehearsal: api exited before /readyz went ready" >&2
    exit 1
  fi
  sleep 1
  if [ "$i" = "30" ]; then
    echo "backup-rehearsal: /readyz never went ready within 30s" >&2
    exit 1
  fi
done
if ! grep -q '"status"' "$DIR/readyz.json"; then
  echo "backup-rehearsal: /readyz probe returned unexpected body" >&2
  cat "$DIR/readyz.json" >&2
  exit 1
fi
echo "backup-rehearsal: readyz probe:"
cat "$DIR/readyz.json"
echo ""
echo "backup-rehearsal: OK - backup restores and boots (scratch=$SCRATCH_DB)"
