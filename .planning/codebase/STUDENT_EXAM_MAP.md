# Student Exam Functionality — Complete Codebase Map

**Analysis Date:** 2025-07-05

This document maps every file involved in the student exam flow — from registration/check-in through pre-check, lobby, exam delivery, autosave, submission, and post-exam.

---

## 1. Routing & Entry Points

### Frontend Routes (`src/routes/index.tsx`)

| Route | Component | Purpose |
|-------|-----------|---------|
| `/student/:scheduleId` | `StudentRegistrationRoute` | Public check-in form (no auth required) |
| `/student/:scheduleId/register` | `StudentRegisterRedirect` | Redirects to `/student/:scheduleId` |
| `/student/:scheduleId/:studentId` | `StudentSessionRoute` | Authenticated exam session (requires student role) |

**Key files:**
- `src/routes/index.tsx` — Router definition with lazy-loaded routes
- `src/app/router/route-manifest.ts` — Route manifest constants

### Backend Routes

| Route | Handler | Purpose |
|-------|---------|---------|
| `POST /v1/auth/student-entry` | `auth.rs::student_entry` | Student check-in, issues session cookie |
| `GET /v1/student/sessions/:id` | `student.rs::get_student_session` | Static session data (exam version + schedule) |
| `GET /v1/student/sessions/:id/static` | `student.rs::get_student_static_session` | Static-only session payload |
| `GET /v1/student/sessions/:id/live` | `student.rs::get_student_live_session` | Live session data (attempt + runtime) |
| `POST /v1/student/sessions/:id/mutations:batch` | `student.rs::batch_mutations` | Batch answer/flag/writing mutations |
| `POST /v1/student/sessions/:id/heartbeat` | `student.rs::heartbeat` | Heartbeat + integrity check |
| `POST /v1/student/sessions/:id/submit` | `student.rs::submit_attempt` | Final exam submission |
| `POST /v1/student/sessions/:id/precheck` | `student.rs::submit_precheck` | Pre-check result submission |
| `POST /v1/student/sessions/:id/bootstrap` | `student.rs::bootstrap_session` | Session bootstrap |
| `POST /v1/student/sessions/:id/audit` | `student.rs::audit_event` | Audit event logging |
| `GET /api/v1/ws/live` | `ws.rs::websocket_live` | WebSocket for live updates |

**Key files:**
- `backend/crates/api/src/routes/student.rs` (1726 lines) — All student API handlers
- `backend/crates/api/src/routes/auth.rs` — Student entry/check-in authentication
- `backend/crates/api/src/routes/ws.rs` — WebSocket live updates

---

## 2. Feature Layer Architecture (`src/features/student/`)

The student feature follows a clean architecture pattern: **contracts → application → infrastructure → routes → hooks**.

### Contracts (`src/features/student/contracts/index.ts`)
- Defines `StudentExamPhase`, `StudentSessionRouteProps`, `StudentData`, `StudentOperationCallbacks`
- Stable interface boundaries for the student surface

### Application Layer
- `src/features/student/application/studentSessionFacade.ts` — Facade for session operations (loadStaticSession, loadLiveSession, mapSchedule, mapVersion, hydrateExamState, mapRuntime, mapAttempt, saveAttempt, createAttempt)
- `src/features/student/application/studentAttemptFacade.ts` — Re-exports from infrastructure (studentAttemptRepository, createStudentMutationOutbox, buildStudentHeartbeatEvent, etc.)

### Infrastructure Layer
- `src/features/student/infrastructure/studentSessionGateway.ts` — Implements `StudentSessionFacade` using `backendBridge` and `studentAttemptRepository`
- `src/features/student/infrastructure/studentAttemptGateway.ts` — Re-exports backend post, heartbeat builder, attempt repository, mutation outbox

### Routes
- `src/features/student/routes/StudentEntryRoute.tsx` — Public check-in form (wcode, email, name, nickname, course). Handles queued admission polling.
- `src/features/student/routes/StudentSessionRoute.tsx` — Authenticated session route. Loads data via `useStudentSessionRouteData`, renders `StudentAppWrapper`.
- `src/features/student/routes/StudentRegistrationRoute.tsx` — Thin wrapper around `StudentEntryRoute`

### Hooks
- `src/features/student/hooks/useStudentSessionRouteData.ts` (851 lines) — Core data loading hook. Handles:
  - Static session loading (exam version + schedule)
  - Live session polling (attempt + runtime)
  - WebSocket live updates via `useLiveUpdates`
  - Version mismatch detection and re-bootstrap
  - Answer invariant rollout configuration
  - Diagram snapshot diagnostics
- `src/features/student/hooks/studentSessionStateMachine.ts` — State machine for live snapshot apply decisions (stale discard, epoch superseded, revision regression)
- `src/features/student/hooks/studentSessionMachineAdapters.ts` — Adapters for running machine commands

### Live Snapshot Freshness
- `src/features/student/liveSnapshotFreshness.ts` — Tracks freshness of attempt and runtime snapshots to prevent stale overwrites

---

## 3. Components (`src/components/student/`)

### Top-Level Orchestration
- `StudentAppWrapper.tsx` — Provider tree composition: `StudentUIProvider → KeyboardProvider → StudentRuntimeProvider → StudentAttemptProvider → ProctoringProvider → StudentNetworkProvider → StudentApp`
- `StudentApp.tsx` (903 lines) — Main student exam shell. Manages:
  - Phase rendering (pre-check → lobby → exam → post-exam)
  - Answer change handling with `resolveObjectiveAnswerUpdate`
  - Writing answer changes
  - Flag toggling
  - Module submit with confirmation
  - Blocking overlays (cohort_paused, proctor_paused, not_started, offline, heartbeat_lost, device_mismatch, storage_unavailable)
  - Warning overlays (tab switch, secondary screen, screenshot, translation)
  - Time extension request dialog
  - Accessibility settings
  - Auto-submit boundary

### Exam Phase Components
- `PreCheck.tsx` (307 lines) — Browser detection, JavaScript check, storage check, online check, screen details. Produces `StudentPreCheckResult`.
- `Lobby.tsx` (72 lines) — Shows section durations, total duration, start button (non-runtime mode)
- `StudentExamWorkspace.tsx` — Routes to module-specific components (StudentListening, StudentReading, StudentWriting, StudentSpeaking)
- `StudentPostExamView.tsx` — Post-exam completion screen with student info
- `SubmitConfirmation.tsx` — Confirmation dialog for unanswered questions

### Module-Specific Components
- `StudentListening.tsx` (473 lines) — Audio player with play/pause/skip, split-pane layout, question navigation, highlight support
- `StudentReading.tsx` (378 lines) — Passage display with split-pane, highlight support, readability controls
- `StudentWriting.tsx` (790 lines) — Writing task editor with word count, draft commit, undo/redo, clipboard handling
- `StudentSpeaking.tsx` (327 lines) — Speaking parts with prep time, speak time, part navigation

### Header/Footer/Navigation
- `StudentHeader.tsx` — Test taker ID, time remaining, highlight toggle, accessibility button, navigator toggle
- `StudentFooter.tsx` — Module progress, submit button
- `QuestionNavigator.tsx` — Dialog-based question list with answered/flagged indicators
- `StudentExamPreview.tsx` — Preview mode for builders

### Answer Controls
- `ProtectedChoiceInput.tsx` — MCQ answer input with proctoring guards
- `ProtectedSelect.tsx` — Select dropdown with proctoring guards
- `protectedAnswerControlLifecycle.ts` — Lifecycle management for answer controls
- `resolveObjectiveAnswerUpdate.ts` — Resolves answer update logic (slot-based, scalar, choice)
- `answerUndoRedoGuard.ts` — Undo/redo guard for answer mutations
- `SubAnswerTreeQuestionList.tsx` — Sub-answer tree rendering
- `TableCompletionSlotCell.tsx` — Table completion answer slot

### Highlight System
- `HighlightableSurface.tsx` — DOM-based text selection for highlighting
- `RichTextHighlighter.tsx` — Rich text highlighting with color support
- `highlightSelectionManager.tsx` — Provider for highlight state management
- `highlightSelectionPort.tsx` — Port for highlight selection events
- `highlightV2Engine.ts` — V2 highlight engine
- `highlightPalette.ts` — Color palette for highlights
- `highlightStorageKeys.ts` — Storage keys for highlight persistence
- `useHighlightSurfaceV2.ts` — Hook for highlight surface V2

### Accessibility
- `AccessibilitySettings.tsx` — Font size, high contrast, passage readability controls
- `accessibilityScale.ts` (referenced) — Font size and typography scale definitions
- `prefersReducedMotion.ts` — Reduced motion detection

### Media/Content
- `FormattedText.tsx` — Formatted text rendering
- `StudentMaterialWithQuestionPane.tsx` — Material + question split pane
- `StudentSplitPaneResizer.tsx` — Split pane resizer
- `useSplitPaneResize.ts` — Split pane resize hook
- `splitPaneDimensions.ts` — Split pane dimension calculations
- `StudentZoomableMedia.tsx` — Zoomable media (diagrams, images)
- `useDragToPan.ts` — Drag to pan for zoomable media
- `useZoomScrollAnchoring.ts` — Zoom scroll anchoring

### Warning/Integrity
- `WarningOverlay.tsx` — Warning overlay with severity levels and countdown
- `useStudentWarningVisibility.ts` — Manages warning visibility state
- `tabletMode.ts` — Tablet mode detection
- `appleMobileDevice.ts` — Apple mobile device detection
- `browserParityPolicy.ts` (referenced in StudentApp) — Viewport lock policy

### Post-Exam
- `StudentPostExamView.tsx` — Completion screen
- `StudentExamPreview.tsx` — Preview mode for builders

---

## 4. Providers (`src/components/student/providers/`)

### StudentRuntimeProvider.tsx (1255 lines)
**Purpose:** Manages exam runtime state including phase, module, timer, blocking, violations, proctor status.

**State:**
- `phase` — Current exam phase (pre-check/lobby/exam/post-exam/submitted)
- `currentModule` — Active module (listening/reading/writing/speaking)
- `currentQuestionId` — Active question
- `timeRemaining` / `displayTimeRemaining` — Timer
- `violations` — Violation list
- `proctorStatus` / `proctorNote` — Proctor state
- `blockingMachine` — Blocking state machine
- `attemptSyncState` — Sync state

**Actions:**
- `setPhase`, `setCurrentModule`, `setCurrentQuestionId`
- `setTimeRemaining`, `setRuntimeTimeRemaining`
- `startExam`, `submitModule`
- `transitionBlocking` — Manages blocking reasons
- `syncProctorBlocking` — Syncs proctor-initiated blocking

### StudentAttemptProvider.tsx (1480 lines)
**Purpose:** Manages attempt state, answer persistence, mutation outbox, heartbeat, and server sync.

**State:**
- `attempt` — Current `StudentAttempt` object
- `pendingMutationCount` — Number of pending mutations
- `lastLocalMutationAt` / `lastPersistedAt` — Timestamps

**Actions:**
- `persistAnswer` — Queues answer mutation
- `persistWritingAnswer` — Queues writing answer mutation
- `persistFlag` — Queues flag mutation
- `persistViolation` — Records violation
- `persistPosition` — Records navigation position
- `recordPreCheckResult` — Records pre-check
- `recordNetworkStatus` — Records online/offline
- `recordHeartbeat` — Records heartbeat event
- `acknowledgeProctorWarning` — Acknowledges warning
- `submitAttempt` — Submits exam
- `setDeviceFingerprintHash` — Sets device fingerprint
- `flushPending` — Flushes pending mutations to server

**Internal:**
- Uses `PendingMutationDurabilityMirror` for durable persistence
- Uses `createStudentMutationOutbox` for flush/retry logic
- Handles `ATTEMPT_SUBMITTED`, `SECTION_MISMATCH`, `OBJECTIVE_LOCKED` conflict reasons
- Manages IndexedDB for pending mutations (fallback from localStorage)

### StudentUIProvider.tsx (191 lines)
**Purpose:** UI state management (navigator, submit confirm, accessibility, time extension).

**State:**
- `showNavigator`, `showSubmitConfirm`, `showAccessibility`
- `showTimeExtensionRequest`, `timeExtensionReason`, `timeExtensionGranted`
- `accessibilitySettings` (fontSize, highContrast, zoom, passageReadabilityLevel, highlightMode, highlightColor)

### StudentProctoringProvider.tsx (608 lines)
**Purpose:** Handles proctoring violations (tab switch, secondary screen, screenshot, translation, clipboard, context menu, paste, autofill, replacement detection).

**Key behaviors:**
- Tab visibility change detection
- Secondary screen detection via `screen.details`
- Screenshot detection via `keyup` (PrintScreen) and `blur`
- Translation tool detection
- Clipboard/context menu blocking
- Audit event logging

### StudentNetworkProvider.tsx (450 lines)
**Purpose:** Network status monitoring, heartbeat management, device fingerprinting, reconnection handling.

**Key behaviors:**
- Online/offline detection
- Heartbeat interval management (configurable from `StudentIntegritySecurityPolicy`)
- Device fingerprint comparison on reconnect
- Audit event logging for disconnect/reconnect
- Runtime refresh on reconnect

### StudentKeyboardProvider.tsx (431 lines)
**Purpose:** Keyboard shortcut management during exam.

**Key behaviors:**
- Blocks global modifier keys (Cmd+F, Cmd+P, Cmd+S)
- Blocks inspector shortcuts (Cmd+Shift+I, Cmd+Shift+C, Cmd+Shift+J)
- Blocks Cmd+Z (undo) / Cmd+Shift+Z (redo) in non-editing contexts
- Exam navigation shortcuts (next/previous question)
- Submits current module on Cmd+Enter

### blockingStateMachine.ts (137 lines)
**Purpose:** Manages blocking reasons with priority-based state machine.

**Blocking reasons (priority order):**
1. `device_mismatch`
2. `proctor_paused`
3. `offline`
4. `heartbeat_lost`
5. `syncing_reconnect`
6. `storage_unavailable`

### verifiedTerminalState.ts (48 lines)
**Purpose:** Determines if student is in terminal state (completed/terminated).

---

## 5. Services (`src/services/`)

### Core Student Services

- **`studentAttemptRepository.ts`** (1628+ lines) — Local storage + IndexedDB persistence for attempts, pending mutations, heartbeat events. Handles:
  - Attempt CRUD operations
  - Pending mutation storage (localStorage + IndexedDB fallback)
  - Heartbeat event storage
  - Mutation compaction and supersession
  - Client session ID management
  - Mutation sequence watermark tracking
  - Cache pruning for submitted/stale attempts

- **`studentMutationOutbox.ts`** (709 lines) — Mutation flush/retry logic. Handles:
  - Mutation coalescence (answer/flag/writing_answer)
  - Durable persistence mirror with debouncing
  - Answer sync checkpoint (localStorage)
  - Flush cycle management
  - Conflict handling (ATTEMPT_SUBMITTED, SECTION_MISMATCH, OBJECTIVE_LOCKED)

- **`studentSessionTransport.ts`** (81 lines) — API endpoint path builder for student session operations.

- **`studentAttemptNormalization.ts`** (148 lines) — Normalizes student attempts (derives candidateId, proctorStatus, merges recovery state).

- **`studentIntegrityService.ts`** (145 lines) — Integrity security policy and heartbeat management.

- **`studentAuditService.ts`** (72 lines) — Audit event logging for student actions.

- **`attemptCredentialAdapter.ts`** (222 lines) — Attempt token credential management (store, refresh, build auth headers).

### Exam Services

- **`examAdapterService.ts`** (1123 lines) — Adapts exam data for student consumption. Key functions:
  - `hydrateExamState` — Converts backend exam version to frontend `ExamState`
  - `getStudentQuestionsForModule` — Gets question descriptors for a module
  - `countAnsweredQuestions` / `countQuestionSlots` — Answer counting
  - `isQuestionAnswered` / `isQuestionFullyAnswered` — Answer checking

- **`examDeliveryService.ts`** (553 lines) — Exam delivery operations (section planning, schedule window validation, runtime control).

- **`examRepository.ts`** (303 lines) — Data access layer for exam entities, versions, events.

- **`examLifecycleService.ts`** (2088 lines) — Exam lifecycle operations (status transitions, version management, audit logging).

- **`backendBridge.ts`** (631 lines) — Backend API client wrapper. Maps backend responses to frontend domain types.

- **`authService.ts`** (156 lines) — Authentication service (login, student entry, password reset).

### Grading Services

- **`gradingService.ts`** (1308 lines) — Grading workflow operations (session queue, draft management, review finalization, results release).

- **`gradingRepository.ts`** — Grading data persistence.

- **`gradingFilters.ts`** — Grading queue filtering logic.

- **`answerHistoryService.ts`** — Answer history operations.

### Other Services

- **`questionBankService.ts`** — Question bank operations.
- **`passageLibraryService.ts`** — Passage library operations.
- **`adminPreferencesRepository.ts`** — Admin preferences.
- **`developmentFixtures.ts`** — Development test data.

### Policies
- **`policies/examStatusTransitions.ts`** — Exam status transition rules (draft → in_review → approved → scheduled → published → archived).

---

## 6. Types (`src/types/`)

- **`domain.ts`** (467 lines) — Core domain types: `ExamEntity`, `ExamVersion`, `ExamSchedule`, `ExamSessionRuntime`, `SectionRuntimeState`, `CohortControlEvent`, `StudentAttemptStatus`, `RuntimeStatus`, etc.

- **`studentAttempt.ts`** (199 lines) — Student attempt types: `StudentAttempt`, `StudentAttemptMutation` (answer/writing_answer/flag/violation/position/precheck/network/heartbeat/device_fingerprint/sync), `StudentPreCheckResult`, `StudentHeartbeatEvent`, `AttemptSyncState`.

- **`answers.ts`** (9 lines) — `StudentAnswerValue` type (string | string[] | 'T' | 'F' | 'NG' | 'Y' | 'N' | null).

- **`grading.ts`** (754 lines) — Grading workflow types: `GradingSession`, `StudentSubmission`, `SectionSubmission`, `ReviewDraft`, `StudentResult`, `RubricAssessment`, `WritingAnnotation`, etc.

- **`types.ts`** (main types file) — `ExamState`, `ExamConfig`, `ModuleType`, `Violation`, `ViolationSeverity`, `QuestionAnswer`, etc.

---

## 7. Utilities (`src/utils/`)

### Exam Utilities
- `examUtils.ts` — Exam validation, question counting, block question counting
- `examIdCollisionCheck.ts` — Exam ID collision detection
- `examTextExport.ts` — Exam text export
- `examStats.ts` — Exam statistics
- `versionUtils.ts` — Version utilities

### Answer Utilities
- `acceptedAnswers.ts` — Accepted answer logic
- `answerRuleAutoUpgrade.ts` — Answer rule auto-upgrade
- `subAnswerTree.ts` — Sub-answer tree utilities
- `subAnswerTreeSlots.ts` — Sub-answer tree slot utilities
- `completionPromptText.ts` — Completion prompt text

### Content Utilities
- `writingTaskUtils.ts` — Writing task content utilities
- `tableCompletion.ts` — Table completion utilities
- `insertedImages.ts` — Inserted images utilities
- `referenceImagePlacement.ts` — Reference image placement
- `cloneExamContent.ts` — Exam content cloning
- `sanitizeHtml.ts` — HTML sanitization
- `htmlText.ts` — HTML text utilities
- `boldMarkdown.ts` — Bold markdown utilities
- `imageUrl.ts` — Image URL utilities
- `audioUrl.ts` — Audio URL utilities

### Infrastructure Utilities
- `deviceFingerprinting.ts` — Device fingerprint generation
- `studentObservability.ts` — Student observability metrics
- `ttlLruCache.ts` — TTL LRU cache
- `latestOnlyAsync.ts` — Latest-only async utility
- `idUtils.ts` — ID generation utilities
- `validationUtils.ts` — Validation utilities
- `validationHelpers.ts` — Validation helpers
- `logger.ts` — Logging utilities
- `csvExport.ts` — CSV export
- `gradingSeedData.ts` — Grading seed data

---

## 8. Database Schema (Backend Migrations)

### Exam Core (`0003_exam_core.sql`)
- `exam_entities` — Exam metadata (id, slug, title, type, status, visibility, owner)
- `exam_memberships` — Exam access control (actor, role)
- `exam_versions` — Immutable exam versions (content_snapshot, config_snapshot)
- `exam_events` — Audit trail

### Scheduling & Access (`0005_scheduling_and_access.sql`)
- `exam_schedules` — Scheduled exam sessions (cohort, timing, delivery mode)
- `schedule_registrations` — Student registrations (wcode, access state, metadata)
- `schedule_staff_assignments` — Proctor/grader assignments
- `student_admission_queue` — Admission queue for capacity management
- `exam_runtimes` — Live runtime state

### Student Delivery (`0006_delivery.sql`)
- `student_attempts` — Student exam attempts (answers, writing_answers, flags, violations, integrity, recovery)
- `student_attempt_mutations` — Mutation log (mutation_type, payload, seq, applied_revision)
- `student_heartbeat_events` — Heartbeat events

### Proctoring (`0007_proctoring.sql`)
- `student_violation_events` — Violation events
- `proctor_presence` — Proctor presence tracking
- `session_audit_logs` — Audit logs
- `session_notes` — Session notes
- `violation_rules` — Automated violation rules

### Grading (`0008_grading_results.sql`)
- `grading_sessions` — Grading session grouping
- `student_submissions` — Student submission records
- `section_submissions` — Section-level submissions
- `writing_task_submissions` — Writing task submissions
- `review_drafts` — Grading drafts
- `review_events` — Grading audit trail
- `student_results` — Released results

### Later Migrations
- `0009_media_cache_outbox.md` — Media cache outbox
- `0010_auth_security.sql` — Auth security hardening
- `0011_outbox_notify_trigger.sql` — Outbox notification triggers
- `0012_registration_fields.sql` — Registration field additions
- `0013_proctor_presence_unique.sql` — Proctor presence uniqueness
- `0014_student_attempt_presence.sql` — Attempt presence tracking
- `0015_operation_write_hardening.sql` — Write operation hardening
- `0016_attempt_mutation_id_uniqueness.sql` — Mutation ID uniqueness
- `0017_production_hardening.sql` — Production hardening
- `0018_exam_day_concurrency_hardening.sql` — Concurrency hardening
- `0019_violation_id_idempotency.sql` — Violation ID idempotency
- `0020_schedule_role_display_names.sql` — Role display names
- `0021_attempt_finalization_consistency.sql` — Finalization consistency
- `0022_attempt_submission_ledger.sql` — Submission ledger
- `0023_sort_memory_hotpath_indexes.sql` — Performance indexes
- `0024_projection_sort_hardening.sql` — Sort hardening
- `0025_join_storm_admission_queue.sql` — Admission queue optimization
- `0026_relax_access_code_constraints.sql` — Access code constraint relaxation
- `0027_grading_objective_overrides.sql` — Objective grading overrides
- `0028_grading_objective_grading_source.sql` — Grading source tracking
- `0029_release_events_timestamp_precision.sql` — Timestamp precision
- `0030_outbox_retry_policy.sql` — Outbox retry policy

---

## 9. WebSocket / Real-Time Features

### Client-Side
- `src/app/hooks/useLiveUpdates.ts` — WebSocket hook connecting to `/api/v1/ws/live`
  - Supports `scheduleId` and `attemptId` filtering
  - Handles `connected`, `error`, `runtime_snapshot`, and generic `LiveUpdateEvent` frames
  - Reconnection with exponential backoff
  - Debounced event processing

### Server-Side
- `backend/crates/api/src/routes/ws.rs` — WebSocket handler
  - Authenticates via session cookie
  - Subscribes to live update events
  - Sends `runtime_snapshot` frames for runtime changes
  - Sends `LiveUpdateEvent` frames for attempt/schedule changes

### Live Update Flow
1. WebSocket connects with `scheduleId` and `attemptId`
2. Server sends `runtime_snapshot` when runtime state changes
3. Server sends `LiveUpdateEvent` for attempt mutations and schedule changes
4. Client processes events, refreshes backend session snapshot
5. State machine (`studentSessionStateMachine.ts`) evaluates whether to apply updates

---

## 10. Autosave / Mutation System

### Mutation Types
- `answer` — Objective question answer (MCQ, cloze, matching, etc.)
- `writing_answer` — Writing task text
- `flag` — Question flag toggle
- `violation` — Violation detection
- `position` — Navigation position
- `precheck` — Pre-check result
- `network` — Network status
- `heartbeat` — Heartbeat event
- `device_fingerprint` — Device fingerprint
- `sync` — Sync event

### Autosave Flow
1. User interacts with answer control → `handleAnswerChange` in `StudentApp.tsx`
2. `resolveObjectiveAnswerUpdate` resolves the answer value
3. `attemptActions.persistAnswer` queues a mutation
4. `PendingMutationDurabilityMirror` persists to localStorage + IndexedDB
5. `createStudentMutationOutbox.flushNow` sends batch to server
6. Server processes mutations, returns updated attempt
7. Client reconciles local state with server state

### Durability Guarantees
- **localStorage** — Primary storage for pending mutations
- **IndexedDB** — Fallback storage when localStorage is full
- **Answer Sync Checkpoint** — localStorage checkpoint for crash recovery
- **Mutation Coalescence** — Supersedes older mutations for same question/slot
- **Compaction** — Drops oldest superseded mutations when limits exceeded

---

## 11. Payment/Checkout Flows

**No payment or checkout flows exist in this codebase.** The system is an institutional exam platform where access is controlled via:
- Schedule-based access (proctor starts exam)
- Wcode-based authentication (student check-in)
- Role-based access control (admin, builder, proctor, grader, student)

---

## 12. Provider Tree (Component Hierarchy)

```
StudentRegistrationRoute (public check-in)
  └── StudentEntryRoute

StudentSessionRoute (authenticated session)
  └── StudentAppWrapper
      ├── StudentUIProvider
      │   └── KeyboardProvider
      │       └── StudentApp
      ├── StudentRuntimeProvider
      │   └── (children)
      ├── StudentAttemptProvider
      │   └── (children)
      ├── ProctoringProvider
      │   └── StudentNetworkProvider
      │       └── (children)
      └── StudentApp
          ├── StudentHeader
          ├── StudentHighlightSelectionManagerProvider
          │   └── StudentExamWorkspace
          │       ├── StudentListening / StudentReading / StudentWriting / StudentSpeaking
          │       ├── QuestionNavigator
          │       └── StudentFooter
          ├── BlockingOverlay
          ├── WarningOverlay (multiple)
          ├── SubmitConfirmation
          ├── TimeExtensionDialog
          └── AccessibilitySettings
```

---

## 13. Key Data Flow

### Registration → Exam → Submission

```
1. Student navigates to /student/:scheduleId
2. StudentEntryRoute renders check-in form
3. Student submits wcode + profile → POST /v1/auth/student-entry
4. Backend authenticates, issues session cookie
5. Frontend navigates to /student/:scheduleId/:studentId
6. StudentSessionRoute loads:
   a. Static session (exam version + schedule) via /v1/student/sessions/:id/static
   b. Live session (attempt + runtime) via /v1/student/sessions/:id/live
   c. WebSocket connects for live updates
7. StudentAppWrapper mounts provider tree
8. StudentApp renders based on phase:
   - pre-check → PreCheck component
   - lobby → Lobby component (non-runtime) or exam (runtime-backed)
   - exam → StudentExamWorkspace with module components
   - post-exam → StudentPostExamView
9. During exam:
   - Answer changes → mutation queue → durable persist → server batch
   - Heartbeats → integrity verification
   - Violations → audit logging
   - Runtime updates → blocking state machine
10. On submit:
    - Flush pending mutations
    - POST /v1/student/sessions/:id/submit
    - Server finalizes attempt, creates submission
    - Client transitions to post-exam
```

---

*Student exam functionality map: 2025-07-05*
