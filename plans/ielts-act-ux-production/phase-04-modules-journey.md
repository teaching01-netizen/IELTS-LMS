# Phase 4 — IELTS modules, ACT Science, and student journey

Status: planned. Depends on: [Phase 3](phase-03-controls-navigation.md). Next: [Phase 5](phase-05-annotations-memory.md).

## Result

The shared system is applied to every in-scope student surface, including non-happy-path screens. Module content and provider rules remain correct.

## P4.1 — Integrate Reading

**Files:** `src/components/student/StudentReading.tsx`, `StudentQuestionPanel.tsx`, `StudentQuestionBlockSection.tsx`, existing passage normalization/sanitization and highlighter components.

1. Remove duplicate typography/padding rules after Phase 1 variables are wired. Use a bounded reading measure, with pane width and text-column width as separate concepts.
2. Preserve authored paragraph boundaries and inline A/B/C anchors. Avoid transforming paragraph text just to achieve alignment; that would invalidate stored annotation offsets.
3. Derive passage selection from the current question/group identity through the existing content facade. A move within the same passage should not reset its scroll position; a different passage restores its own position.
4. Keep question focus, source scroll, and answer state independent. An answer/flag update must not remount the passage highlighter.
5. Handle missing/empty passage using `StudentModuleEmptyState` with useful recovery context. Do not render an empty white work area or manufacture content.

Acceptance: long Academic/General Training passages, inline completion, headings/matching, and grouped questions retain correct order, readability, and answer IDs across navigation.

## P4.2 — Integrate Writing without replacing its editor

**Files:** `StudentWriting.tsx`, `StudentWritingPanes.tsx`, `StudentWritingCountdown.tsx`, `WritingTaskNavigator.tsx`.

1. Flatten the response card into the actual work pane. Align response/prompt content origins, remove entrance motion, reserve word-count width, and use the same font and inset for placeholder and text.
2. Keep the current uncontrolled/native textarea and its live-draft refs. Do not convert it to a controlled rich-text editor. Write external text into the DOM only when the accepted task/value identity requires it and the DOM is different.
3. Preserve the current commit sequence: live editor input → latest task draft/preview → existing 300ms draft commit → current persistence adapter. Flush through existing composition/blur/task/visibility/submission boundaries. Do not add a second debounce around the same mutation.
4. Track composition start/end explicitly if needed for safe restoration. A timer tick, font/layout adjustment, or stale response cannot replace a composing DOM value. When a deadline arrives during composition, use the existing live-DOM draft barrier and authoritative late-write policy; do not grant local extra time.
5. Keep task IDs exact for persistence. If legacy normalization supports aliases, retain that at its existing compatibility boundary and test collisions rather than adding new ID normalization in the view.
6. Include task identity in `WritingPromptPane` memo comparisons; identical text under different IDs must render the correct annotation surface. Compare immutable chart identity/content without suppressing relevant changes.
7. Preserve configured word-count rules. Styling must not change whether hyphenated words, line breaks, or whitespace count. Do not show a green “good answer” implication from word count alone.
8. Retain clipboard/undo/context-menu rules from Phase 0. A later approved policy change belongs at the keyboard/clipboard boundary and must update local guards and tests together.

Acceptance: 1,000+ words, whitespace-only content, multilingual IME, identical prompts on different tasks, task switch before debounce, resize during composition, old server hydration, and existing undo/clipboard restrictions all behave predictably.

## P4.3 — Integrate Listening and playback failure states

**Files:** `StudentListening.tsx`, `StudentMaterialWithQuestionPane.tsx`, `StudentExamWorkspace.tsx`, existing accessibility playback preferences.

1. Keep one media element for the currently authorized audio source; move its ownership outside any visibility-switched pane if necessary. Do not restart it when focus layout switches panels.
2. Derive playing/paused/stalled/ended/error status from actual media events and play promise outcomes. A clicked Play button is not proof that audio started.
3. Use explicit loading and retry states for media failure. Retry the same authorized source without changing current answers; retain playback position where policy/browser permits.
4. Preserve configured seeking, replay, playback speed, transcript, and volume behavior. Do not expose a transcript or replay option merely because compact layout needs another panel.
5. Distinguish media loading from exam timing. Local audio failure does not pause a server deadline; show the appropriate proctor/support instruction where recovery requires intervention.
6. Treat captions as actual authored/accommodation content. An empty track is not evidence of accessible captions, and adding a transcript can change assessment validity.

Acceptance: rejected play, source change, stall, error, retry, end, pane switch, and device rotation maintain one coherent media state and preserve answer/timer rules.

## P4.4 — Integrate the existing Speaking support surface

**Files:** `StudentSpeaking.tsx`, `StudentExamWorkspace.tsx`, shared layout/clock components.

Pass adaptive capabilities into Speaking; remove hardcoded desktop splitter assumptions. Keep cue-card/instructions, preparation status, proctor-controlled buttons, and navigation clear at small sizes.

Audit local counters against runtime intent. If they are advisory practice counters, label them accordingly and compute elapsed time from a start instant instead of accumulating interval ticks. If the actual delivery configuration treats a counter as authoritative, consume server timing through the existing protocol; do not simulate it in the client. Preserve pause/extension semantics.

The disabled microphone/video/end-call controls in the inspected code do not establish a working calling/recording system. Keep their state honest. No new conferencing, recording, or upload subsystem is included in this phase.

## P4.5 — Integrate ACT Science

**Files:** `StudentScience.tsx`, `StudentZoomableMedia.tsx`, `QuestionRenderer.tsx`, `StudentExamWorkspace.tsx`, `StudentExamPhaseRenderer.tsx`, `StudentPostExamView.tsx`; consume the existing ACT reconciliation changes.

1. Confirm runtime Science ordering and question counts through the current ACT content adapter. Preserve variable counts; 40 is a fixture/configuration value, not a navigation hardcode.
2. Apply readable text/table/graph layout and preserve image aspect ratio, labels, and scientific notation. Reserve aspect-ratio space when dimensions are known to avoid layout jumps during image decode.
3. Treat stimulus image, question image, and choice image as distinct content. An image error must name the affected material and offer the supported retry; it must not delete/select an answer.
4. Keep option selection, elimination, flagging, and enlarge actions independent. Keyboard use cannot accidentally mark an answer while opening an image.
5. Use existing upload/media references, URL sanitation, and zoom component. Do not create another ACT media service. Enlargement stays within the viewport, supports keyboard close, and restores focus.
6. Use ACT/Science copy in header, navigation, confirmations, and completion. Keep grade/result values from the server, including pending/unavailable result states.

## P4.6 — Cover entry through completion

**Files:** `src/features/student/routes/StudentEntryRoute.tsx`, `StudentAccessLinkEntryRoute.tsx`, `StudentRegistrationRoute.tsx`, `StudentSessionRoute.tsx`; `ExamEntryCard.tsx`, `PreCheck.tsx`, `Lobby.tsx`, `StudentExamPhaseRenderer.tsx`, `WarningOverlay.tsx`, `SubmitConfirmation.tsx`, `StudentPostExamView.tsx`.

Trace actual route dispatch from the student-delivery wrappers before editing; modify the active implementation, not an unused compatibility route.

| State | Required UI work |
| --- | --- |
| Registration validation | Associate errors with inputs; preserve values; focus first invalid field; no duplicate submit |
| Invalid/expired access | Specific recoverable message; no attempt details leaked |
| Pre-check pending/failure | Show which supported check failed and next action; no fabricated permission success |
| Lobby/waiting | Correct provider/section readiness; start only when allowed |
| Paused/intervention | Existing blocking authority with concise candidate language and predictable focus |
| Reconnecting | Truthful save state; keep the latest work visible where policy permits |
| Finalizing | Pending verification; disable duplicate terminal actions |
| Completed | Verified provider-correct summary/receipt; no stale edit controls |

Allow ordinary page scroll for long forms/pre-check/completion. Keep exam page lock limited to active work. Intrinsic height and safe areas replace brittle `h-screen` wrappers where they hide content.

## P4.7 — Preserve preview, proctor, and results integration

**Files:** `StudentExamPreview.tsx`, current authoring preview route, existing ACT delivery/results services and tests.

Preview must use the same rendering components and provider configuration. Resolve ACT's first Science question using the canonical content function rather than leaving a null initial selection by accident. Maintain synthetic preview identity and disabled production persistence/monitoring.

Run existing proctor intervention and results integration scenarios. Verify grading review receives the same persisted IDs/values after presentation changes. Do not rewrite unrelated authoring or results layouts as part of this student UX phase.

## Validation and delivery

```sh
npm run test:run -- src/components/student/__tests__/StudentWriting.lifecycle.test.tsx src/components/student/__tests__/StudentWriting.a11y.test.tsx src/components/student/__tests__/StudentWriting.clipboard.test.tsx src/components/student/__tests__/StudentWriting.undo.test.tsx src/components/student/__tests__/StudentListening.a11y.test.tsx src/components/student/__tests__/StudentSpeaking.a11y.test.tsx src/components/student/__tests__/StudentScienceImages.actReconciliation.test.tsx src/components/student/__tests__/StudentPostExamView.actReconciliation.test.tsx
npm run typecheck
```

Add focused coverage for newly corrected media and identical-prompt identity cases. Use existing ACT workflow/full-cycle and student journey E2Es for later integration validation. Each module is a separate reviewable slice; ship them only when the shared shell and provider invariants remain consistent.

Exit gate: all five in-scope module surfaces and journey states have implementations and relevant tests; no fake media/call state, answer-model change, local scoring authority, or hidden security-policy change is introduced.
