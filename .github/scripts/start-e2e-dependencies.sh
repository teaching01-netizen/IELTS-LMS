#!/usr/bin/env bash

set -euo pipefail

compose_file="${E2E_COMPOSE_FILE:-backend/docker-compose.yml}"
max_attempts="${E2E_COMPOSE_ATTEMPTS:-3}"
retry_delay_seconds="${E2E_COMPOSE_RETRY_DELAY_SECONDS:-10}"

for attempt in $(seq 1 "${max_attempts}"); do
  echo "Starting E2E dependencies (attempt ${attempt}/${max_attempts})"

  if docker compose -f "${compose_file}" up -d --wait tidb minio; then
    echo "E2E dependencies are ready"
    exit 0
  fi

  echo "Docker dependency startup failed; collecting diagnostics"
  docker compose -f "${compose_file}" ps || true
  docker compose -f "${compose_file}" logs --no-color --tail=100 tidb minio || true

  if [ "${attempt}" -lt "${max_attempts}" ]; then
    echo "Retrying in ${retry_delay_seconds}s"
    sleep "${retry_delay_seconds}"
  fi
done

echo "E2E dependency startup failed after ${max_attempts} attempts"
exit 1
