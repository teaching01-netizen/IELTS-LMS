# Session Template

## 1) Behavior excavation

Feature or scenario:

Admin triggers whole-schedule objective regrade using the exam's latest draft version (not the published version).

Invariants (must always hold):

1. Student submitted answers remain immutable; regrading must not mutate stored answers.
2. Regrading must be deterministic for a given draft version id + override set + stored answers.
3. Regrading must be auditable: record who triggered it, why, and which draft version id was used.

Forbidden outcomes (must never happen):

1. Writing/speaking grading data is modified by the objective regrade action.
2. Regrading uses the schedule's published version snapshot when latest draft mode is requested.
3. Regrading silently proceeds when the exam has no current draft version id.

Boundary conditions:

1. Schedule has zero submissions: endpoint should succeed and report 0 scanned/updated.
2. Exam has no draft version: endpoint returns validation error.
3. Draft snapshot diverges from student answer ids: expected that many answers become incorrect, but system must still complete.

Failure modes:

1. Draft version id exists but the version row is missing: fail with validation/not-found (no partial updates).
2. Partial DB failure mid-run: must not corrupt answers; section_submissions updates are per-submission UPSERTs.
3. Concurrent triggers: last write wins for section_submissions auto_grading_results; audit should show both triggers.

Concurrency scenarios:

1. Two admins click regrade concurrently for the same schedule.
2. Regrade runs while an override is being saved (override-triggered regrade).
3. Regrade runs while grading session projection is syncing.

Duplication/idempotency scenarios:

1. Same admin clicks regrade twice with same draft version: second run should result in 0 updates.
2. Regrade is retried after a transient failure: repeated calls should converge without double-writing answers.
3. Overrides unchanged: only draft snapshot difference should drive result changes.

## 2) Test sequence plan

Test 1 - Regrading objectives uses latest draft snapshot and updates stored objective scores for the schedule

- Protects: correctness of "latest draft" source-of-truth and bulk schedule update.
- Level (unit/integration/concurrent): integration (contract test with real DB + router).
- Real vs mocked dependencies (and justification): real DB + real services; no deterministic mocks needed.
- Realistic input: schedule with 1 submitted attempt; published correct answers differ from a new draft correct answers.
- Assertion: after calling regrade endpoint, reading/listening auto grading totals change to reflect draft snapshot.
- Expected red message: HTTP 404 (route missing) or totals unchanged.

Test 2 - Regrade endpoint rejects when exam has no current draft version

- Protects: fail-closed behavior for missing draft.
- Level: integration.
- Real vs mocked dependencies: real DB.
- Realistic input: schedule where exam current_draft_version_id is NULL.
- Assertion: HTTP 422 with validation error.
- Expected red message: endpoint returns 200 or wrong error code.

Test 3 - Regrade action appends audit events including draftVersionId and reason

- Protects: traceability requirement.
- Level: integration.
- Real vs mocked dependencies: real DB.
- Realistic input: schedule + admin call with reason.
- Assertion: two events inserted (triggered/completed) with payload containing draftVersionId + reason.
- Expected red message: no events or missing payload.

## 3) Cycle log

Red confirmed:

- Failure message:
- Why this is true red:

Minimum implementation added:

- Behavior implemented:

Green confirmed:

- Tests passing:

Refactor performed:

- Changes:
- Tests still passing:

## 4) Next-test selection

Uncovered production conditions:

- [ ] Concurrent duplicate calls
- [ ] Dependency failure mid-execution
- [ ] Boundary at zero submissions
- [ ] Missing draft version
- [ ] Audit payload completeness

Next failing test to write:

