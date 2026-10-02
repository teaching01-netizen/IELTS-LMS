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
# activity_driven embeds every background job in the API and parks co-edit;
# continuous retains the standalone worker child in the same container.

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

FROM node:22-bookworm-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV FRONTEND_DIST_DIR=/app/frontend/dist
ENV MIGRATIONS_DIR=/app/migrations
ENV ENVIRONMENT=production
ENV BACKGROUND_RUNTIME_MODE=activity_driven
ENV IDLE_GRACE_SECS=60

COPY --from=backend-builder /out/api /app/api
COPY --from=backend-builder /out/migrate /app/migrate
COPY --from=backend-builder /out/worker /app/worker
COPY --from=frontend-builder /app/dist /app/frontend/dist
# The frontend builder already installs the root dependency tree used by the
# co-edit runtime. Copy only its runtime entrypoint, shared wire-format files,
# and dependencies into the final image. Hocuspocus must run under Node; its
# crossws Node adapter intentionally rejects Bun.
COPY --from=frontend-builder /app/node_modules /app/node_modules
COPY --from=frontend-builder /app/package.json /app/package.json
# The source list below is GENERATED from backend/coedit-runtime-manifest.json:
# add a path there and run `bun run coedit:manifest`. A hand-written COPY for
# src/ or services/ outside that block fails the architecture guard.
# coedit-runtime-manifest:begin
# Generated from backend/coedit-runtime-manifest.json — do not hand-edit.
# Regenerate with `bun run coedit:manifest`;
# src/test/architecture/coedit-runtime-manifest.test.ts fails when this block
# and the manifest disagree, so a missing path cannot reach production.
COPY --from=frontend-builder /app/services/authoring-coedit/src /app/services/authoring-coedit/src
COPY --from=frontend-builder /app/services/authoring-coedit/tsconfig.json /app/services/authoring-coedit/tsconfig.json
COPY --from=frontend-builder /app/src/features/exam-authoring/contracts /app/src/features/exam-authoring/contracts
COPY --from=frontend-builder /app/src/features/exam-authoring/editor/ingestion/domain /app/src/features/exam-authoring/editor/ingestion/domain
COPY --from=frontend-builder /app/src/features/exam-authoring/editor/richContent.ts /app/src/features/exam-authoring/editor/richContent.ts
COPY --from=frontend-builder /app/src/features/exam-authoring/editor/richContentIdentity.ts /app/src/features/exam-authoring/editor/richContentIdentity.ts
COPY --from=frontend-builder /app/src/features/exam-authoring/editor/schema /app/src/features/exam-authoring/editor/schema
COPY --from=frontend-builder /app/src/features/exam-authoring/realtime/coedit/documentIdentity.ts /app/src/features/exam-authoring/realtime/coedit/documentIdentity.ts
COPY --from=frontend-builder /app/src/features/exam-authoring/realtime/coedit/protocol.ts /app/src/features/exam-authoring/realtime/coedit/protocol.ts
COPY --from=frontend-builder /app/src/features/exam-authoring/realtime/coedit/storeRequest.ts /app/src/features/exam-authoring/realtime/coedit/storeRequest.ts
COPY --from=frontend-builder /app/src/features/exam-authoring/realtime/coedit/workspaceCommands.ts /app/src/features/exam-authoring/realtime/coedit/workspaceCommands.ts
COPY --from=frontend-builder /app/src/features/exam-authoring/realtime/coedit/workspaceSeed.ts /app/src/features/exam-authoring/realtime/coedit/workspaceSeed.ts
# coedit-runtime-manifest:end
COPY backend/go/migrations /app/migrations
COPY backend/scripts/normalize-background-runtime-mode.sh /app/normalize-background-runtime-mode.sh

RUN cat > /app/start.sh << 'EOF'
#!/bin/bash
set -euo pipefail

# Normalize before migrate, API, co-edit, or worker inherits the environment.
BACKGROUND_RUNTIME_MODE="$(/app/normalize-background-runtime-mode.sh "${BACKGROUND_RUNTIME_MODE:-continuous}")"
export BACKGROUND_RUNTIME_MODE
export IDLE_GRACE_SECS="${IDLE_GRACE_SECS:-60}"

coedit_api_port="${PORT:-${API_PORT:-4000}}"
export AUTHORING_COEDIT_SERVICE_URL="${AUTHORING_COEDIT_SERVICE_URL:-http://127.0.0.1:1235}"
export AUTHORING_COEDIT_GO_BASE_URL="${AUTHORING_COEDIT_GO_BASE_URL:-http://127.0.0.1:${coedit_api_port}}"
export AUTHORING_COEDIT_PROXY_ENABLED="${AUTHORING_COEDIT_PROXY_ENABLED:-true}"
export AUTHORING_COEDIT_HOST="${AUTHORING_COEDIT_HOST:-127.0.0.1}"

pids=()
stop_children() {
  trap - INT TERM EXIT
  if [ -n "${COEDIT_PID:-}" ]; then
    # Flush collaborative writes while the Go persistence boundary still serves.
    kill "$COEDIT_PID" 2>/dev/null || true
    wait "$COEDIT_PID" || true
  fi
  if [ "${#pids[@]}" -gt 0 ]; then
    kill "${pids[@]}" 2>/dev/null || true
    wait || true
  fi
}
trap 'stop_children; exit 0' INT TERM
trap 'stop_children' EXIT

/app/migrate

MALLOC_ARENA_MAX="${API_MALLOC_ARENA_MAX:-${MALLOC_ARENA_MAX:-1}}" \
MALLOC_TRIM_THRESHOLD_="${API_MALLOC_TRIM_THRESHOLD:-${MALLOC_TRIM_THRESHOLD_:-131072}}" \
MALLOC_MMAP_THRESHOLD_="${API_MALLOC_MMAP_THRESHOLD:-${MALLOC_MMAP_THRESHOLD_:-131072}}" \
/app/api &
pids+=("$!")

/usr/local/bin/node /app/node_modules/tsx/dist/cli.mjs /app/services/authoring-coedit/src/main.ts &
COEDIT_PID=$!
pids+=("$COEDIT_PID")

if [ "$BACKGROUND_RUNTIME_MODE" = "continuous" ]; then
  /app/worker &
  pids+=("$!")
fi

# Intentional co-edit parking keeps Node alive. Any child exit is a container
# failure so Railway's on-failure restart policy can recover the whole runtime.
set +e
wait -n "${pids[@]}"
STATUS=$?
set -e
if [ "$STATUS" -eq 0 ]; then STATUS=1; fi
echo "A runtime process exited; shutting down the container."
exit "$STATUS"

EOF

RUN chmod +x /app/start.sh /app/normalize-background-runtime-mode.sh

EXPOSE 4000

CMD ["/app/start.sh"]
