# Preview schedules never surface in grading

## Ownership

The grading queue (`/admin/grading`) is owned by:

- `src/services/gradingService.ts` — consumer boundary for the admin UI
  (`getSessionQueue`, `getSessionQueueSummary`).
- `backend/crates/application/src/grading/mod.rs` — authoritative
  `list_sessions` read model over the materialized `grading_sessions` table.
- `backend/crates/application/src/student_access/repository.rs` —
  `is_preview_runtime_schedule` (schedule access gate).

Preview schedules are created by the builder preview runtime
(`src/features/builder/services/previewRuntimeSessionService.ts`). They are
real `exam_schedules` rows with the reserved cohort namespace
`__preview_runtime__:` (and `institution = 'preview-runtime'`), so the grading
projection materializes them like any other schedule.

## Invariant

A schedule whose `cohort_name` starts with `__preview_runtime__:` is a preview
schedule and must never appear in the grading queue, its summary stats, or any
grader-facing session list. Graders grade real candidates only.

Enforcement points (all keyed on the cohort prefix, matching the frontend
`isPreviewRuntimeCohortName` contract):

1. `GradingService::list_sessions` — SQL excludes
   `cohort_name NOT LIKE '__preview_runtime__:%'` in every access branch, so
   preview rows cannot displace real sessions under the LIMIT cap.
2. `gradingService.getSessionQueue` / `getSessionQueueSummary` — post-filter
   drops any preview session the backend may still return (defense in depth for
   stale rows and local/dev fixtures).
3. `gradingService.buildGradingSessions` — already skips preview schedules when
   building sessions locally.

## Failure case note

If a preview session appears in the queue, it means either `list_sessions` lost
the SQL exclusion (check the admin and scoped query branches) or the frontend
post-filter was removed. The preview schedule itself is expected to exist and to
be cleaned up by TTL; do not "fix" this by deleting preview schedules from
`exam_schedules` — that breaks active preview sessions.

## Verification commands

```text
cd backend
cargo test -p ielts-backend-application grading::tests:: --lib

cd ..
npx vitest run src/services/__tests__/gradingService.local.test.ts
```
