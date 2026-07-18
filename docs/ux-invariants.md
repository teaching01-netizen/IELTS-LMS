# UX Invariants

Purpose: keep student-facing interaction rules explicit so future UI changes do not accidentally weaken exam usability or integrity.

## Student Exam Visible Viewport

### Owning Module

The active exam shell and footer row layout are owned by `src/index.css`. `StudentApp` installs the
exam lifecycle guard. Modern browsers use CSS dynamic viewport units; the guard publishes a visual
viewport height only as a capability fallback when `100dvh` is unsupported.

### Invariant

The exam shell is a page-layout grid sized in fallback order by `100vh`, `100svh`, and `100dvh`.
Its rows are intrinsic header, `minmax(0, 1fr)` workspace, and intrinsic footer. Every student
footer remains in normal flow, so its actual height is reserved and no passage, question, or editor
content can render underneath it. Safe-area insets are footer padding, never position offsets.

### Must Not Break

- The shell uses `position: relative`, dynamic viewport height, and
  `grid-template-rows: auto minmax(0, 1fr) auto`.
- The header is a non-scrolling in-flow grid row. It must not become sticky or independently fixed.
- Reading, Listening, and Writing footers share `.student-exam-footer`, use `position: relative`,
  and participate in their owning layout's footer row.
- `.student-exam-footer` has no `bottom` or logical bottom inset. Its modern pill radius, inset
  margins, and elevation are presentation only; they must not remove it from normal flow.
- Safe-area bottom/inline values are applied as padding inside the footer surface.
- Pane scroll owners must not add footer-overlay padding or scroll padding.
- The workspace grid item has `min-height: 0`; reading, listening, and writing panes remain the only
  content scroll owners.
- Browsers supporting `100dvh` must not receive JavaScript viewport geometry. The legacy fallback
  may publish only `--student-visual-viewport-height` from `VisualViewport.height`/`innerHeight`.
- No code may publish a viewport origin, footer coordinates, inferred keyboard state, or persisted
  geometry baseline.
- Root exam scrolling and overscroll chaining remain disabled.
- The viewport meta policy includes `viewport-fit=cover` and does not force an interactive-widget
  resize mode.
- No browser-family, operating-system, device-model, or version branch may select viewport layout.
- Safe-area padding, split-pane scrolling, native dialog positioning, and the exam page-zoom guard
  remain active.
- Exam viewport metadata is restored exactly when leaving the exam phase.
- Answer persistence, submission, timer, integrity, and audit behavior are unaffected.

### Regression Protection

- `src/components/student/__tests__/StudentApp.test.tsx`
- `src/components/student/__tests__/StudentViewportCss.test.ts`
- `src/components/student/__tests__/StudentFooterInFlowLayout.test.ts`
- `src/components/student/__tests__/examPageZoomGuard.test.ts`
- `e2e/student-ipad-layout.spec.ts`

## Student Exam Dialog Positioning

### Owning Module

Native modal positioning is owned by the shared dialog base styles in `src/index.css`. Student consumers include Question Navigator, Accessibility Settings, and the Time Extension request dialog.

### Invariant

Every open native modal dialog must remain centered in the visual viewport. Tailwind's element reset must not override the automatic margins required for native dialog centering.

Trigger-anchored popovers and dropdowns are not modal dialogs and remain positioned relative to their controls.

### Must Not Break

- Native `showModal()` top-layer, focus, inert-background, close, and backdrop behavior must remain intact.
- Dialogs must retain their `90vw` and `90vh` viewport limits and internal scrolling behavior.
- Custom warning, submission, integrity, and blocking overlays must keep their existing explicit positioning and behavior.

### Regression Protection

- `src/components/student/__tests__/StudentDialogCss.test.ts`
- `e2e/student-ipad-layout.spec.ts`

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

Highlighting is tool-first. In active Reading and Listening exams, students choose Highlight or Erase from the persistent header control, then complete a native text selection. The active operation runs immediately and remains active for subsequent selections. With the tool off, selection stays native and no range mutation or selection clearing occurs.

The floating cursor-following toolbar, toolbar coordinates, and transient captured-selection fallback must not be reintroduced. They conflict with iPad selection handles and can interrupt the gesture they are meant to act on.

When translation deterrence is active, iOS callout suppression is scoped to
`[data-student-highlightable="true"]` text and descendants. It must preserve native text
selection and must never expand onto answer controls. Translation deterrence is best effort on
unmanaged devices; it cannot guarantee that browser or operating-system translation is blocked.

Displayed question copy may suppress the WebKit touch-and-hold callout through the explicit
`[data-student-question-callout-protected="true"]` marker. The marked element and text-formatting
descendants must retain `user-select: text` so native selection and Highlight/Erase continue to
work. The marker must be applied to exact question-copy elements and must never wrap or be
applied to `input`, `textarea`, `select`, buttons, contenteditable regions, or other answer
controls. This remains best-effort browser deterrence; the web application cannot remove
individual iOS system actions while preserving selection.

### Must Not Break
- Native drag selection must work for reading passage title/body and visible question display text in exam mode.
- Highlight apply/remove must act on the latest valid captured selection for the active highlight surface only.
- Highlight mode remains active across question/passage navigation, but resets when leaving Reading/Listening, entering blocking/submission UI, or ending the exam.
- Persisted marks continue to hydrate and render while the tool is off.
- Highlighting must not create nested highlight marks when recoloring or reapplying over already-highlighted text.
- Persisted highlights must be tied to the rendered surface text and must reset when that text changes.

### Regression Protection
- `src/components/student/__tests__/highlightPersistence.test.tsx`
- `src/components/student/__tests__/highlightSelectionPort.test.tsx`
- `src/components/student/__tests__/highlightV2Engine.test.ts`
- `src/components/student/__tests__/StudentReadingReadabilityControls.test.tsx`
- `src/components/student/__tests__/StudentQuestionExperience.test.tsx`
- `src/components/student/__tests__/StudentQuestionCalloutCss.test.ts`
- `src/components/student/providers/__tests__/StudentKeyboardProvider.test.tsx`

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
