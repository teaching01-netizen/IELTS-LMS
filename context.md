# IELTS Proctoring System — Business Logic Context

This document describes the **business logic and domain rules** implemented by this webapp (frontend + backend). It’s intended as a shared source of truth for product behavior (what the system does), not implementation mechanics (how SQL is written, UI layout, etc.).

## Scope

**Includes**
- Auth, roles, sessions, and student entry.
- Exam lifecycle (draft/version/publish), validation, and audit events.
- Scheduling (cohorts), runtime (section plan + live/pause/complete), and auto-stop.
- Student delivery runtime phases, integrity + proctoring enforcement, offline buffering, heartbeats, and submission.
- Proctor monitoring + interventions (presence, warnings, pausing, termination, runtime controls).
- Library (passages + question bank) and media uploads.
- Grading + results release.
- Live updates/outbox and “degraded live mode”.

**Excludes**
- Build/deploy, logging/telemetry wiring, and purely presentational UI concerns.
- Node/Rust dependency details.

## Product surfaces (route-backed)

Source: `src/app/router/route-manifest.ts`, `src/routes/index.tsx`

- **Auth**
  - `/login`
  - `/activate`
  - `/password/reset` + `/password/reset/complete`
- **Admin**
  - `/admin/*` (exams, library, scheduling, grading, results, settings)
- **Builder**
  - `/builder/:examId` (config)
  - `/builder/:examId/builder` (content builder)
  - `/builder/:examId/review` (publish review)
- **Proctor**
  - `/proctor` (monitoring + interventions)
- **Student**
  - `/student/:scheduleId` (public check-in → issues session)
  - `/student/:scheduleId/register` (legacy alias → redirects to check-in)
  - `/student/:scheduleId/:wcode` (authenticated student session; phases are internal)
    - Phases: `pre-check` → `lobby` → `exam` → `post-exam`

## Roles and permissions

### Roles

Backend domain role values: `backend/crates/domain/src/auth.rs`
- `admin`, `builder`, `proctor`, `grader`, `student`

Backend service actor roles (used for authorization checks): `backend/crates/infrastructure/src/actor_context.rs`
- `admin`, `admin_observer`, `builder`, `proctor`, `grader`, `student`

Frontend route gating: `src/features/auth/RequireAuth.tsx`, `src/routes/index.tsx`
- `/admin/*`: `admin`, `builder`, `grader`
- `/builder/*`: `admin`, `builder`
- `/proctor`: `admin`, `proctor`
- `/student/:scheduleId/:wcode`: `student` **and** staff roles (for support/impersonation style access)

### High-level authorization rules

Source: `backend/crates/infrastructure/src/authorization.rs`
- **Admins / Admin observers**: can access everything.
- **Builder**: can access org-scoped exams/schedules.
- **Proctor / Grader**: org-scoped + typically schedule-scoped access (cohort assignment).
- **Student**: schedule-scoped + student-scoped (student key) access.

> Note: There is also a DB-backed staff assignment check for some staff flows (e.g., `schedule_staff_assignments`) in `backend/crates/application/src/auth.rs`.

## Core entities and state machines

### Exams

Source: `backend/crates/domain/src/exam.rs`

- **ExamEntity**
  - Fields: `status`, `visibility`, `organization_id`, `current_draft_version_id`, `current_published_version_id`, `revision`…
  - Status enum includes: `draft`, `in_review`, `approved`, `rejected`, `scheduled`, `published`, `archived`, `unpublished`
    - Backend currently **enforces** draft saving + publishing; other statuses exist for future/work-in-progress.
- **ExamVersion**
  - `content_snapshot`: full exam content state
  - `config_snapshot`: exam config (sections, security policy, etc.)
  - `is_draft`, `is_published`
- **ExamEvent**
  - Audit trail for lifecycle actions (`DraftSaved`, `Published`, etc.)
- **Optimistic concurrency**
  - Most mutable records carry `revision` and reject updates when caller revision is stale.

Frontend lifecycle modeling: `src/services/examLifecycleService.ts`
- Defines allowed status transitions (some are UI-only today; backend primarily supports draft/publish).
- Produces publish readiness checks and drives UI guards.

### Schedules (cohorts) + Runtime

Source: `backend/crates/domain/src/schedule.rs`, `backend/crates/application/src/scheduling.rs`

- **ExamSchedule**
  - Time window: `start_time` → `end_time`
  - `planned_duration_minutes` derived from enabled section plan
  - `auto_start` (present), `auto_stop` (enforced in runtime reads)
  - `status`: `scheduled` | `live` | `completed` | `cancelled`
- **ExamSessionRuntime**
  - `status`: `not_started` | `live` | `paused` | `completed` | `cancelled`
  - `active_section_key`, `current_section_remaining_seconds`
  - `sections`: list of `RuntimeSectionState`
- **RuntimeSectionState**
  - `status`: `locked` | `live` | `paused` | `completed`
  - Timing bookkeeping: projected vs actual start/end, paused time, extensions
- **CohortControlEvent**
  - Records proctor/system runtime commands (start/pause/resume/extend/end/complete)

### Student registrations + attempts

Source: `backend/crates/domain/src/schedule.rs`, `backend/crates/domain/src/attempt.rs`, `backend/crates/application/src/delivery.rs`

- **ScheduleRegistration**
  - Primary identity: `wcode` (format `W` + 6 digits)
  - `student_key` (used by student attempt/session): `student-{schedule_id}-{wcode}`
  - `access_state` starts at `invited` (future states exist: `checked_in`, `submitted`, etc.)
- **StudentAttempt**
  - `phase`: `pre-check` | `lobby` | `exam` | `post-exam`
  - Answer stores:
    - `answers` (objective)
    - `writing_answers`
    - `flags`
  - Integrity/recovery snapshots:
    - `integrity` (precheck payload, device fingerprint, last heartbeat timestamps/status)
    - `recovery` (pending mutation count, last persisted, server accepted sequence watermark)
  - `final_submission` + `submitted_at` once submitted
- **StudentAttemptMutation**
  - Stores client mutation events (`answer`, `writing_answer`, `flag`, `position`, `violation`)
  - Uses monotonically increasing `seq` per attempt/client session for server ordering.

### Proctoring artifacts

Source: `backend/crates/domain/src/schedule.rs`, `backend/crates/application/src/proctoring.rs`

- **SessionAuditLog**
  - Durable monitoring evidence (network, warnings, auto-actions, etc.)
  - Can be “acknowledged” by staff to clear alerts.
- **Violation rules** (domain shape exists; enforcement may be incremental)
- **Presence**
  - Tracks proctors who have joined/are monitoring a schedule.
- **Student violations**
  - Stored in `student_violation_events` and mirrored into attempt `violations_snapshot`.

### Grading + results

Source: `backend/crates/domain/src/grading.rs`, `backend/crates/application/src/grading.rs`

- **GradingSession** (materialized from schedules)
- **StudentSubmission** (materialized from attempts with `final_submission`)
  - `grading_status`: `submitted` → `in_progress` → `grading_complete` → `ready_to_release` → `released` (plus reopen paths)
- **ReviewDraft**
  - Grader working state (annotations, checklist, summary, etc.)
  - Optimistic concurrency via `revision` when saving drafts.
- **StudentResult**
  - `release_status`: `draft` | `grading_complete` | `ready_to_release` | `released` | `reopened`
  - Release event history in `release_events`.

## Business flows (end-to-end)

### 1) Staff authentication (login / activation / reset)

Source: `backend/crates/application/src/auth.rs`

- **Login**
  - Normalizes email to lowercase.
  - Rejects `disabled` and `pending_activation`.
  - Locks account after **5** failed login attempts for **15 minutes** (`state=locked`, `locked_until=now+15m`).
  - On success: resets counters and **revokes existing active sessions** (“rotate on login”), then creates a new session.
- **Sessions**
  - Session token is stored as a **hash** in DB; client holds the raw cookie value.
  - Session has:
    - `expires_at` (hard expiry)
    - `idle_timeout_at` (rolling idle expiry) and is extended on use
  - Idle timeout differs:
    - Students: `session_idle_timeout_student_minutes`
    - Staff: `session_idle_timeout_staff_minutes`
- **Password reset**
  - Request: generates token (stored hashed) with **15 minute** expiry.
  - Complete: validates unused + not expired, updates password hash, marks token used, revokes sessions, and creates new session.
- **Account activation**
  - Validates activation token (unused + not expired)
  - Sets password credential and flips user state to `active`
  - Creates a session.
- **Master key login (break-glass)**
  - If enabled, a configured username/password can log in as an admin user (ensured/created in DB).

### 2) Exam lifecycle (drafts + versions + publish)

Backend source of truth: `backend/crates/application/src/builder.rs`

- **Create exam**
  - Creates `exam_entities` with status `draft` and emits an `ExamEventAction::Created`.
- **Save draft**
  - Requires matching `exam.revision` (optimistic concurrency).
  - Creates a **new** `exam_versions` row with `is_draft=true`.
  - Updates `exam_entities.current_draft_version_id` and increments `exam_entities.revision`.
  - Emits `ExamEventAction::DraftSaved`.
- **Validate exam (publish readiness)**
  - Errors:
    - Title is required
    - Draft version must exist
  - Warnings:
    - Draft content/config snapshot is empty
  - `can_publish=true` only if **no errors**.
- **Publish**
  - Requires matching `exam.revision` and requires a current draft version.
  - Flips the draft version to `is_published=true`, `is_draft=false`.
  - Updates `exam_entities`:
    - `current_published_version_id = draft_version_id`
    - `current_draft_version_id = NULL`
    - `status = published`
    - `published_at = NOW()`
    - `revision = revision + 1`
  - Emits `ExamEventAction::Published`.

Frontend lifecycle helpers: `src/services/examLifecycleService.ts`
- Drives UI guardrails, drafts, and publish readiness display.

### 3) Scheduling a cohort

Backend source of truth: `backend/crates/application/src/scheduling.rs`

- **Schedule creation requires**
  - Published version belongs to the exam.
  - Section plan is valid (see next).
  - Scheduled time window can contain the planned duration.
- **Section plan derivation**
  - Reads `exam_versions.config_snapshot.sections`
  - Modules considered: `listening`, `reading`, `writing`, `speaking`
  - For each enabled section:
    - `duration` must be **> 0**
    - `gapAfterMinutes` must be **>= 0**
    - `order` decides sort order (defaults to standard module order)
  - Computes:
    - `start_offset_minutes`, `end_offset_minutes` per section
    - `planned_duration_minutes = last(end_offset_minutes)`
  - At least one section must be enabled.
- **Schedule window validation**
  - `end_time` must be after `start_time`
  - `window_minutes >= planned_duration_minutes`

Frontend schedule validation mirrors backend rules: `src/services/examDeliveryService.ts`

### 4) Student registration + public entry

Backend source of truth: `backend/crates/application/src/scheduling.rs`, `backend/crates/application/src/auth.rs`

- **Registration**
  - `wcode` validation: must match `^W[0-9]{6}$` (e.g., `W250334`)
  - Email validation: simple `something@something.tld` regex
  - If the wcode is already registered:
    - If it’s the **same user** (same `user_id` or `actor_id`), treat as idempotent and update contact info.
    - Otherwise, return conflict (“already registered”).
  - New registrations start at `access_state = invited`.
- **Student entry (public route)**
  - `/api/v1/auth/student/entry` issues a standard app session cookie for a **student user**.
  - It creates/ensures a user with an internal email:
    - `student+{scheduleId}+{wcode}@wcode.invalid`
  - Display name defaults to `Student {WCODE}` if blank.
  - Frontend entry routes:
    - Check-in UI: `/student/:scheduleId`
    - Alias: `/student/:scheduleId/register`
    - Delivery session requires a validated wcode segment: `/student/:scheduleId/:wcode`

### 5) Student delivery lifecycle (precheck → lobby → exam → post-exam)

Backend source of truth: `backend/crates/application/src/delivery.rs`

- **Phase selection** (`determine_phase`)
  - If already submitted → `post-exam`
  - Else if runtime is `live`/`paused` → `exam`
  - Else if runtime `completed`/`cancelled` → `post-exam`
  - Else if precheck completed → `lobby`
  - Else → `pre-check`
- **Precheck persistence**
  - Stores `integrity.preCheck`, `integrity.deviceFingerprintHash`, and `integrity.clientSessionId`.
  - Writes a `session_audit_logs` entry `STUDENT_PRECHECK`.
- **Attempt bootstrap**
  - Ensures a `StudentAttempt` exists for `student_key` (or derives one from `candidate_id`).
  - Initializes integrity and recovery snapshots (heartbeat timestamps, sync state, mutation watermark).
- **Answer mutation model**
  - Client sends mutation batches with a **contiguous increasing sequence**.
  - Server:
    - Validates batch sequencing.
    - Persists mutations.
    - Applies recognized mutations to the attempt snapshot.
- **When objective mutations are accepted**
  - Only while runtime is `live`/`paused`.
  - Or for **120 seconds** after runtime becomes `completed` (grace period).
  - Position mutations are allowed even after objective mutations are blocked (to keep proctor UI aligned).
- **Submission**
  - Allowed only when attempt phase is `exam` or `post-exam`.
  - Requires schedule not cancelled and runtime started (`live`/`paused`/`completed`).
  - Writes `final_submission`, sets `phase=post-exam`, and sets `submitted_at`.
  - Idempotent via `Idempotency-Key`.
- **Auto-submission**
  - When runtime completes (proctor completion or auto-stop), all attempts without `submitted_at` are auto-submitted with:
    - `final_submission.autoSubmission = true`
    - `final_submission.completionReason = <reason>`

Frontend student route + phase handling: `src/features/student/routes/StudentSessionRoute.tsx`

### 6) Student integrity + “secure mode” enforcement (frontend)

The frontend enforces security policies for deterrence and auditability; the backend persists the evidence snapshots and proctor interventions.

#### Pre-check rules

Source: `src/components/student/PreCheck.tsx`

Checks:
- Browser compatibility (Chrome/Edge 111+, Safari, Firefox)
- JavaScript timers available
- Fullscreen API available **if required**
- Local storage availability
- Online/heartbeat readiness
- Secondary screen detection capability **if enabled**
  - Clipboard restrictions **if enabled** (`security.blockClipboard=true`)

Mobile/iPad rule:
- If **secure mode** is enabled (`requireFullscreen` or `detectSecondaryScreen`), mobile/iPad is **not allowed**.

Safari secondary-screen rule:
- If `detectSecondaryScreen` is enabled but `getScreenDetails` is unsupported:
  - If `allowSafariWithAcknowledgement=true`: precheck can proceed but requires candidate acknowledgement.
  - Otherwise Safari is blocked for that exam config.

#### During exam: network/heartbeat continuity

Source: `src/components/student/providers/StudentNetworkProvider.tsx`, `src/services/studentIntegrityService.ts`

- On going offline:
  - Records audit `NETWORK_DISCONNECTED`.
  - Optionally blocks exam (`pauseOnOffline=true`).

#### During exam: clipboard / shortcut restrictions

Source: `src/components/student/providers/StudentKeyboardProvider.tsx`

- When `config.security.blockClipboard=true`, the client blocks clipboard interactions during `phase=exam`:
  - Copy/cut/paste, context menu, and common “exam escape” shortcuts (print/save/find).
- When `config.security.blockClipboard=false`, clipboard operations are allowed (devtools/inspector shortcuts may still be restricted).
  - Sets attempt sync state to `offline`.
- On reconnect:
  - Blocks with `syncing_reconnect`.
  - Optionally refreshes runtime snapshot.
  - Optionally enforces device continuity:
    - If device fingerprint hash changes → critical violation + blocks with `device_mismatch`.
  - Flushes buffered mutations; unblocks when saved.
- Heartbeat loop (only in phase `exam` and when online):
  - Sends heartbeat at `heartbeatIntervalSeconds`.
  - Tracks consecutive failures:
    - At `heartbeatWarningThreshold` → audit `HEARTBEAT_MISSED`
    - At `heartbeatHardBlockThreshold` → violation `HEARTBEAT_LOST`, blocks exam, audit `HEARTBEAT_LOST`

#### During exam: tab switching, fullscreen, secondary screens

Source: `src/components/student/providers/StudentProctoringProvider.tsx`

- Tab switching
  - `tabSwitchRule = none`: ignore
  - `warn`: logs a medium violation after debounce
  - `terminate`: critical violation → terminate
- Fullscreen
  - If `requireFullscreen=true`, requests fullscreen when exam starts.
  - On iPadOS Safari/Chrome, fullscreen is best-effort:
    - Text input and viewport-settling exits are deferred before enforcement.
    - Re-entry is retried from user gestures such as tap/touch or the fullscreen overlay action.
  - On exit from fullscreen:
    - If violations exceed `fullscreenMaxViolations` → terminate
    - Else:
      - If `fullscreenAutoReentry=true`: retry entering fullscreen up to 3 attempts (backoff)
      - If `fullscreenAutoReentry=false`: high severity violation
- Secondary screen detection
  - If enabled, polls every 15 seconds using `window.getScreenDetails()`:
    - If multiple screens detected → high violation
  - Unsupported / permission denied are recorded as audits.

#### Violation severity thresholds (frontend)

Source: `src/components/student/providers/StudentProctoringProvider.tsx`, `src/types.ts`

- Critical violations always terminate.
- High severity breaches can pause or terminate depending on:
  - `config.progression.allowPause`
  - `config.security.severityThresholds`
- Medium/low threshold breaches typically “warn” (log + display) rather than immediately blocking.

### 7) Proctor monitoring + interventions

Backend source of truth: `backend/crates/application/src/proctoring.rs`

#### Session overview
- Lists schedules and their runtime snapshots.
- Metrics:
  - `studentCount`: total attempts for schedule
  - `activeCount`: attempts in phase `exam` and not `paused`/`terminated`
  - `alertCount`: unacknowledged audit logs of key action types (heartbeat lost, device mismatch, network disconnect, proctor actions)
  - `violationCount`: count of violation events
- “Degraded live mode” (see live updates) is shown per schedule.

#### Presence
- `join`: upserts presence and refreshes `joined_at`.
- `heartbeat`: upserts presence and refreshes `last_heartbeat_at` only.
- `leave`: sets `left_at`.

#### Runtime controls
- **End section now**
  - Marks active section as completed (`completion_reason=proctor_end`).
  - Starts the next locked section (if any), otherwise completes the runtime and schedule.
  - Emits outbox event (`schedule_runtime`, `runtime_changed`).
  - Writes audit logs (`SECTION_END`, optionally `SECTION_START`).
- **Extend section**
  - Adds minutes to section extension and adds seconds to runtime remaining.
  - Emits outbox event and audit log (`EXTENSION_GRANTED`).
- **Complete exam**
  - Completes runtime + schedule and auto-submits remaining attempts.
  - Emits outbox event and audit log (`SESSION_END`).

#### Student interventions
- **Warn**
  - Inserts a `student_violation_events` row (`PROCTOR_WARNING`, severity `medium`).
  - Sets attempt `proctor_status=warned`, stamps `last_warning_id`, and merges warning into `violations_snapshot`.
  - Emits roster outbox event and audit log `STUDENT_WARN`.
- **Pause / Resume**
  - Updates attempt `proctor_status` to `paused` or `active`.
  - Emits roster outbox event and audit log `STUDENT_PAUSE` / `STUDENT_RESUME`.
- **Terminate**
  - Sets `proctor_status=terminated` and forces `phase=post-exam`.
  - Emits roster outbox event and audit log `STUDENT_TERMINATE`.

#### Alert acknowledgement
- Alerts are backed by `session_audit_logs` entries that match alert action types.
- Acknowledging an alert stamps `acknowledged_at` and `acknowledged_by`.

### 8) Library (passages + question bank) and defaults

Backend source of truth: `backend/crates/application/src/library.rs`

- CRUD for:
  - `passage_library_items` (reading passages)
  - `question_bank_items` (question blocks)
- Items can be global (`organization_id IS NULL`) or org-scoped.
- Listing supports filtering by difficulty and topic.
- Exam defaults profile can be stored and updated (admin defaults).

### 9) Media uploads

Backend source of truth: `backend/crates/application/src/media.rs`

- Create upload intent:
  - Creates a `media_assets` row with `upload_status=pending`.
  - Produces an `upload_url` and expected headers.
  - If the upload is never completed, asset is eligible for cleanup (delete-after is set on creation).
- Complete upload:
  - Marks asset `finalized`, sets `download_url`, clears delete-after.

### 10) Grading + results release

Backend source of truth: `backend/crates/application/src/grading.rs`

#### Materialization (derived views)
To serve grading UIs, the service first ensures “materialized” state exists:
- `grading_sessions` are synced from `exam_schedules`
- `student_submissions` are synced from `student_attempts.final_submission`
- `section_submissions` and `writing_task_submissions` are ensured per submission
- Counters in grading sessions are refreshed

Default section grading statuses on submission materialization:
- Listening: `auto_graded` (placeholder results)
- Reading: `auto_graded` (placeholder results)
- Writing: `needs_review`
- Speaking: `pending`

#### Review lifecycle
- `start_review` creates a `review_draft` if absent and moves submission to `in_progress`.
- `save_review_draft` updates draft content with optional optimistic concurrency (`revision`).
- Status transitions:
  - `mark_grading_complete` → `release_status=grading_complete`, `grading_status=grading_complete`
  - `mark_ready_to_release` → `release_status=ready_to_release`, `grading_status=ready_to_release`
  - `reopen_review` → `release_status=reopened`, `grading_status=reopened`

#### Release
- `release_now`
  - Computes `section_bands` and `overall_band` from the review draft.
  - Creates or updates a `student_results` row with `release_status=released`.
  - Updates:
    - `review_drafts.release_status = released`
    - `student_submissions.grading_status = released`
  - Appends `release_events` history.
- `schedule_release`
  - Creates/updates a `student_results` row with `release_status=ready_to_release` and `scheduled_release_date`.
  - Updates:
    - `review_drafts.release_status = ready_to_release`
    - `student_submissions.grading_status = ready_to_release`
  - Appends a `release_events` “scheduled” entry.

## Live updates, outbox, and degraded live mode

### Outbox

Source: `backend/crates/infrastructure/src/outbox.rs`

- Side effects are queued as `outbox_events` (aggregate kind/id, revision, event family, payload).
- Worker drains outbox in batches and marks events published.

### Degraded live mode

Source: `backend/crates/infrastructure/src/live_mode.rs`

- Live mode is considered **degraded** when there is an outbox backlog older than **15 seconds**.
- Proctor UI uses this signal to fall back to polling/less-real-time expectations.

### Websocket live hub (in-process)

Source: `backend/crates/api/src/live_updates.rs`

- Broadcast hub with connection caps:
  - max 5 connections per user
  - max 1000 connections per backend instance
  - max 100 connections per schedule
- Postgres LISTEN/NOTIFY is disabled in MySQL mode; the worker/polling pattern is used instead.

## API map (backend)

Source: `backend/crates/api/src/router.rs`

- Auth
  - `POST /api/v1/auth/login`
  - `POST /api/v1/auth/student/entry`
  - `GET /api/v1/auth/session`
  - `POST /api/v1/auth/logout`
  - `POST /api/v1/auth/logout-all`
  - `POST /api/v1/auth/activate`
  - `POST /api/v1/auth/password/reset-request`
  - `POST /api/v1/auth/password/reset-complete`
- Exams
  - `GET/POST /api/v1/exams`
  - `GET/PATCH/DELETE /api/v1/exams/:id`
  - `PATCH /api/v1/exams/:id/draft`
  - `POST /api/v1/exams/:id/publish`
  - `GET /api/v1/exams/:id/events`
  - `GET /api/v1/exams/:id/validation`
  - `GET /api/v1/exams/:id/versions`
  - `GET /api/v1/versions/:version_id`
- Schedules + runtime
  - `GET/POST /api/v1/schedules`
  - `GET/PATCH/DELETE /api/v1/schedules/:id`
  - `GET /api/v1/schedules/:id/runtime`
  - `POST /api/v1/schedules/:id/runtime/commands`
  - `POST /api/v1/schedules/:id/register`
- Student sessions
  - `GET /api/v1/student/sessions/:schedule_id`
  - `POST /api/v1/student/sessions/:schedule_id/precheck`
  - `POST /api/v1/student/sessions/:schedule_id/bootstrap`
  - `POST /api/v1/student/sessions/:schedule_id/mutations:batch`
  - `POST /api/v1/student/sessions/:schedule_id/heartbeat`
  - `POST /api/v1/student/sessions/:schedule_id/submit`
- Proctor
  - `GET /api/v1/proctor/sessions`
  - `GET /api/v1/proctor/sessions/:schedule_id`
  - `POST /api/v1/proctor/sessions/:schedule_id/presence`
  - `POST /api/v1/proctor/sessions/:schedule_id/control/end-section-now`
  - `POST /api/v1/proctor/sessions/:schedule_id/control/extend-section`
  - `POST /api/v1/proctor/sessions/:schedule_id/control/complete-exam`
  - `POST /api/v1/proctor/sessions/:schedule_id/attempts/:attempt_id/warn`
  - `POST /api/v1/proctor/sessions/:schedule_id/attempts/:attempt_id/pause`
  - `POST /api/v1/proctor/sessions/:schedule_id/attempts/:attempt_id/resume`
  - `POST /api/v1/proctor/sessions/:schedule_id/attempts/:attempt_id/terminate`
  - `POST /api/v1/proctor/alerts/:alert_id/ack`
  - `GET /api/v1/proctor/live-mode`
- Library
  - `/api/v1/library/passages` + `/api/v1/library/questions` + defaults profile endpoints
- Grading + results
  - `/api/v1/grading/*`, `/api/v1/results/*`
- Media
  - `POST /api/v1/media/uploads`
  - `POST /api/v1/media/uploads/:asset_id/complete`
  - `GET /api/v1/media/:asset_id`

## Key invariants (quick checklist)

- Exam publishing requires a draft version and correct `revision`.
- Schedules require a valid, enabled section plan and a time window ≥ planned duration.
- Runtime must be started before student submissions are accepted.
- Student objective mutations are only accepted while runtime is live/paused (or brief grace after completion).
- Student submissions are idempotent and become immutable snapshots (`final_submission`).
- Ending a runtime auto-submits remaining attempts.
- Proctor actions are durable and auditable (audit logs + violation events + outbox).
- Grading sessions/submissions are derived (“materialized”) from schedules/attempts.
