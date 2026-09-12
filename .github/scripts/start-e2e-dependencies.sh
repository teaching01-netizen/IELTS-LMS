#!/usr/bin/env bash

set -euo pipefail

compose_file="${E2E_COMPOSE_FILE:-backend/docker-compose.yml}"
compose_override_file="${E2E_COMPOSE_OVERRIDE_FILE:-}"
max_attempts="${E2E_COMPOSE_ATTEMPTS:-3}"
retry_delay_seconds="${E2E_COMPOSE_RETRY_DELAY_SECONDS:-10}"

compose_args=(-f "${compose_file}")
if [[ -n "${compose_override_file}" ]]; then
  compose_args+=(-f "${compose_override_file}")
fi

compose() {
  docker compose "${compose_args[@]}" "$@"
}

for attempt in $(seq 1 "${max_attempts}"); do
  echo "Starting E2E dependencies (attempt ${attempt}/${max_attempts})"

  if compose up -d --wait tidb minio; then
    echo "E2E dependencies are ready"
    exit 0
  fi

  echo "Docker dependency startup failed; collecting diagnostics"
  compose ps || true
  compose logs --no-color --tail=100 tidb minio || true

  if [ "${attempt}" -lt "${max_attempts}" ]; then
    echo "Retrying in ${retry_delay_seconds}s"
    sleep "${retry_delay_seconds}"
  fi
done

echo "E2E dependency startup failed after ${max_attempts} attempts"
exit 1
