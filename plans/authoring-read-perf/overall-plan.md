# Authoring Exams Read-Path Performance — Overall Plan

## Goal
Make `GET /api/v1/assessment-authoring/exams/{examID}/shell`, `POST .../shell` (existing-draft shortcut), and `GET .../preview` measurably faster for a full SAT draft (2 sections, 6 modules, ~150 questions) while preserving:
- identical JSON contracts (`api/openapi/openapi.yaml`),
- role + tenant authorization,
- draft-vs-published isolation,
- optimistic-concurrency / revision fences on writes,
- preview answer-key redaction,
- existing write-path behavior (create/batch/duplicate/bulk/reorder/save-revision/delivery-settings/workbook commit/undo/publish).

Out of scope: workbook commit/undo write optimization, scoring changes, new infrastructure (Redis/CDN), schema migrations unless a phase proves one necessary.

## Current architecture (confirmed in code)
```text
React (useAuthoringShell -> openShell POST)
  -> ApiClient baseURL /api + envelope unwrap
  -> chi TierWrites + adminLimit + authorize()
  -> requireAuthoringExam{Read,Write} (role + Exams.GetForActor tenant check)
  -> authoring.Service.Shell / OpenShell / Preview
     -> exam_entities -> exam_versions -> loadSections -> per-section loadModules -> per-module loadQuestionValidationRows -> row.summary() (validateSATQuestion + JSON parsing per question)
  -> Preview additionally calls delivery.NewService(...).LoadSections (fresh N+1 service without app.Versions cache)
```
Confirmed hotspots:
1. Shell N+1 fanout: ~13 service SELECTs for 2 sections/6 modules (service.go:374,1694-1802; readiness.go:108-142).
2. Preview double-build: full Shell then full delivery LoadSections; delivery projection discarded from first build (service.go:649-661).
3. POST /shell on every frontend shell query incl. refetch: write Tx + exam FOR UPDATE even when draft exists (service.go:404-444; assessmentQueries.ts:24-29).
4. Per-question CPU: validateSATQuestion + multiple json unmarshal/marshal + preview truncation per summary (readiness.go:144-207).
5. Delivery VersionCache exists (delivery.NewVersionCache, App.Versions wired in main.go:170) but authoring Preview constructs a bare NewService without it — cache present-but-unused on this path.

## Phases
- Phase 01 — Measurement & acceptance baseline (blocks all implementation).
- Phase 02 — Database/read-shape foundation (bulk loaders + consistent-snapshot read).
- Phase 03 — Backend service/handler changes (Shell bulk path, Preview single-build, OpenShell fast-path split).
- Phase 04 — Frontend lifecycle (GET for refresh, explicit open-draft action, query-cache policy).
- Phase 05 — Testing, verification, observability, rollout.

```text
Phase 01 (measurement)
   ↓
Phase 02 (bulk read foundation)
   ↓
Phase 03 (backend wiring)
   ↓
Phase 04 (frontend lifecycle)   ← depends on 03 contract stability; can draft in parallel, implement after 03
   ↓
Phase 05 (full verification + rollout)
```

## Execution waves
- Wave 1: Phase 01.
- Wave 2: Phase 02.
- Wave 3: Phase 03 (+ Phase 04 planning/contract review in parallel, no implementation).
- Wave 4: Phase 04 implementation.
- Wave 5: Phase 05.
Never run implementation of a phase before its dependencies verify green.

## Completion criteria
- p50/p95/p99 shell+preview latency improved vs Phase-01 baseline on same fixture/concurrency; no regression in write-path SLOs.
- Byte/field-level contract equivalence on shell/preview (modulo ordering guarantees already in contract).
- Authz matrix green (admin/builder/observer/tenant isolation).
- Preview redaction proof (no answer keys).
- Full gate: typecheck, lint, backend tests, frontend tests, contract/openapi drift check, build, migration check (none expected).
