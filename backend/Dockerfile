# Backend Dockerfile for Railway single-service deployment.
# Builds the frontend SPA, Rust API, and Rust worker in one image.

FROM node:22-bookworm-slim AS frontend-builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM rust:1.88-slim AS backend-builder

WORKDIR /app/backend

RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/Cargo.toml ./
COPY backend/Cargo.lock ./
COPY backend/crates/api/Cargo.toml ./crates/api/
COPY backend/crates/application/Cargo.toml ./crates/application/
COPY backend/crates/domain/Cargo.toml ./crates/domain/
COPY backend/crates/infrastructure/Cargo.toml ./crates/infrastructure/
COPY backend/crates/worker/Cargo.toml ./crates/worker/

RUN mkdir -p crates/api/src && printf 'fn main() {}\n' > crates/api/src/main.rs
RUN mkdir -p crates/worker/src && printf 'fn main() {}\n' > crates/worker/src/main.rs
RUN mkdir -p crates/application/src && printf '' > crates/application/src/lib.rs
RUN mkdir -p crates/domain/src && printf '' > crates/domain/src/lib.rs
RUN mkdir -p crates/infrastructure/src && printf '' > crates/infrastructure/src/lib.rs

RUN cargo fetch --locked

COPY backend/crates ./crates/

RUN cargo build --release --workspace

FROM debian:bookworm-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

ENV FRONTEND_DIST_DIR=/app/frontend/dist

COPY --from=backend-builder /app/backend/target/release/ielts-backend-api /app/api
COPY --from=backend-builder /app/backend/target/release/migrate /app/migrate
COPY --from=backend-builder /app/backend/target/release/ielts-backend-worker /app/worker
COPY --from=frontend-builder /app/dist /app/frontend/dist
COPY backend/migrations /app/migrations

RUN cat > /app/start.sh << 'EOF'
#!/bin/bash
set -euo pipefail

echo "Starting IELTS Backend Service..."

/app/migrate

/app/api &
API_PID=$!

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

RUN chmod +x /app/start.sh

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:4000/healthz || exit 1

CMD ["/app/start.sh"]
