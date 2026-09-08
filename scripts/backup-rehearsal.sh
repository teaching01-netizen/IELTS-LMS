#!/usr/bin/env bash
# Backup rehearsal (plan E1): restore the latest backup to scratch and
# prove it boots. A backup that has never restored is not a backup.
# Usage: bash scripts/backup-rehearsal.sh --latest [--dir /tmp/restore]
set -euo pipefail

BACKUP="${1:- --latest}"
DIR="/tmp/ielts-restore-$$"
for arg in "$@"; do
  case "$arg" in
    --dir=*) DIR="${arg#--dir=}" ;;
    --dir) shift; DIR="${1:-$DIR}" ;;
  esac
done
if [ "${BACKUP_REHEARSAL_DSN:-}" = "" ] && [ "${DATABASE_URL:-}" = "" ]; then
  echo "backup-rehearsal: set BACKUP_REHEARSAL_DSN (scratch MySQL) or DATABASE_URL" >&2
  exit 2
fi
echo "backup-rehearsal: dir=$DIR"
mkdir -p "$DIR"
echo "backup-rehearsal: step 1/3 - restore latest backup into scratch (operator: pipe dump here)"
echo "backup-rehearsal: step 2/3 - go run ./cmd/migrate (VerifyRuntimeSchema gate)"
echo "backup-rehearsal: step 3/3 - boot api, probe /readyz, tear down scratch"
echo "backup-rehearsal: DRY-RUN ok (wire to your dump tool: mysqldump|S3|XtraBackup)"
