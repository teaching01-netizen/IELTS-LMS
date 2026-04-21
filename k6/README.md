# k6 Prod Load (API-level) — IELTS-like (Skip Speaking)

This repository has a Playwright prod E2E that matches real browser UX, but it can be slow and flaky at scale.
For faster feedback and higher concurrency, use **k6** to drive the **same production APIs** the UI uses.

Important limits:
- k6 **does not validate UI** (fullscreen/media permissions, rendering, client-side routing).
- k6 **is ideal for load/perf** and backend correctness of the core exam loop.

## What this script does
- **Students**: `/api/v1/auth/student/entry` → `/api/v1/student/sessions/:scheduleId/bootstrap` → `/precheck` → poll session until runtime `live` → submit a small mutation batch (position + answer + writing + violation where possible) → `/submit`
- **Control (proctor + admin verify)**:
  - Proctor: login → `presence join/heartbeat` → wait for `checkedIn >= threshold` → **Start Exam** via `/api/v1/schedules/:scheduleId/runtime/commands` (`start_runtime`) → optional monitoring/interventions → **End Exam** via `end_runtime`
  - Admin verify: poll `/api/v1/grading/sessions` until `submittedCount >= students`, then confirm submissions via `/api/v1/grading/sessions/:scheduleId`

## Inputs
- Target (non-secrets): `e2e/prod-data/prod-target.json`
- Secrets (local/CI mounted): `e2e/prod-data/prod-creds.json`
- Optional runtime override (from Playwright bootstrap): `e2e/.generated/prod-runtime.json`

## Run (minimal N)
From repo root:

```bash
K6_STUDENTS=3 \
K6_PROCTORS=1 \
K6_CHECKED_IN_THRESHOLD=1 \
k6 run k6/prod-exam-day.js
```

Optional interventions:
```bash
K6_PROCTOR_WARN=true \
K6_STUDENT_VIOLATIONS=true \
k6 run k6/prod-exam-day.js
```

## Run (bigger)
```bash
K6_STUDENTS=100 \
K6_CHECKED_IN_THRESHOLD=95 \
k6 run k6/prod-exam-day.js
```

## Common overrides
- `K6_BASE_URL` (default from `prod-target.json`)
- `K6_SCHEDULE_ID` (default from runtime override, else `prod-target.json`)
- `K6_TARGET_PATH` (default `e2e/prod-data/prod-target.json`)
- `K6_CREDS_PATH` (default `e2e/prod-data/prod-creds.json`)
- `K6_RUNTIME_PATH` (default `e2e/.generated/prod-runtime.json`)
- `K6_STUDENT_JITTER_MAX_SECONDS` (default `30`)
- `K6_WAIT_FOR_LIVE_TIMEOUT_SECONDS` (default `1200`)
- `K6_STUDENT_WORK_SECONDS` (default `60`)
- `K6_PROCTOR_MONITOR_SECONDS` (default `180`)
- `K6_WAIT_FOR_SUBMISSIONS_TIMEOUT_SECONDS` (default `1200`)
- `K6_USE_EDITOR_AS_PROCTOR` (set `true` to use editor creds for proctor actions)
- `K6_VERIFY_SUBMISSIONS` (set `false` to skip grading-based verification)
