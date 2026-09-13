#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ -f "deploy/leapcell-load/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "deploy/leapcell-load/.env"
  set +a
fi

if [[ -z "${REGISTER_URL:-}" ]]; then
  echo "REGISTER_URL is required" >&2
  exit 1
fi
if [[ -z "${USERS_FILE:-}" ]]; then
  echo "USERS_FILE is required" >&2
  exit 1
fi

if [[ "${RUN_WITH_K6:-false}" == "true" ]]; then
  echo "[leapcell-load] running combined Playwright + k6"
  bun run e2e:live-with-k6
else
  echo "[leapcell-load] running Playwright live runner only"
  bun run e2e:live-runner
fi
