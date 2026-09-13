# Backend Dockerfile for Railway single-service deployment.
# Builds the frontend SPA plus the Go API, migrate, and worker in one image.
# Single service: start.sh supervises /app/api + /app/worker in the same
# container, so the worker needs no separate deploy (same DB, same env).
#
# Both processes always run: the Go API has no embedded background runner
# (no ApiBackgroundJobs equivalent), so activity_driven must not skip the
# worker — otherwise auto-submit, grading projection, and background recovery
# stop running in exactly the topology that needs them.

FROM node:22-bookworm-slim AS frontend-builder

WORKDIR /app

# Bun is the package manager; Node (from the base image) remains the runtime
# because the toolchain binaries use a `#!/usr/bin/env node` shebang.
COPY --from=oven/bun:1.3.14-debian /usr/local/bin/bun /usr/local/bin/bun

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM golang:1.26-bookworm AS backend-builder

WORKDIR /app/backend/go

COPY backend/go/go.mod backend/go/go.sum ./
RUN go mod download

COPY backend/go ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -o /out/api ./cmd/api \
 && CGO_ENABLED=0 GOOS=linux go build -trimpath -o /out/migrate ./cmd/migrate \
 && CGO_ENABLED=0 GOOS=linux go build -trimpath -o /out/worker ./cmd/worker

FROM debian:bookworm-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV FRONTEND_DIST_DIR=/app/frontend/dist
ENV MIGRATIONS_DIR=/app/migrations
ENV ENVIRONMENT=production

COPY --from=backend-builder /out/api /app/api
COPY --from=backend-builder /out/migrate /app/migrate
COPY --from=backend-builder /out/worker /app/worker
COPY --from=frontend-builder /app/dist /app/frontend/dist
COPY backend/go/migrations /app/migrations
COPY backend/scripts/normalize-background-runtime-mode.sh /app/normalize-background-runtime-mode.sh

RUN cat > /app/start.sh << 'EOF'
#!/bin/bash
set -euo pipefail

echo "Starting IELTS Backend Service..."

/app/migrate

# API-only memory tuning knobs.
# Allows either generic MALLOC_* env vars or API_* overrides.
API_MALLOC_ARENA_MAX="${API_MALLOC_ARENA_MAX:-${MALLOC_ARENA_MAX:-1}}"
API_MALLOC_TRIM_THRESHOLD="${API_MALLOC_TRIM_THRESHOLD:-${MALLOC_TRIM_THRESHOLD_:-131072}}"
API_MALLOC_MMAP_THRESHOLD="${API_MALLOC_MMAP_THRESHOLD:-${MALLOC_MMAP_THRESHOLD_:-131072}}"

# NOTE (WS-10a): the OTEL_EXPORTER_OTLP_ENDPOINT forward was dead — no OTel
# SDK is vendored (trace is X-Trace-Id echo only). Removed; the endpoint
# env is no longer consumed anywhere.
MALLOC_ARENA_MAX="${API_MALLOC_ARENA_MAX}" \
MALLOC_TRIM_THRESHOLD_="${API_MALLOC_TRIM_THRESHOLD}" \
MALLOC_MMAP_THRESHOLD_="${API_MALLOC_MMAP_THRESHOLD}" \
/app/api &
API_PID=$!

# BACKGROUND_RUNTIME_MODE is normalized for API config parity only; it never
# gates the worker. The Go API serves requests in every mode, and the worker
# owns the background job set (outbox drain, reconcile/repair, grading
# projection, retention/media) in every mode.
BACKGROUND_RUNTIME_MODE="$(/app/normalize-background-runtime-mode.sh "${BACKGROUND_RUNTIME_MODE:-continuous}")"
export BACKGROUND_RUNTIME_MODE

/app/worker &
WORKER_PID=$!
trap 'kill "$API_PID" "$WORKER_PID" 2>/dev/null || true' INT TERM EXIT

set +e
wait -n "$API_PID" "$WORKER_PID"
STATUS=$?
set -e

echo "One process exited, shutting down..."
kill "$API_PID" "$WORKER_PID" 2>/dev/null || true
wait || true
exit "$STATUS"
EOF

RUN chmod +x /app/start.sh /app/normalize-background-runtime-mode.sh

EXPOSE 4000

CMD ["/app/start.sh"]
