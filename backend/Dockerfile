# Backend Dockerfile for Railway single-service deployment.
# Builds the frontend SPA, the Go API, migrate, worker, and SAT authoring
# co-edit runtime in one image. Single service: start.sh supervises all runtime
# processes in the same container, so the worker and co-edit runtime need no
# separate deploy (same DB, same env).
#
# Co-edit remains a child process rather than being rewritten into Go: the
# existing Hocuspocus/Yjs implementation owns the singleton rooms, while Go
# remains the authorization and durable-persistence boundary.
#
# The Go API has no embedded background runner (no ApiBackgroundJobs
# equivalent), so activity_driven must not skip the worker — otherwise
# auto-submit, grading projection, and background recovery stop running in
# exactly the topology that needs them.

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
# The frontend builder already installs the root dependency tree used by the
# co-edit runtime. Copy only its runtime entrypoint, shared wire-format files,
# and dependencies into the final image.
COPY --from=frontend-builder /usr/local/bin/bun /usr/local/bin/bun
COPY --from=frontend-builder /app/node_modules /app/node_modules
COPY --from=frontend-builder /app/package.json /app/package.json
COPY --from=frontend-builder /app/services/authoring-coedit/tsconfig.json /app/services/authoring-coedit/tsconfig.json
COPY --from=frontend-builder /app/services/authoring-coedit/src /app/services/authoring-coedit/src
COPY --from=frontend-builder /app/src/features/exam-authoring/editor/schema /app/src/features/exam-authoring/editor/schema
COPY --from=frontend-builder /app/src/features/exam-authoring/editor/richContent.ts /app/src/features/exam-authoring/editor/richContent.ts
COPY --from=frontend-builder /app/src/features/exam-authoring/editor/richContentIdentity.ts /app/src/features/exam-authoring/editor/richContentIdentity.ts
COPY --from=frontend-builder /app/src/features/exam-authoring/contracts /app/src/features/exam-authoring/contracts
COPY --from=frontend-builder /app/src/features/exam-authoring/realtime/coedit/workspaceCommands.ts /app/src/features/exam-authoring/realtime/coedit/workspaceCommands.ts
COPY --from=frontend-builder /app/src/features/exam-authoring/realtime/coedit/workspaceSeed.ts /app/src/features/exam-authoring/realtime/coedit/workspaceSeed.ts
COPY --from=frontend-builder /app/src/features/exam-authoring/realtime/coedit/protocol.ts /app/src/features/exam-authoring/realtime/coedit/protocol.ts
COPY --from=frontend-builder /app/src/features/exam-authoring/realtime/coedit/documentIdentity.ts /app/src/features/exam-authoring/realtime/coedit/documentIdentity.ts
COPY backend/go/migrations /app/migrations
COPY backend/scripts/normalize-background-runtime-mode.sh /app/normalize-background-runtime-mode.sh

RUN cat > /app/start.sh << 'EOF'
#!/bin/bash
set -euo pipefail

echo "Starting IELTS Backend Service..."

/app/migrate

# SAT authoring co-editing runs inside this backend service. These values must
# be exported before the Go API starts so both the API and Hocuspocus receive
# the same topology. The public URL is intentionally supplied by the operator;
# it is the browser-facing proxy URL, not the loopback control URL.
coedit_api_port="${PORT:-${API_PORT:-4000}}"
export AUTHORING_COEDIT_SERVICE_URL="${AUTHORING_COEDIT_SERVICE_URL:-http://127.0.0.1:1235}"
export AUTHORING_COEDIT_GO_BASE_URL="${AUTHORING_COEDIT_GO_BASE_URL:-http://127.0.0.1:${coedit_api_port}}"
export AUTHORING_COEDIT_PROXY_ENABLED="${AUTHORING_COEDIT_PROXY_ENABLED:-true}"

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

# The process has its own singleton lock and exits on lock loss, so duplicate
# backend replicas must not both claim the same authoring rooms.
/usr/local/bin/bun run /app/services/authoring-coedit/src/main.ts &
COEDIT_PID=$!

# BACKGROUND_RUNTIME_MODE mirrors the Rust topology. Activity-driven mode is
# API-only; continuous mode owns the background job set in the worker.
BACKGROUND_RUNTIME_MODE="$(/app/normalize-background-runtime-mode.sh "${BACKGROUND_RUNTIME_MODE:-continuous}")"
export BACKGROUND_RUNTIME_MODE

if [ "$BACKGROUND_RUNTIME_MODE" = "activity_driven" ]; then
  trap 'kill "$API_PID" "$COEDIT_PID" 2>/dev/null || true' INT TERM EXIT
  set +e
  wait -n "$API_PID" "$COEDIT_PID"
  STATUS=$?
  set -e
  echo "One process exited, shutting down..."
  kill "$API_PID" "$COEDIT_PID" 2>/dev/null || true
  wait || true
  exit "$STATUS"
fi

/app/worker &
WORKER_PID=$!
trap 'kill "$API_PID" "$WORKER_PID" "$COEDIT_PID" 2>/dev/null || true' INT TERM EXIT

set +e
wait -n "$API_PID" "$WORKER_PID" "$COEDIT_PID"
STATUS=$?
set -e

echo "One process exited, shutting down..."
kill "$API_PID" "$WORKER_PID" "$COEDIT_PID" 2>/dev/null || true
wait || true
exit "$STATUS"
EOF

RUN chmod +x /app/start.sh /app/normalize-background-runtime-mode.sh

EXPOSE 4000

CMD ["/app/start.sh"]
