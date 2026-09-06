# Backend Dockerfile for Railway single-service deployment.
# Builds the frontend SPA plus the Go API, migrate, and worker in one image.
# Single service: start.sh supervises /app/api + /app/worker in the same
# container, so the worker needs no separate deploy (same DB, same env).

FROM node:22-bookworm-slim AS frontend-builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

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
API_OTEL_EXPORTER_OTLP_ENDPOINT="${API_OTEL_EXPORTER_OTLP_ENDPOINT:-${OTEL_EXPORTER_OTLP_ENDPOINT:-}}"

MALLOC_ARENA_MAX="${API_MALLOC_ARENA_MAX}" \
MALLOC_TRIM_THRESHOLD_="${API_MALLOC_TRIM_THRESHOLD}" \
MALLOC_MMAP_THRESHOLD_="${API_MALLOC_MMAP_THRESHOLD}" \
OTEL_EXPORTER_OTLP_ENDPOINT="${API_OTEL_EXPORTER_OTLP_ENDPOINT}" \
/app/api &
API_PID=$!

BACKGROUND_RUNTIME_MODE="$(/app/normalize-background-runtime-mode.sh "${BACKGROUND_RUNTIME_MODE:-continuous}")"
if [[ "${BACKGROUND_RUNTIME_MODE}" == "activity_driven" ]]; then
    trap 'kill "$API_PID" 2>/dev/null || true' INT TERM EXIT
    set +e
    wait "$API_PID"
    STATUS=$?
    set -e
    exit "$STATUS"
fi

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
