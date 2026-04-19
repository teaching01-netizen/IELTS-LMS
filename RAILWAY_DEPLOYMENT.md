# Railway Deployment Guide

This guide covers deploying the IELTS Proctoring System to Railway as one application service with an external PostgreSQL database.

## Architecture

- **App service**: one Docker service that runs the Rust API, Rust worker, and the built frontend SPA
- **Database**: PostgreSQL as a separate Railway service or other external PostgreSQL instance
- **Object storage**: Railway Volume for local storage mode, or external S3 if you prefer

The browser loads the app from `/` and talks to the backend on the same origin under `/api/v1/*`.

## Prerequisites

1. Railway account: https://railway.app
2. Git repository with this project
3. PostgreSQL database connection string

## 1. Prepare the Repository

Make sure these files are present:

- `backend/Dockerfile`
- `backend/railway.json`
- `.dockerignore`
- `backend/.env.railway` or equivalent Railway variables

The frontend no longer needs a separate Railway service or a separate backend URL.

## 2. Create the Railway Project

1. Go to Railway and create a new project.
2. Connect the GitHub repository.
3. Add or connect one PostgreSQL database service.
4. Add one application service for this repo.

## 3. Configure the App Service

Set the app service to use:

- Dockerfile: `backend/Dockerfile`
- build context: repository root

If you use the committed Railway config, `backend/railway.json` already points Railway at the correct Dockerfile and health check.

### Required Environment Variables

Set these on the app service:

```bash
DATABASE_URL=${DATABASE_URL}
DATABASE_DIRECT_URL=${DATABASE_URL}
DATABASE_WORKER_URL=${DATABASE_URL}
MASTER_KEY_ENABLED=true
MASTER_KEY_USERNAME=your-admin@email.com
MASTER_KEY_PASSWORD=your-secure-password
```

### Common Optional Variables

```bash
API_HOST=0.0.0.0
API_PORT=4000
WORKER_OUTBOX_NOTIFY_CHANNEL=backend_outbox_wakeup
LIVE_MODE_NOTIFY_CHANNEL=backend_live_wakeup
PROMETHEUS_ENABLED=true
LIVE_MODE_ENABLED=true
FEATURE_USE_BACKEND_BUILDER=true
FEATURE_USE_BACKEND_SCHEDULING=true
FEATURE_USE_BACKEND_DELIVERY=true
FEATURE_USE_BACKEND_PROCTORING=true
FEATURE_USE_BACKEND_GRADING=true
OBJECT_STORAGE_BACKEND=local
OBJECT_STORAGE_ENDPOINT=/app/data
OBJECT_STORAGE_BUCKET=ielts-media
OBJECT_STORAGE_REGION=us-east-1
OBJECT_STORAGE_ACCESS_KEY=railway
OBJECT_STORAGE_SECRET_KEY=${RAILWAY_VOLUME_PASSWORD}
OBJECT_STORAGE_FORCE_PATH_STYLE=true
OBJECT_STORAGE_LOCAL_ROOT=/app/data/object-store
MEDIA_BASE_URL=${RAILWAY_PUBLIC_DOMAIN}/media
```

If you use the local object store mode, mount a Railway Volume at `/app/data` on the app service.

## 4. Deploy

1. Deploy the app service.
2. Wait for the Rust build and the frontend build to complete.
3. Confirm the service starts the API and the worker in the same container.

## 5. Verify

Run these checks against the deployed app service URL:

```bash
curl https://your-app-service.up.railway.app/healthz
curl https://your-app-service.up.railway.app/
curl https://your-app-service.up.railway.app/api/v1/auth/session
```

Expected behavior:

- `/healthz` returns `200`
- `/` serves the frontend SPA
- `/api/v1/*` returns backend JSON responses
- direct browser refresh on routes like `/admin/*` still works

## Notes

- Do not create a second frontend service.
- Do not set `VITE_BACKEND_API_URL` for production.
- The frontend and backend share the same origin in production, so the browser should use `/api`.
