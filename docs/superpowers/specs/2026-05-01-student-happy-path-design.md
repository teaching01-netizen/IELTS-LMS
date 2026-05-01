# Student Behavior Story Path Design (Happy Path)

Date: 2026-05-01  
Scope: Live proctored exam flow, happy path only  
Audience: Product and engineering

## Objective

Define the canonical student journey for a live proctored exam when everything works as expected, from entry to final submission.

## Out of Scope

- Violation handling and proctor interventions
- Offline/network degradation recovery paths
- Section mismatch, objective lock, or mutation conflict resolution
- Self-paced flow variations

## Happy Path Story

### 1) Entry and Check-In

Actor actions:
- Student opens `/student/:scheduleId`.
- Student enters `wcode`, email, and full name.
- Student selects `Continue`.

System behavior:
- Validates required fields and expected formats.
- Creates or restores a session context for this schedule/student identity.
- Moves the student to pre-check when validation succeeds.

Visible success signals:
- No validation errors remain on the form.
- UI transitions away from check-in to the next stage.

### 2) Pre-Check

Actor actions:
- Student lands on `System checking`.
- Student waits for the checklist to complete.

System behavior:
- Runs compatibility and readiness checks:
  - Browser compatibility
  - JavaScript runtime
  - Fullscreen API
  - Secure local storage
  - Network connectivity
  - Secondary screen detection
- Marks the pre-check stage complete once all required checks pass.

Visible success signals:
- Checklist items show pass state.
- Progression control becomes available (or auto-advance occurs per runtime behavior).

### 3) Lobby Waiting

Actor actions:
- Student enters lobby and remains ready.
- Student waits for exam authorization/start.

System behavior:
- Keeps session heartbeat and connectivity active.
- Maintains student presence in waiting state.
- Subscribes/polls for start authorization from runtime/proctor control.

Visible success signals:
- Lobby state is stable and clearly indicates waiting.
- On start authorization, UI transitions to active exam.

### 4) Exam Start

Actor actions:
- Student enters the active exam view.
- Student sees first question and exam navigation controls.

System behavior:
- Initializes or resumes attempt state for the active section/module.
- Activates client mutation pipeline:
  - optimistic local updates
  - durable pending queue
  - scheduled flush/sync
- Starts exam runtime signals (timer and session state visibility).

Visible success signals:
- Question content and answer fields are interactive.
- Header/runtime indicators show exam is in active state.

### 5) Answering

Actor actions:
- Student enters answers in question inputs.
- Student continues normal response entry without interruption.

System behavior:
- Captures answer mutations immediately in local state.
- Enqueues and flushes mutations to backend in normal cadence.
- Reconciles server acknowledgements and advances accepted sequence watermark.

Visible success signals:
- Save indicator transitions `Saving`/`Syncing` -> `Saved`.
- Entered responses remain visible and stable after save.

### 6) Progress Through Sections

Actor actions:
- Student navigates across questions using standard controls.
- Student continues through sections in allowed order.

System behavior:
- Preserves contiguous mutation ordering for the attempt.
- Maintains synchronized local/server attempt state during navigation.
- Applies module/section constraints without interruption in happy path.

Visible success signals:
- Navigation updates current question/section correctly.
- Save state remains healthy while progressing.

### 7) Finish and Submit

Actor actions:
- Student selects `Finish` when done.
- Student confirms submission if confirmation UI is present.

System behavior:
- Verifies final submit preconditions for active attempt.
- Sends `POST /api/v1/student/sessions/:scheduleId/submit`.
- Marks attempt as final submission on success.

Visible success signals:
- Submit request completes successfully.
- Exam inputs are no longer in active answering state.

### 8) Completion

Actor actions:
- Student views completion page/state.
- Student performs no further exam-entry actions.

System behavior:
- Renders definitive completion state (`Examination Complete`).
- Persists final submission metadata (submitted timestamp and final response snapshot).
- Keeps post-submit state stable on refresh/re-open for this attempt.

Visible success signals:
- Completion message remains consistent.
- Session no longer returns to active answering flow.

## End-to-End State Transitions

`CHECK_IN` -> `PRE_CHECK` -> `LOBBY_WAITING` -> `EXAM_ACTIVE` -> `SUBMITTING` -> `COMPLETED`

## Story Path Quality Gates

1. Transition integrity: each state transitions only to the next expected happy-path state.
2. Save integrity: every answer-edit cycle can reach `Saved` before final submit.
3. Submission integrity: exactly one successful final submit per completed attempt.
4. Completion integrity: completed attempts remain terminal in student UI lifecycle.

## System Responsibilities by Stage

1. Validate student identity inputs at check-in.
2. Gate exam entry behind pre-check completion.
3. Maintain lobby connectivity until start is authorized.
4. Initialize attempt runtime at exam start.
5. Provide clear save-state feedback during answering.
6. Keep mutation sequence contiguous and synchronized.
7. Finalize submission atomically on finish.
8. Render a definitive completion confirmation.

## Acceptance Criteria

1. Student can move from check-in to completion without manual refresh or retries.
2. Save feedback reaches `Saved` after normal answer entry.
3. Finish action emits submit request and receives success response.
4. Completion screen appears and remains stable after submit.
