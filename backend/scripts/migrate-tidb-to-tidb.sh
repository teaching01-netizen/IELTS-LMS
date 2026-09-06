#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Migrate data from one TiDB/MySQL-compatible database to another.

Required source variables:
  SOURCE_DB_HOST
  SOURCE_DB_USER
  SOURCE_DB_PASSWORD
  SOURCE_DB_NAME

Required target variables:
  TARGET_DB_HOST
  TARGET_DB_USER
  TARGET_DB_PASSWORD
  TARGET_DB_NAME

Optional variables:
  SOURCE_DB_PORT              default: 4000
  TARGET_DB_PORT              default: 4000
  DUMP_FILE                   default: temporary file
  MIGRATIONS_DIR              default: backend/go/migrations
  TARGET_DATABASE_URL         override URI/DSN used by the Go migration command
  IGNORE_TABLES               space-separated tables to skip; default: schema_migrations
  SINGLE_TRANSACTION=0        disable mysqldump --single-transaction
  SKIP_TARGET_MIGRATIONS=1    do not run the Go migration command first
  ALLOW_NON_EMPTY_TARGET=1    import even if target already has rows
  KEEP_DUMP=1                 keep temporary dump after completion

Example:
  SOURCE_DB_HOST=old.example.com SOURCE_DB_USER=root SOURCE_DB_PASSWORD=secret SOURCE_DB_NAME=ielts \
  TARGET_DB_HOST=new.example.com TARGET_DB_USER=root TARGET_DB_PASSWORD=secret TARGET_DB_NAME=ielts \
  bash ./scripts/migrate-tidb-to-tidb.sh
USAGE
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "$name must be set" >&2
    echo >&2
    usage >&2
    exit 1
  fi
}

mysql_client() {
  local prefix="$1"
  shift
  local host_var="${prefix}_DB_HOST"
  local port_var="${prefix}_DB_PORT"
  local user_var="${prefix}_DB_USER"
  local password_var="${prefix}_DB_PASSWORD"
  local name_var="${prefix}_DB_NAME"

  mysql \
    "--host=${!host_var}" \
    "--port=${!port_var}" \
    "--user=${!user_var}" \
    "--password=${!password_var}" \
    "--protocol=tcp" \
    "$@" \
    "${!name_var}"
}

run_mysql() {
  local prefix="$1"
  shift
  mysql_client "$prefix" "$@"
}

mysqldump_client() {
  local prefix="$1"
  shift
  local host_var="${prefix}_DB_HOST"
  local port_var="${prefix}_DB_PORT"
  local user_var="${prefix}_DB_USER"
  local password_var="${prefix}_DB_PASSWORD"
  local name_var="${prefix}_DB_NAME"

  mysqldump \
    "--host=${!host_var}" \
    "--port=${!port_var}" \
    "--user=${!user_var}" \
    "--password=${!password_var}" \
    "--protocol=tcp" \
    "$@" \
    "${!name_var}"
}

run_mysql_scalar() {
  local prefix="$1"
  local sql="$2"
  run_mysql "$prefix" --batch --skip-column-names --execute="$sql"
}

list_data_tables() {
  local prefix="$1"
  run_mysql "$prefix" --batch --skip-column-names --execute="
select table_name
from information_schema.tables
where table_schema = database()
  and table_type = 'BASE TABLE'
order by table_name;"
}

quote_identifier() {
  local identifier="$1"
  printf '`%s`' "${identifier//\`/\`\`}"
}

is_ignored_table() {
  local table="$1"
  local ignored
  for ignored in $IGNORE_TABLES; do
    if [[ "$table" == "$ignored" ]]; then
      return 0
    fi
  done
  return 1
}

dump_ignore_options() {
  local ignored
  for ignored in $IGNORE_TABLES; do
    printf '%s\n' "--ignore-table=${SOURCE_DB_NAME}.${ignored}"
  done
}

target_row_count() {
  local total=0
  local table
  local quoted
  local count

  while IFS= read -r table; do
    [[ -z "$table" ]] && continue
    is_ignored_table "$table" && continue
    quoted="$(quote_identifier "$table")"
    count="$(run_mysql_scalar TARGET "select count(*) from $quoted" | tr -d '[:space:]')"
    total=$((total + count))
  done < <(list_data_tables TARGET)

  printf '%s\n' "$total"
}

write_row_counts() {
  local prefix="$1"
  local output_file="$2"
  local table
  local quoted
  local count

  : >"$output_file"
  while IFS= read -r table; do
    [[ -z "$table" ]] && continue
    is_ignored_table "$table" && continue
    quoted="$(quote_identifier "$table")"
    count="$(run_mysql_scalar "$prefix" "select count(*) from $quoted" | tr -d '[:space:]')"
    printf '%s\t%s\n' "$table" "$count" >>"$output_file"
  done < <(list_data_tables "$prefix")
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backend_dir="$(cd "$script_dir/.." && pwd)"

SOURCE_DB_PORT="${SOURCE_DB_PORT:-4000}"
TARGET_DB_PORT="${TARGET_DB_PORT:-4000}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$backend_dir/go/migrations}"
IGNORE_TABLES="${IGNORE_TABLES:-schema_migrations}"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

require_command mysql
require_command mysqldump

for var in \
  SOURCE_DB_HOST SOURCE_DB_USER SOURCE_DB_PASSWORD SOURCE_DB_NAME \
  TARGET_DB_HOST TARGET_DB_USER TARGET_DB_PASSWORD TARGET_DB_NAME
do
  require_env "$var"
done

dump_file="${DUMP_FILE:-}"
created_temp_dump=0
if [[ -z "$dump_file" ]]; then
  dump_file="$(mktemp -t tidb-data-XXXXXX.sql)"
  created_temp_dump=1
fi

cleanup() {
  if [[ "$created_temp_dump" == "1" && "${KEEP_DUMP:-0}" != "1" ]]; then
    rm -f "$dump_file"
  fi
}
trap cleanup EXIT

echo "Checking source database connectivity"
run_mysql_scalar SOURCE "select 1" >/dev/null

echo "Checking target database connectivity"
run_mysql_scalar TARGET "select 1" >/dev/null

if [[ "${SKIP_TARGET_MIGRATIONS:-0}" != "1" ]]; then
  require_command go
  echo "Running target schema migrations"
  target_database_url="${TARGET_DATABASE_URL:-${TARGET_DB_USER}:${TARGET_DB_PASSWORD}@tcp(${TARGET_DB_HOST}:${TARGET_DB_PORT})/${TARGET_DB_NAME}?parseTime=true&multiStatements=true&charset=utf8mb4}"
  (
    cd "$backend_dir/go"
    DATABASE_URL="$target_database_url" \
      DATABASE_DIRECT_URL="$target_database_url" \
      DATABASE_MIGRATOR_URL="$target_database_url" \
      MIGRATIONS_DIR="$MIGRATIONS_DIR" \
      go run ./cmd/migrate
  )
fi

existing_target_rows="$(target_row_count | tr -d '[:space:]')"
if [[ "$existing_target_rows" != "0" && "${ALLOW_NON_EMPTY_TARGET:-0}" != "1" ]]; then
  echo "Target database already contains ${existing_target_rows} rows. Set ALLOW_NON_EMPTY_TARGET=1 to import anyway." >&2
  exit 1
fi

echo "Dumping source data to $dump_file"
dump_options=(
  --quick
  --hex-blob
  --no-create-info
  --skip-triggers
  --routines=false
  --events=false
)
if [[ "${SINGLE_TRANSACTION:-1}" != "0" ]]; then
  dump_options=(--single-transaction "${dump_options[@]}")
fi
while IFS= read -r ignore_option; do
  [[ -z "$ignore_option" ]] && continue
  dump_options=("$ignore_option" "${dump_options[@]}")
done < <(dump_ignore_options)

mysqldump_client SOURCE \
  "${dump_options[@]}" \
  >"$dump_file"

echo "Importing data into target"
{
  printf 'SET FOREIGN_KEY_CHECKS=0;\n'
  cat "$dump_file"
  printf '\nSET FOREIGN_KEY_CHECKS=1;\n'
} | mysql_client TARGET

source_counts="$(mktemp -t tidb-source-counts-XXXXXX.tsv)"
target_counts="$(mktemp -t tidb-target-counts-XXXXXX.tsv)"
trap 'rm -f "$source_counts" "$target_counts"; cleanup' EXIT

echo "Validating table row counts"
write_row_counts SOURCE "$source_counts"
write_row_counts TARGET "$target_counts"

if ! diff -u "$source_counts" "$target_counts"; then
  echo "Row-count validation failed" >&2
  exit 1
fi

echo "TiDB data migration completed successfully"
