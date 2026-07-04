# UX Invariants

Purpose: keep student-facing interaction rules explicit so future UI changes do not accidentally weaken exam usability or integrity.

## Proctor Overview Session Buckets

### Owning Module
Proctor overview cohort visibility is owned by the proctor UI module:

- `src/components/proctor/ProctorDashboard.tsx`
- `src/components/proctor/proctorOverviewSessions.ts`
- `src/features/proctor/hooks/useProctorRouteController.ts`

### Invariant
Completed and cancelled cohorts are terminal for active monitoring, but they remain part of the hydrated proctor data set for audit/history review.

The Active overview must show only actionable or upcoming cohorts: scheduled, ready, live, and paused. Completed and cancelled cohorts must move to Past instead of remaining mixed into Active.

The Past overview must show completed and cancelled cohorts and allow status filtering without deleting, archiving, or mutating schedule records. Backend/controller hydration must not filter terminal summaries before the UI can place them in Past.

### Must Not Break
- Completing an exam must not make its schedule disappear from proctor history.
- Cancelled cohorts must remain discoverable from Past.
- Opening a Past cohort must keep terminal controls disabled through the existing runtime-status guards.
- Hard delete/archive actions must stay out of the proctor overview until schedule, submissions, grading, and audit retention policy is explicitly modeled.

### Regression Protection
- `src/components/proctor/__tests__/proctorOverviewSessions.test.ts`
- `src/components/proctor/__tests__/ProctorDashboard.test.tsx`
- `src/features/proctor/hooks/__tests__/useProctorRouteController.backend.test.tsx`

## Student Text Selection And Highlighting

### Owning Module
Student highlight and reading/question text selection behavior is owned by the student UI module:

- `src/components/student/highlightV2Engine.ts`
- `src/components/student/highlightSelectionPort.tsx`
- `src/components/student/highlightV2Persistence.tsx`
- `src/components/student/highlight/*`
- Student reading/question renderers that set `data-student-highlightable="true"`

### Invariant
Text selection and highlighting are fail-closed.

Selection endpoints must remain inside the owning highlightable surface. The system must reject, not clip or expand, selections whose endpoints leave that surface.

Cross-block selections are allowed within the same highlight surface. Cross-surface selections remain rejected instead of being clipped or auto-expanded.

Answer controls must stay outside highlightable selection boundaries. Students may select displayed reading/question text, but inputs, textareas, selects, contenteditable regions, and answer-control wrapper elements must not become highlight targets.

Floating highlight toolbar actions must not clear, replace, or steal focus from the text selection they are acting on before apply/remove consumes the captured selection.

### Must Not Break
- Native drag selection must work for reading passage title/body and visible question display text in exam mode.
- Highlight apply/remove must act on the latest valid captured selection for the active highlight surface only.
- Highlighting must not create nested highlight marks when recoloring or reapplying over already-highlighted text.
- Persisted highlights must be tied to the rendered surface text and must reset when that text changes.

### Regression Protection
- `src/components/student/__tests__/highlightPersistence.test.tsx`
- `src/components/student/__tests__/highlightSelectionPort.test.tsx`
- `src/components/student/__tests__/highlightV2Engine.test.ts`
- `src/components/student/__tests__/StudentReadingReadabilityControls.test.tsx`
- `src/components/student/__tests__/StudentQuestionExperience.test.tsx`

### Related Memory
- `docs/failure-cases.md`

## Student Answer Control Responsiveness

### Owning Module
Student answer entry responsiveness is owned by the student UI and attempt persistence modules:

- `src/components/student/StudentWriting.tsx`
- `src/components/student/ProtectedInput.tsx`
- `src/components/student/ProtectedSelect.tsx`
- `src/components/student/ProtectedChoiceInput.tsx`
- `src/components/student/providers/StudentAttemptProvider.tsx`
- `src/components/student/protectedAnswerControlLifecycle.ts`

### Invariant
Typing must update the focused DOM control immediately and must not require a full attempt-context render for every keystroke.

Draft persistence may be debounced for smoothness, but lifecycle boundaries must synchronously commit the latest DOM value before page hide, tab close, freeze, blur, task switch, or submit review.

Student-visible saved/verified state must continue to reflect persisted durability, not only the live DOM draft.

### Must Not Break
- Latest answer text is committed on `pagehide`, `visibilitychange` to hidden, `freeze`, `beforeunload`, blur/focusout, task switch, and submit.
- Undo/redo guard continues to block or restore history mutations and emit audit events.
- Autofill/replacement suspicion audit events continue to include schedule/attempt context when available.
- Objective answer controls do not subscribe to the full attempt state if they only need audit ids and durability flush.
- Timer display remains fair and cannot gain time through reduced render cadence.

### Regression Protection
- `src/components/student/__tests__/StudentTypingPerformance.test.tsx`
- `src/components/student/__tests__/ProtectedInput.test.tsx`
- `src/components/student/__tests__/ProtectedSelect.test.tsx`
- `src/components/student/__tests__/ProtectedChoiceInput.test.tsx`
- `src/components/student/__tests__/StudentWriting.lifecycle.test.tsx`
- `src/components/student/providers/__tests__/StudentRuntimeProvider.test.tsx`
