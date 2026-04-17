# Rust Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Rust backend that replaces the current localStorage persistence layer with PostgreSQL-backed APIs while preserving the existing frontend route surface and domain behavior during migration.

**Architecture:** Add a Rust workspace under `backend/` with five focused crates: `api`, `worker`, `application`, `infrastructure`, and `domain`. Keep the first rollout as a modular monolith with PostgreSQL as the only hard durable dependency, an outbox-driven worker for background jobs and live fan-out, and repository-level frontend adapters so React routes do not need a full rewrite on day one.

**Tech Stack:** Rust, Axum, Tokio, Tower, SQLx, PostgreSQL, PgBouncer, Moka, object storage/MinIO, OpenTelemetry, Prometheus, Vite/React frontend adapters.

---

## Scope and Execution Rule

This spec spans multiple subsystems. Do not implement it as one uninterrupted branch of work. Execute it as eleven slices, in order, and do not start a later slice until the current slice has passing backend tests and the required frontend contract checks.

## Target File Structure

### Backend files to create

- `backend/Cargo.toml`
- `backend/rust-toolchain.toml`
- `backend/.env.example`
- `backend/docker-compose.yml`
- `backend/Makefile`
- `backend/migrations/0001_roles.sql`
- `backend/migrations/0002_rls_helpers.sql`
- `backend/migrations/0003_exam_core.sql`
- `backend/migrations/0004_library_and_defaults.sql`
- `backend/migrations/0005_scheduling_and_access.sql`
- `backend/migrations/0006_delivery.sql`
- `backend/migrations/0007_proctoring.sql`
- `backend/migrations/0008_grading_results.sql`
- `backend/migrations/0009_media_cache_outbox.sql`
- `backend/crates/domain/src/lib.rs`
- `backend/crates/domain/src/exam.rs`
- `backend/crates/domain/src/schedule.rs`
- `backend/crates/domain/src/attempt.rs`
- `backend/crates/domain/src/grading.rs`
- `backend/crates/infrastructure/src/lib.rs`
- `backend/crates/infrastructure/src/config.rs`
- `backend/crates/infrastructure/src/pool.rs`
- `backend/crates/infrastructure/src/tx.rs`
- `backend/crates/infrastructure/src/actor_context.rs`
- `backend/crates/infrastructure/src/idempotency.rs`
- `backend/crates/infrastructure/src/outbox.rs`
- `backend/crates/infrastructure/src/cache.rs`
- `backend/crates/infrastructure/src/object_store.rs`
- `backend/crates/infrastructure/src/live_mode.rs`
- `backend/crates/application/src/lib.rs`
- `backend/crates/application/src/builder.rs`
- `backend/crates/application/src/library.rs`
- `backend/crates/application/src/scheduling.rs`
- `backend/crates/application/src/delivery.rs`
- `backend/crates/application/src/proctoring.rs`
- `backend/crates/application/src/grading.rs`
- `backend/crates/application/src/results.rs`
- `backend/crates/application/src/media.rs`
- `backend/crates/api/src/main.rs`
- `backend/crates/api/src/router.rs`
- `backend/crates/api/src/state.rs`
- `backend/crates/api/src/http/response.rs`
- `backend/crates/api/src/http/error.rs`
- `backend/crates/api/src/http/auth.rs`
- `backend/crates/api/src/http/request_id.rs`
- `backend/crates/api/src/http/pagination.rs`
- `backend/crates/api/src/routes/health.rs`
- `backend/crates/api/src/routes/exams.rs`
- `backend/crates/api/src/routes/library.rs`
- `backend/crates/api/src/routes/settings.rs`
- `backend/crates/api/src/routes/schedules.rs`
- `backend/crates/api/src/routes/student.rs`
- `backend/crates/api/src/routes/proctor.rs`
- `backend/crates/api/src/routes/grading.rs`
- `backend/crates/api/src/routes/results.rs`
- `backend/crates/api/src/routes/media.rs`
- `backend/crates/api/src/routes/ws.rs`
- `backend/crates/worker/src/main.rs`
- `backend/crates/worker/src/jobs/outbox.rs`
- `backend/crates/worker/src/jobs/retention.rs`
- `backend/crates/worker/src/jobs/media.rs`
- `backend/tests/contracts/builder_contract.rs`
- `backend/tests/contracts/scheduling_contract.rs`
- `backend/tests/contracts/student_contract.rs`
- `backend/tests/contracts/proctor_contract.rs`
- `backend/tests/contracts/grading_contract.rs`
- `backend/tests/integration/rls_smoke.rs`
- `backend/tests/integration/idempotency_smoke.rs`
- `backend/tests/integration/outbox_smoke.rs`
- `backend/tests/integration/mutation_replay.rs`

### Frontend files to modify when adapters land

- `src/app/api/apiClient.ts`
- `src/services/examRepository.ts`
- `src/services/examLifecycleService.ts`
- `src/services/examDeliveryService.ts`
- `src/services/studentAttemptRepository.ts`
- `src/services/gradingRepository.ts`
- `src/services/gradingService.ts`
- `src/services/passageLibraryService.ts`
- `src/services/questionBankService.ts`
- `src/services/adminPreferencesRepository.ts`
- `src/app/data/examQueries.ts`
- `src/app/data/gradingQueries.ts`
- `src/features/student/hooks/useStudentSessionRouteData.ts`
- `src/features/proctor/hooks/useProctorRouteController.ts`

### Frontend tests that must remain green during migration

- `src/services/__tests__/examRepository.test.ts`
- `src/services/__tests__/examLifecycleService.test.ts`
- `src/services/__tests__/examDeliveryService.test.ts`
- `src/services/__tests__/studentAttemptRepository.test.ts`
- `src/services/__tests__/gradingService.test.ts`
- `src/features/student/hooks/__tests__/useStudentSessionRouteData.test.tsx`
- `src/features/proctor/hooks/__tests__/useProctorRouteController.test.tsx`
- `src/features/builder/components/__tests__/PublishActions.test.tsx`
- `src/components/admin/__tests__/AdminScheduling.test.tsx`

## Task 1: Workspace and Local Stack

**Files:**
- Create: `backend/Cargo.toml`
- Create: `backend/rust-toolchain.toml`
- Create: `backend/.env.example`
- Create: `backend/docker-compose.yml`
- Create: `backend/Makefile`
- Create: `backend/crates/api/Cargo.toml`
- Create: `backend/crates/worker/Cargo.toml`
- Create: `backend/crates/application/Cargo.toml`
- Create: `backend/crates/infrastructure/Cargo.toml`
- Create: `backend/crates/domain/Cargo.toml`

- [ ] Create the workspace root and declare the five crates only. Do not add extra crates before a real need appears.
- [ ] Pin the Rust toolchain and edition so CI and local development use the same compiler.
- [ ] Add `docker-compose` services for `postgres`, `pgbouncer`, and `minio` or a filesystem-only dev option. Do not start with cloud-only dependencies.
- [ ] Add a `Makefile` with `db-up`, `db-down`, `migrate`, `api`, `worker`, `fmt`, `clippy`, and `test` targets.
- [ ] Add `.env.example` keys for database URLs, pool limits, object storage, live-mode flags, and feature toggles.
- [ ] Add empty `main.rs` and `lib.rs` stubs so the workspace compiles before any feature code lands.
- [ ] Run `cd backend && cargo test --workspace`.
- [ ] Commit this slice before adding schema or route code.

**Verification:**

- Run: `cd backend && cargo test --workspace`
- Expected: workspace compiles, zero or smoke tests pass, no missing crate references.

## Task 2: Shared Runtime, HTTP Envelope, and Observability

**Files:**
- Create: `backend/crates/infrastructure/src/config.rs`
- Create: `backend/crates/infrastructure/src/pool.rs`
- Create: `backend/crates/api/src/main.rs`
- Create: `backend/crates/api/src/router.rs`
- Create: `backend/crates/api/src/state.rs`
- Create: `backend/crates/api/src/http/response.rs`
- Create: `backend/crates/api/src/http/error.rs`
- Create: `backend/crates/api/src/http/request_id.rs`
- Create: `backend/crates/api/src/routes/health.rs`
- Create: `backend/tests/contracts/builder_contract.rs`

- [ ] Write a failing test that asserts the API success envelope matches the spec shape: `success`, `data`, and `metadata.requestId/timestamp`.
- [ ] Implement shared response and error envelope types in `backend/crates/api/src/http/response.rs` and `backend/crates/api/src/http/error.rs`.
- [ ] Add request ID middleware and make every response include the same request ID.
- [ ] Add `GET /healthz` and `GET /readyz` routes with simple JSON responses first, then wire database readiness after the pool exists.
- [ ] Add `tracing` initialization in `main.rs` and propagate `request_id` into logs.
- [ ] Wire app state with config, pool placeholder, and live-mode flag.
- [ ] Run `cd backend && cargo test --workspace`.
- [ ] Do not add domain routes yet; stop once the shared envelope and app bootstrap are stable.

**Verification:**

- Run: `cd backend && cargo test --workspace`
- Expected: health routes and response envelope tests pass.

## Task 3: Database Roles, RLS Helpers, and Transaction Context

**Files:**
- Create: `backend/migrations/0001_roles.sql`
- Create: `backend/migrations/0002_rls_helpers.sql`
- Create: `backend/crates/infrastructure/src/tx.rs`
- Create: `backend/crates/infrastructure/src/actor_context.rs`
- Create: `backend/tests/integration/rls_smoke.rs`

- [ ] Write a failing integration test that opens a transaction, sets actor context, and proves `current_setting('app.actor_id', true)` is transaction-local.
- [ ] Create `0001_roles.sql` for `app_migrator`, `app_runtime`, `app_worker`, and optional `app_readonly`.
- [ ] Create `0002_rls_helpers.sql` with `app_actor_id()`, `app_role()`, `app_organization_id()`, `app_scope_schedule_id()`, and `app_scope_student_key()`.
- [ ] Add the `tx.rs` helper that begins a transaction and executes all `set_config(..., true)` calls before protected SQL runs.
- [ ] Add `actor_context.rs` types that represent `actor_id`, role, optional organization, optional schedule scope, and optional student scope.
- [ ] Add an integration test that verifies the context disappears after commit and does not leak across transactions.
- [ ] Run `cd backend && cargo test --workspace`.
- [ ] Do not create business tables until this slice passes.

**Verification:**

- Run: `cd backend && cargo test --workspace`
- Expected: transaction-context and helper-function tests pass against PostgreSQL.

## Task 4: Exam, Library, and Settings Schema plus Builder APIs

**Files:**
- Create: `backend/migrations/0003_exam_core.sql`
- Create: `backend/migrations/0004_library_and_defaults.sql`
- Create: `backend/crates/domain/src/exam.rs`
- Create: `backend/crates/application/src/builder.rs`
- Create: `backend/crates/application/src/library.rs`
- Create: `backend/crates/api/src/routes/exams.rs`
- Create: `backend/crates/api/src/routes/library.rs`
- Create: `backend/crates/api/src/routes/settings.rs`
- Create: `backend/tests/contracts/builder_contract.rs`
- Modify: `src/types/domain.ts`
- Modify: `src/services/examRepository.ts`
- Modify: `src/services/examLifecycleService.ts`
- Modify: `src/services/passageLibraryService.ts`
- Modify: `src/services/questionBankService.ts`
- Modify: `src/services/adminPreferencesRepository.ts`
- Modify: `src/app/api/apiClient.ts`

- [ ] Write failing contract tests for `GET /api/v1/exams`, `GET /api/v1/exams/:examId`, `PATCH /api/v1/exams/:examId/draft`, and `GET /api/v1/exams/:examId/validation`.
- [ ] Implement schema for `exam_entities`, `exam_memberships`, `exam_versions`, and `exam_events` with immutable version rows and pointer fields on the entity row.
- [ ] Implement schema for `admin_default_profiles`, `passage_library_items`, and `question_bank_items`.
- [ ] Add RLS policies for the exam and content tables exactly as scoped in the design spec.
- [ ] Implement builder service methods for create exam, save draft, publish-readiness validation, publish, clone, restore, republish, compare, and memberships.
- [ ] Preserve current frontend draft behavior: a successful autosave creates a fresh draft snapshot/version and advances `currentDraftVersionId`.
- [ ] Implement the routes listed in the spec for exams, library, and settings.
- [ ] Add cursor pagination, search, sort, and standard error codes on exam and library list endpoints.
- [ ] Add HTTP adapters in the existing TypeScript repositories behind a feature flag rather than deleting localStorage support immediately.
- [ ] Run backend tests, then run the current builder/admin frontend tests.

**Verification:**

- Run: `cd backend && cargo test --workspace`
- Run: `npm run test:run -- src/services/__tests__/examRepository.test.ts src/services/__tests__/examLifecycleService.test.ts src/features/builder/components/__tests__/PublishActions.test.tsx`
- Expected: backend contracts pass; frontend builder behavior still passes with the adapter enabled or the feature flag defaulted off.

## Task 5: Scheduling, Access, and Runtime Schema plus Admin APIs

**Files:**
- Create: `backend/migrations/0005_scheduling_and_access.sql`
- Create: `backend/crates/domain/src/schedule.rs`
- Create: `backend/crates/application/src/scheduling.rs`
- Create: `backend/crates/api/src/routes/schedules.rs`
- Create: `backend/tests/contracts/scheduling_contract.rs`
- Modify: `src/services/examRepository.ts`
- Modify: `src/services/examDeliveryService.ts`
- Modify: `src/components/admin/AdminScheduling.tsx`
- Modify: `src/app/data/examQueries.ts`

- [ ] Write failing contract tests for schedule list/detail, runtime read, and start/pause/resume/end command responses.
- [ ] Implement schema for `exam_schedules`, `schedule_registrations`, `schedule_staff_assignments`, `exam_session_runtimes`, `exam_session_runtime_sections`, and `cohort_control_events`.
- [ ] Add indexes for schedule list filters and live-runtime reads before adding API handlers.
- [ ] Implement scheduling services for CRUD, pinned-version resolution, runtime plan generation, and control events.
- [ ] Match current UI behavior by allowing published-version preference with draft fallback only where parity is explicitly required.
- [ ] Implement session notes and staff/registration management endpoints in the same slice because the proctor and delivery flows depend on them.
- [ ] Add RLS coverage tests for schedule staff, registration visibility, and schedule-scoped student access.
- [ ] Wire the TypeScript repository/query adapter for schedules and runtime reads.
- [ ] Run backend tests and the existing admin scheduling tests.

**Verification:**

- Run: `cd backend && cargo test --workspace`
- Run: `npm run test:run -- src/components/admin/__tests__/AdminScheduling.test.ts src/services/__tests__/examDeliveryService.test.ts`
- Expected: runtime and schedule contracts pass; admin scheduling remains green.

## Task 6: Student Delivery Bootstrap and Durable Mutation Sync

**Files:**
- Create: `backend/migrations/0006_delivery.sql`
- Create: `backend/crates/domain/src/attempt.rs`
- Create: `backend/crates/application/src/delivery.rs`
- Create: `backend/crates/api/src/routes/student.rs`
- Create: `backend/tests/contracts/student_contract.rs`
- Create: `backend/tests/integration/mutation_replay.rs`
- Modify: `src/types/studentAttempt.ts`
- Modify: `src/services/studentAttemptRepository.ts`
- Modify: `src/services/examDeliveryService.ts`
- Modify: `src/features/student/hooks/useStudentSessionRouteData.ts`

- [ ] Write failing contract tests for `GET /api/v1/student/sessions/:scheduleId`, `POST /precheck`, `POST /bootstrap`, `POST /mutations:batch`, `POST /heartbeat`, and `POST /submit`.
- [ ] Implement schema for `student_attempts`, `student_attempt_mutations`, and `student_heartbeat_events`.
- [ ] Partition `student_attempt_mutations` and `student_heartbeat_events` on first implementation, not later.
- [ ] Implement bootstrap that resolves the registration or the chosen compatibility-mode key, creates or rehydrates the attempt, and returns the current version snapshot plus sync watermark fields.
- [ ] Implement the mutation batch endpoint as the only durable answer-write path. Reject duplicate sequence values within a batch, enforce batch size and payload size, and either apply atomically or return hydration.
- [ ] Persist accepted mutations before the response is returned. Do not acknowledge speculative in-memory state.
- [ ] Implement idempotency behavior for submission and mutation routes with request-hash conflict detection.
- [ ] Implement final submission plus section submission snapshot creation and the speaking-recording finalize gate.
- [ ] Update the frontend student route hook and attempt repository adapter to use HTTP while preserving the current route shape `/student/:scheduleId/:studentId?` until migration is intentionally tightened.
- [ ] Run backend mutation replay tests and current student hook tests.

**Verification:**

- Run: `cd backend && cargo test --workspace`
- Run: `npm run test:run -- src/services/__tests__/studentAttemptRepository.test.ts src/features/student/hooks/__tests__/useStudentSessionRouteData.test.tsx src/services/__tests__/examDeliveryService.test.ts`
- Expected: delivery contracts pass; mutation replay and stale-revision cases are covered; student route tests remain green.

## Task 7: Proctoring Commands, Presence, and Degraded Live Mode

**Files:**
- Create: `backend/migrations/0007_proctoring.sql`
- Create: `backend/crates/application/src/proctoring.rs`
- Create: `backend/crates/api/src/routes/proctor.rs`
- Create: `backend/crates/api/src/routes/ws.rs`
- Create: `backend/crates/infrastructure/src/live_mode.rs`
- Create: `backend/tests/contracts/proctor_contract.rs`
- Create: `backend/tests/integration/outbox_smoke.rs`
- Modify: `src/features/proctor/hooks/useProctorRouteController.ts`
- Modify: `src/services/examDeliveryService.ts`
- Modify: `src/services/examRepository.ts`

- [ ] Write failing contract tests for proctor session list/detail, presence refresh, control commands, warn/pause/resume/terminate, and alert acknowledgement.
- [ ] Implement schema for `student_violation_events`, `proctor_presence`, `session_audit_logs`, `session_notes`, and `violation_rules`.
- [ ] Implement application services for cohort commands and single-student discipline commands with durable audit rows.
- [ ] Implement outbox-backed wake-up records for runtime and roster changes. Do not send socket events directly from request handlers as the only live path.
- [ ] Implement PostgreSQL `LISTEN/NOTIFY` as a freshness hint only, followed by reread-from-DB fan-out.
- [ ] Implement degraded-live-state detection and expose it through HTTP so the frontend can intentionally poll more often.
- [ ] Keep polling-based correctness in place even if sockets are added in the same slice.
- [ ] Update the proctor route controller to consume degraded-live-state and HTTP-backed session/command APIs.
- [ ] Run backend proctor tests plus current frontend proctor hook tests.

**Verification:**

- Run: `cd backend && cargo test --workspace`
- Run: `npm run test:run -- src/features/proctor/hooks/__tests__/useProctorRouteController.test.tsx src/services/__tests__/examDeliveryService.test.ts`
- Expected: proctor contracts pass; control commands are durable; frontend hook behavior still passes.

## Task 8: Grading, Results, Media, Cache, and Worker Foundations

**Files:**
- Create: `backend/migrations/0008_grading_results.sql`
- Create: `backend/migrations/0009_media_cache_outbox.sql`
- Create: `backend/crates/domain/src/grading.rs`
- Create: `backend/crates/application/src/grading.rs`
- Create: `backend/crates/application/src/results.rs`
- Create: `backend/crates/application/src/media.rs`
- Create: `backend/crates/infrastructure/src/idempotency.rs`
- Create: `backend/crates/infrastructure/src/outbox.rs`
- Create: `backend/crates/infrastructure/src/cache.rs`
- Create: `backend/crates/infrastructure/src/object_store.rs`
- Create: `backend/crates/api/src/routes/grading.rs`
- Create: `backend/crates/api/src/routes/results.rs`
- Create: `backend/crates/api/src/routes/media.rs`
- Create: `backend/crates/worker/src/main.rs`
- Create: `backend/crates/worker/src/jobs/outbox.rs`
- Create: `backend/crates/worker/src/jobs/retention.rs`
- Create: `backend/crates/worker/src/jobs/media.rs`
- Create: `backend/tests/contracts/grading_contract.rs`
- Create: `backend/tests/integration/idempotency_smoke.rs`
- Modify: `src/types/grading.ts`
- Modify: `src/services/gradingRepository.ts`
- Modify: `src/services/gradingService.ts`
- Modify: `src/app/data/gradingQueries.ts`

- [ ] Write failing contract tests for grading session list/detail, review draft save/fetch, workflow transitions, result detail, analytics, export, upload intent, and upload finalize.
- [ ] Implement schema for `grading_sessions`, `student_submissions`, `section_submissions`, `writing_task_submissions`, `review_drafts`, `review_events`, `student_results`, `release_events`, `media_assets`, `shared_cache_entries`, `idempotency_keys`, and `outbox_events`.
- [ ] Add worker-safe claim/update functions for outbox publishing and retention cleanup using `FOR UPDATE SKIP LOCKED`.
- [ ] Implement grading draft save with optimistic concurrency and explicit state transitions `draft -> grading_complete -> ready_to_release -> released`.
- [ ] Implement media upload intents, finalize checks, signed download URLs, and orphan cleanup.
- [ ] Implement L1/L2 cache helpers for immutable version payloads, runtime projections, bootstrap payloads, and grading queue summaries.
- [ ] Implement worker jobs for outbox publish, pruning, and media cleanup. Do not mix long-running cleanup work into API handlers.
- [ ] Update TypeScript grading repository/query adapters and keep the current UI payload shapes stable.
- [ ] Run backend grading/results/media tests and current frontend grading service tests.

**Verification:**

- Run: `cd backend && cargo test --workspace`
- Run: `npm run test:run -- src/services/__tests__/gradingService.test.ts`
- Expected: grading and media contracts pass; frontend grading service tests remain green.

## Task 9: Builder/Admin Frontend Adapter Cutover

**Files:**
- Modify: `src/app/api/apiClient.ts`
- Modify: `src/services/examRepository.ts`
- Modify: `src/services/examLifecycleService.ts`
- Modify: `src/services/passageLibraryService.ts`
- Modify: `src/services/questionBankService.ts`
- Modify: `src/services/adminPreferencesRepository.ts`
- Modify: `src/app/data/examQueries.ts`
- Modify: `src/features/admin/hooks/useAdminRootController.ts`

- [ ] Remove direct localStorage reads from the builder/admin repository path when the backend feature flag is enabled.
- [ ] Preserve the existing TypeScript method names and return shapes so route controllers do not need a second rewrite.
- [ ] Keep a localStorage fallback for development only while the backend contract is stabilizing.
- [ ] Add adapter-level tests that prove `getAllExamsWithLegacyMigration`, `getAllVersions`, `getEvents`, `saveSchedule`, and admin-defaults reads still behave as expected.
- [ ] Run the builder/admin query and route tests with the backend adapter enabled.

**Verification:**

- Run: `npm run test:run -- src/services/__tests__/examRepository.test.ts src/services/__tests__/examLifecycleService.test.ts src/components/admin/__tests__/AdminScheduling.test.ts`
- Expected: the admin path works through the adapter without breaking the existing component tests.

## Task 10: Student, Proctor, and Grading Frontend Adapter Cutover

**Files:**
- Modify: `src/services/studentAttemptRepository.ts`
- Modify: `src/services/examDeliveryService.ts`
- Modify: `src/services/gradingRepository.ts`
- Modify: `src/services/gradingService.ts`
- Modify: `src/features/student/hooks/useStudentSessionRouteData.ts`
- Modify: `src/features/proctor/hooks/useProctorRouteController.ts`
- Modify: `src/app/data/gradingQueries.ts`

- [ ] Replace localStorage-backed attempt persistence with HTTP-backed bootstrap, mutation sync, heartbeat, and submit flows.
- [ ] Keep the local unsaved-answer UX state in React, but do not present data as durable until the backend confirms it.
- [ ] Replace proctor roster/control reads with backend APIs and keep polling as the baseline correctness path.
- [ ] Replace grading data reads and review-draft writes with backend APIs without changing the current UI state model.
- [ ] Run all student, proctor, and grading tests together after this cutover because they share schedule/runtime assumptions.

**Verification:**

- Run: `npm run test:run -- src/services/__tests__/studentAttemptRepository.test.ts src/services/__tests__/examDeliveryService.test.ts src/features/student/hooks/__tests__/useStudentSessionRouteData.test.tsx src/features/proctor/hooks/__tests__/useProctorRouteController.test.tsx src/services/__tests__/gradingService.test.ts`
- Expected: delivery, proctoring, and grading frontend tests all pass on the adapter path.

## Task 11: Hardening, Load, Retention, and Ops Readiness

**Files:**
- Modify: `backend/crates/api/src/main.rs`
- Modify: `backend/crates/worker/src/main.rs`
- Modify: `backend/crates/worker/src/jobs/outbox.rs`
- Modify: `backend/crates/worker/src/jobs/retention.rs`
- Modify: `backend/.env.example`
- Modify: `backend/Makefile`
- Create: `backend/docs/operations.md`

- [ ] Add Prometheus metrics for request latency, DB latency, WebSocket counts, outbox backlog, publish validation, answer commit latency, and violation-to-alert latency.
- [ ] Add OpenTelemetry spans for publish, bootstrap, mutation batch, submit, grading draft save, and release flows.
- [ ] Implement retention jobs for cache rows, idempotency keys, heartbeat rows, attempt mutations, orphaned media, and published outbox rows.
- [ ] Add storage-budget monitoring and alert thresholds at `750 MB`, `850 MB`, and `950 MB`.
- [ ] Load test the system for the schedule-start surge, burst mutation traffic, sustained heartbeats, and worker/API restart during live traffic.
- [ ] Rehearse backup restore and failover procedures before declaring the backend production-ready.
- [ ] Remove the frontend localStorage fallback only after this slice passes and rollback steps are documented.

**Verification:**

- Run: `cd backend && cargo test --workspace`
- Run: `cd backend && cargo fmt --all --check`
- Run: `cd backend && cargo clippy --workspace --all-targets -- -D warnings`
- Run: `npm run test:run`
- Expected: backend quality gates pass, frontend suite passes, retention and load-test evidence exists in docs or CI artifacts.

## Delivery Milestones

- [ ] Milestone A: Tasks 1-4 complete. Builder, library, and settings backend is real and contract-tested.
- [ ] Milestone B: Task 5 complete. Scheduling, access, and runtime APIs are real and frontend-compatible.
- [ ] Milestone C: Tasks 6-7 complete. Student delivery and proctoring are durably backed by PostgreSQL, with degraded live mode in place.
- [ ] Milestone D: Task 8 complete. Grading, results, media, cache, and worker flows are real.
- [ ] Milestone E: Tasks 9-11 complete. Frontend is cut over, load-tested, and operationally ready.

## First Sprint Recommendation

Do not start with delivery or WebSockets. The first sprint should end with a running backend, migrations, actor-context transaction helpers, and the full builder/library/settings slice. That gives the team a stable schema, auth boundary, and adapter pattern before touching live exam flows.

## Spec Coverage Check

- Builder and exam lifecycle: covered by Task 4.
- Content library and defaults: covered by Task 4.
- Scheduling and admin: covered by Task 5.
- Student delivery and mutation batch contract: covered by Task 6.
- Proctoring, wake-up signaling, and degraded live mode: covered by Task 7.
- Grading, results, release workflow, and media: covered by Task 8.
- Caching, idempotency, outbox, retention, and worker access model: covered by Tasks 3, 7, 8, and 11.
- Frontend migration seams: covered by Tasks 9 and 10.
- Observability, load, DR, and ops: covered by Task 11.
