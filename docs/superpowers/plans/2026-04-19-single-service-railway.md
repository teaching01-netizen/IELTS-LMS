# Single-Service Railway Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the frontend, backend API, and worker from one Railway service while keeping PostgreSQL external.

**Architecture:** Build the Vite frontend into `dist/` during the backend Docker build, copy those assets into the runtime image, and teach the Axum API to serve SPA routes from the same origin while preserving `/api/v1/*` and `/api/v1/ws/*`. Keep the worker process in the same container so Railway only needs one web service.

**Tech Stack:** Rust, Axum, Tower HTTP, Vite, Docker, Railway

---

### Task 1: Prove the frontend/static routing boundary

**Files:**
- Create: `backend/crates/api/src/frontend.rs`
- Modify: `backend/crates/api/src/router.rs`
- Create: `backend/crates/api/src/frontend_tests.rs`

- [ ] **Step 1: Write the failing test**

```rust
#[tokio::test]
async fn spa_routes_fall_back_to_index_but_api_404s_remain_404() {
    // Arrange a temp dist directory containing index.html and one asset.
    // Build a router that points at that directory.
    // Assert:
    // - GET /admin/exams returns index.html
    // - GET /assets/app.js returns the asset
    // - GET /api/v1/does-not-exist returns 404
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
`cargo test -p ielts-backend-api spa_routes_fall_back_to_index_but_api_404s_remain_404 -- --nocapture`

Expected: fail because `frontend` serving does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement a `frontend::serve_frontend` fallback handler that:
- serves `index.html` for SPA routes
- serves actual files from the frontend `dist` directory when they exist
- returns `404` for unknown `/api/*` paths

- [ ] **Step 4: Run the test to verify it passes**

Run:
`cargo test -p ielts-backend-api spa_routes_fall_back_to_index_but_api_404s_remain_404 -- --nocapture`

Expected: pass.

### Task 2: Wire the frontend directory into backend config

**Files:**
- Modify: `backend/crates/infrastructure/src/config.rs`
- Modify: `backend/crates/api/src/state.rs`
- Modify: `backend/crates/api/src/lib.rs`

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn default_frontend_dist_dir_points_at_the_runtime_image_path() {
    let config = AppConfig::default();
    assert_eq!(config.frontend_dist_dir, "/app/frontend/dist");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
`cargo test -p ielts-backend-infrastructure default_frontend_dist_dir_points_at_the_runtime_image_path -- --nocapture`

Expected: fail because the field does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Add `frontend_dist_dir` to `AppConfig`, populate it from `FRONTEND_DIST_DIR` when present, and default it to `/app/frontend/dist`.

- [ ] **Step 4: Run the test to verify it passes**

Run:
`cargo test -p ielts-backend-infrastructure default_frontend_dist_dir_points_at_the_runtime_image_path -- --nocapture`

Expected: pass.

### Task 3: Build the frontend in the backend image

**Files:**
- Modify: `backend/Dockerfile`

- [ ] **Step 1: Write the failing test**

```bash
docker build -f backend/Dockerfile .
```

Expected: the image build should fail before the frontend build/copy steps exist.

- [ ] **Step 2: Run the test to verify it fails**

Run:
`docker build -f backend/Dockerfile .`

- [ ] **Step 3: Write minimal implementation**

Add a Node build stage for the repo root frontend build, copy `dist/` into `/app/frontend/dist` in the runtime image, and keep the API/worker startup script.

- [ ] **Step 4: Run the test to verify it passes**

Run:
`docker build -f backend/Dockerfile .`

Expected: image build succeeds.

### Task 4: Update Railway config and deployment docs

**Files:**
- Modify: `backend/railway.json`
- Modify: `RAILWAY_DEPLOYMENT.md`

- [ ] **Step 1: Write the failing test**

```bash
rg -n 'healthz|one service|Dockerfile.frontend|frontend service' RAILWAY_DEPLOYMENT.md backend/railway.json
```

Expected: the old two-service wording is still present before the docs update.

- [ ] **Step 2: Run the test to verify it fails**

Run:
`rg -n 'healthz|one service|Dockerfile.frontend|frontend service' RAILWAY_DEPLOYMENT.md backend/railway.json`

- [ ] **Step 3: Write minimal implementation**

Set the Railway health check to `/healthz` and rewrite the deployment guide to describe the single-service backend image plus external PostgreSQL.

- [ ] **Step 4: Run the test to verify it passes**

Run:
`rg -n 'healthz|one service|Dockerfile.frontend|frontend service' RAILWAY_DEPLOYMENT.md backend/railway.json`

Expected: only the intended one-service wording remains.

### Task 5: Verify the combined service end to end

**Files:**
- Modify: none

- [ ] **Step 1: Run the full test set**

Run:
`cargo test -p ielts-backend-api`

- [ ] **Step 2: Build the frontend**

Run:
`npm run build`

- [ ] **Step 3: Build the backend image**

Run:
`docker build -f backend/Dockerfile .`

- [ ] **Step 4: Check the key deployment files**

Run:
`git diff -- backend/Dockerfile backend/railway.json RAILWAY_DEPLOYMENT.md backend/crates/api/src/frontend.rs backend/crates/api/src/router.rs backend/crates/infrastructure/src/config.rs`

