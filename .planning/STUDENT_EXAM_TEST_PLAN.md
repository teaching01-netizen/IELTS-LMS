# Student Exam — Full Test Coverage Plan

**Date:** 2026-07-05
**Goal:** 100% test coverage across all student exam flows
**Status:** PLANNING ONLY — no code changes

---

## Executive Summary

The student exam system spans **~60 source files** across routes, components, providers, services, and utilities. Current test coverage is partial:

- **41 component/provider test files** exist (good baseline)
- **7 service test files** exist for student services
- **5 feature-level test files** exist
- **8 E2E spec files** exist for student flows
- **1 backend contract test** exists for student endpoints
- **4 backend integration tests** exist (mutation replay, submission policy, attempt invariants, registration)

**Critical gaps identified below.**

---

## Coverage Matrix

### 1. ROUTES (Entry Points)

| File | Existing Tests | Gap | Required New Tests |
|------|---------------|-----|-------------------|
| `src/features/student/routes/StudentEntryRoute.tsx` | `StudentEntryRoute.test.tsx` | Queued admission polling, validation errors, duplicate entry | `StudentEntryRoute.queuedAdmission.test.tsx`, `StudentEntryRoute.validation.test.tsx` |
| `src/features/student/routes/StudentSessionRoute.tsx` | `StudentSessionRoute.test.tsx` | Error states, loading skeleton, re-auth redirect | `StudentSessionRoute.errorStates.test.tsx` |
| `src/routes/index.tsx` | `route-contract.test.tsx` | Student route param validation | `studentRouteContract.test.tsx` |

### 2. COMPONENTS — Student Exam Shell

| File | Existing Tests | Gap | Required New Tests |
|------|---------------|-----|-------------------|
| `StudentApp.tsx` (903 lines) | `StudentApp.test.tsx` | Auto-submit boundary, module submit confirmation, blocking overlay transitions, time extension request flow, answer change → mutation pipeline, writing answer change, flag toggle | `StudentApp.autoSubmit.test.tsx`, `StudentApp.blockingOverlays.test.tsx`, `StudentApp.answerPipeline.test.tsx`, `StudentApp.timeExtension.test.tsx` |
| `StudentHeader.tsx` | `StudentHeaderHighlightHint.test.tsx` | Time display, navigator toggle, accessibility button, test taker ID | `StudentHeader.test.tsx` |
| `StudentFooter.tsx` | `StudentFooterRepresentative.test.tsx` | Module progress calculation, submit button states | `StudentFooter.progress.test.tsx`, `StudentFooter.submitStates.test.tsx` |
| `QuestionNavigator.tsx` | None | Answered/flagged indicators, question navigation, keyboard nav | `QuestionNavigator.test.tsx` |
| `SubmitConfirmation.tsx` | None | Unanswered question count, confirm/cancel, partial submit | `SubmitConfirmation.test.tsx` |

### 3. COMPONENTS — Phase Components

| File | Existing Tests | Gap | Required New Tests |
|------|---------------|-----|-------------------|
| `PreCheck.tsx` (307 lines) | `PreCheck.test.tsx` | Browser detection edge cases, storage quota check, online/offline transitions, screen detail collection | `PreCheck.edgeCases.test.tsx` |
| `Lobby.tsx` (72 lines) | None | Section duration display, total duration, start button disabled states | `Lobby.test.tsx` |
| `StudentPostExamView.tsx` | `StudentPostExamView.test.tsx` | Student info display, completion status | Covered |
| `StudentExamWorkspace.tsx` | `StudentExamWorkspace.test.tsx` | Module routing logic (listening→reading→writing→speaking) | `StudentExamWorkspace.moduleRouting.test.tsx` |

### 4. COMPONENTS — Module-Specific

| File | Existing Tests | Gap | Required New Tests |
|------|---------------|-----|-------------------|
| `StudentListening.tsx` (473 lines) | `StudentListening.a11y.test.tsx` | Audio play/pause/skip, split-pane interaction, highlight in listening, question navigation, audio seek behavior | `StudentListening.audioControls.test.tsx`, `StudentListening.navigation.test.tsx` |
| `StudentReading.tsx` (378 lines) | `StudentReadingReadabilityControls.test.tsx` | Passage rendering, highlight interaction, split-pane resize, readability level changes | `StudentReading.passageRendering.test.tsx`, `StudentReading.highlightInteraction.test.tsx` |
| `StudentWriting.tsx` (790 lines) | `StudentWriting.a11y.test.tsx`, `.lifecycle.test.tsx`, `.clipboard.test.tsx`, `.undo.test.tsx`, `.typingPerformance.test.tsx` | Word count edge cases, draft commit flow, paste sanitization, undo/redo stack limits, keyboard shortcuts in writing | `StudentWriting.wordCount.test.tsx`, `StudentWriting.draftCommit.test.tsx`, `StudentWriting.keyboardShortcuts.test.tsx` |
| `StudentSpeaking.tsx` (327 lines) | `StudentSpeaking.a11y.test.tsx` | Prep timer, speak timer, part navigation, recording state transitions | `StudentSpeaking.timers.test.tsx`, `StudentSpeaking.partNavigation.test.tsx` |

### 5. COMPONENTS — Answer Controls

| File | Existing Tests | Gap | Required New Tests |
|------|---------------|-----|-------------------|
| `ProtectedChoiceInput.tsx` | `ProtectedChoiceInput.test.tsx` | MCQ multi-select, T/F/NG selection, choice deselection | `ProtectedChoiceInput.multiSelect.test.tsx` |
| `ProtectedSelect.tsx` | `ProtectedSelect.test.tsx` | Dropdown options, disabled state, selection change | Covered |
| `resolveObjectiveAnswerUpdate.ts` | `resolveObjectiveAnswerUpdate.test.ts` | Slot-based updates, scalar updates, choice updates, null clears | `resolveObjectiveAnswerUpdate.slots.test.ts` |
| `answerUndoRedoGuard.ts` | None | Guard logic for answer mutations during undo/redo | `answerUndoRedoGuard.test.ts` |
| `SubAnswerTreeQuestionList.tsx` | `SubAnswerTreeQuestionList.test.tsx` | Nested answer rendering, slot-based navigation | `SubAnswerTreeQuestionList.nested.test.tsx` |
| `TableCompletionSlotCell.tsx` | None | Slot cell rendering, input handling, validation | `TableCompletionSlotCell.test.tsx` |

### 6. COMPONENTS — Highlight System

| File | Existing Tests | Gap | Required New Tests |
|------|---------------|-----|-------------------|
| `HighlightableSurface.tsx` | `HighlightableSurfaceDomStability.test.tsx` | Text selection, highlight creation, multi-color | `HighlightableSurface.selection.test.tsx` |
| `RichTextHighlighter.tsx` | `RichTextHighlighter.test.tsx` | Color palette, highlight persistence, highlight removal | Covered |
| `highlightSelectionManager.tsx` | `highlightSelectionPort.test.tsx` | Provider state, highlight toggle, color switching | `highlightSelectionManager.state.test.tsx` |
| `highlightV2Engine.ts` | `highlightV2Engine.test.ts` | V2 engine highlight/restore, DOM mutation handling | Covered |
| `useHighlightSurfaceV2.ts` | None | Hook state management, highlight creation flow | `useHighlightSurfaceV2.test.tsx` |

### 7. COMPONENTS — Warning/Integrity

| File | Existing Tests | Gap | Required New Tests |
|------|---------------|-----|-------------------|
| `WarningOverlay.tsx` | `useStudentWarningVisibility.test.tsx` | Overlay severity display, countdown timer, acknowledge action, dismiss behavior | `WarningOverlay.test.tsx` |
| `useStudentWarningVisibility.ts` | `useStudentWarningVisibility.test.tsx` | Warning queue management, visibility transitions | Covered |
| `tabletMode.ts` | `tabletMode.test.ts` | Covered | — |
| `appleMobileDevice.ts` | None | Apple mobile detection edge cases | `appleMobileDevice.test.ts` |

### 8. PROVIDERS

| File | Existing Tests | Gap | Required New Tests |
|------|---------------|-----|-------------------|
| `StudentRuntimeProvider.tsx` (1255 lines) | `StudentRuntimeProvider.test.tsx` | Timer countdown, phase transitions, module transitions, blocking state machine integration, proctor status sync, violation recording | `StudentRuntimeProvider.timer.test.tsx`, `StudentRuntimeProvider.phaseTransitions.test.tsx`, `StudentRuntimeProvider.blocking.test.tsx` |
| `StudentAttemptProvider.tsx` (1480 lines) | `StudentAttemptProvider.test.tsx` | Mutation outbox integration, flush/retry logic, conflict handling (ATTEMPT_SUBMITTED, SECTION_MISMATCH, OBJECTIVE_LOCKED), IndexedDB fallback, pending mutation durability, heartbeat recording | `StudentAttemptProvider.mutationOutbox.test.tsx`, `StudentAttemptProvider.conflictHandling.test.tsx`, `StudentAttemptProvider.durability.test.tsx` |
| `StudentUIProvider.tsx` (191 lines) | `StudentUIProvider.test.tsx` | Accessibility settings, time extension state | Covered |
| `StudentProctoringProvider.tsx` (608 lines) | `StudentProctoringProvider.test.tsx` | Tab switch detection, secondary screen, screenshot detection, translation detection, clipboard blocking, context menu blocking | `StudentProctoringProvider.violations.test.tsx`, `StudentProctoringProvider.blocking.test.tsx` |
| `StudentNetworkProvider.tsx` (450 lines) | `StudentNetworkProvider.test.tsx` | Heartbeat interval, device fingerprint comparison, reconnection flow, runtime refresh on reconnect | `StudentNetworkProvider.heartbeat.test.tsx`, `StudentNetworkProvider.reconnection.test.tsx` |
| `StudentKeyboardProvider.tsx` (431 lines) | `StudentKeyboardProvider.test.tsx` | Modifier key blocking, inspector shortcut blocking, exam navigation shortcuts, Cmd+Enter submit | `StudentKeyboardProvider.shortcuts.test.tsx` |
| `blockingStateMachine.ts` (137 lines) | `blockingStateMachine.test.ts` | Priority ordering, state transitions, multiple simultaneous blocking reasons | `blockingStateMachine.priority.test.ts` |

### 9. SERVICES — Student

| File | Existing Tests | Gap | Required New Tests |
|------|---------------|-----|-------------------|
| `studentAttemptRepository.ts` (1628+ lines) | `studentAttemptRepository.test.ts`, `.backend.test.ts` | Mutation compaction, supersession logic, IndexedDB fallback, cache pruning, sequence watermark tracking, client session ID management | `studentAttemptRepository.compaction.test.ts`, `studentAttemptRepository.indexedDb.test.ts`, `studentAttemptRepository.watermark.test.ts` |
| `studentMutationOutbox.ts` (709 lines) | `studentMutationOutbox.flushNow.test.ts` | Mutation coalescence, durable persistence mirror, answer sync checkpoint, flush cycle management, conflict handling, retry logic | `studentMutationOutbox.coalescence.test.ts`, `studentMutationOutbox.durability.test.ts`, `studentMutationOutbox.conflicts.test.ts` |
| `studentSessionTransport.ts` (81 lines) | `studentSessionTransport.test.ts` | Covered | — |
| `studentAttemptNormalization.ts` (148 lines) | `studentAttemptNormalization.test.ts` | Covered | — |
| `studentIntegrityService.ts` (145 lines) | `studentIntegrityService.policy.test.ts` | Covered | — |
| `studentAuditService.ts` (72 lines) | `studentAuditService.test.ts` | Covered | — |
| `attemptCredentialAdapter.ts` (222 lines) | None | Token store, refresh, auth header building | `attemptCredentialAdapter.test.ts` |

### 10. SERVICES — Exam (Student-Facing)

| File | Existing Tests | Gap | Required New Tests |
|------|---------------|-----|-------------------|
| `examAdapterService.ts` (1123 lines) | Multiple test files | `hydrateExamState` edge cases, `countAnsweredQuestions` for all question types, `isQuestionFullyAnswered` for sub-answer trees | `examAdapterService.hydrateEdgeCases.test.ts`, `examAdapterService.answerCounting.test.ts` |
| `examDeliveryService.ts` (553 lines) | `examDeliveryService.test.ts`, `.policy.test.ts`, `.backend.test.ts` | Section planning edge cases, schedule window validation, runtime control transitions | `examDeliveryService.sectionPlanning.test.ts` |
| `backendBridge.ts` (631 lines) | None | Response mapping for all student endpoints, error handling | `backendBridge.studentMapping.test.ts` |
| `authService.ts` (156 lines) | None (auth feature has separate tests) | Student entry flow, session cookie handling | `authService.studentEntry.test.ts` |

### 11. SERVICES — Grading (Student-Facing)

| File | Existing Tests | Gap | Required New Tests |
|------|---------------|-----|-------------------|
| `gradingService.ts` (1308 lines) | None (has proctor tests) | Student submission creation, result release, section grading status | `gradingService.studentSubmission.test.ts` |

### 12. UTILITIES — Student Exam

| File | Existing Tests | Gap | Required New Tests |
|------|---------------|-----|-------------------|
| `examUtils.ts` | `examUtils.matching.test.ts` | Question counting for all 14 types, validation | `examUtils.questionCounting.test.ts` |
| `acceptedAnswers.ts` | `acceptedAnswers.test.ts` | Covered | — |
| `answerRuleAutoUpgrade.ts` | None | Auto-upgrade logic for answer rules | `answerRuleAutoUpgrade.test.ts` |
| `subAnswerTree.ts` | `subAnswerTree.test.ts` | Covered | — |
| `subAnswerTreeSlots.ts` | `subAnswerTreeSlots.test.ts` | Covered | — |
| `completionPromptText.ts` | None | Prompt text generation | `completionPromptText.test.ts` |
| `writingTaskUtils.ts` | `writingTaskUtils.test.ts` | Covered | — |
| `tableCompletion.ts` | `tableCompletion.test.ts` | Covered | — |
| `deviceFingerprinting.ts` | `deviceFingerprinting.test.ts` | Covered | — |
| `studentObservability.ts` | None | Observability metrics | `studentObservability.test.ts` |
| `cloneExamContent.ts` | `cloneExamContent.test.ts` | Covered | — |
| `sanitizeHtml.ts` | `sanitizeHtml.test.ts` | Covered | — |

### 13. HOOKS — Student

| File | Existing Tests | Gap | Required New Tests |
|------|---------------|-----|-------------------|
| `useStudentSessionRouteData.ts` (851 lines) | `.backend.test.tsx` | Static session loading, live session polling, WebSocket integration, version mismatch detection, answer invariant rollout | `useStudentSessionRouteData.staticLoading.test.tsx`, `useStudentSessionRouteData.websocket.test.tsx` |
| `studentSessionStateMachine.ts` | `studentSessionStateMachine.test.ts` | Covered | — |
| `liveSnapshotFreshness.ts` | `liveSnapshotFreshness.test.ts` | Covered | — |
| `useLiveUpdates.ts` | `useLiveUpdates.test.ts` | WebSocket reconnection, debounced event processing, runtime_snapshot handling | `useLiveUpdates.reconnection.test.ts` |

### 14. BACKEND — Student Contract Tests

| File | Existing Tests | Gap | Required New Tests |
|------|---------------|-----|-------------------|
| `student_contract.rs` | Exists | Full endpoint coverage, auth middleware, error responses, rate limiting | `student_contract_full.rs` (expand existing) |

**Missing backend contract tests:**
- `POST /v1/student/sessions/:id/submit` — submission contract
- `POST /v1/student/sessions/:id/precheck` — precheck contract
- `POST /v1/student/sessions/:id/bootstrap` — bootstrap contract
- `POST /v1/student/sessions/:id/audit` — audit contract
- `POST /v1/student/sessions/:id/mutations:batch` — mutation batch contract
- `POST /v1/student/sessions/:id/heartbeat` — heartbeat contract

### 15. BACKEND — Student Integration Tests

| File | Existing Tests | Gap | Required New Tests |
|------|---------------|-----|-------------------|
| `attempt_write_invariant_guard.rs` | Exists | Covers write invariants | — |
| `mutation_replay.rs` | Exists | Covers mutation replay | — |
| `submission_unanswered_policy.rs` | Exists | Covers unanswered policy | — |
| `registration_flow.rs` | Exists | Covers registration | — |
| `revision_tracking.rs` | Exists | Covers revision tracking | — |

**Missing backend integration tests:**
- Concurrent mutation batch processing
- Heartbeat timeout → violation escalation
- Auto-submit boundary enforcement
- Device fingerprint mismatch handling
- WebSocket live update delivery

### 16. E2E — Student Flows

| File | Existing Tests | Gap | Required New Tests |
|------|---------------|-----|-------------------|
| `student-workflow.spec.ts` | Exists | Full happy path | — |
| `student-precheck.spec.ts` | Exists | Pre-check flow | — |
| `student-timer.spec.ts` | Exists | Timer behavior | — |
| `student-network.spec.ts` | Exists | Network interruption | — |
| `student-security.spec.ts` | Exists | Security violations | — |
| `student-input-durability.spec.ts` | Exists | Input persistence | — |
| `student-ipad-layout.spec.ts` | Exists | iPad layout | — |
| `proctor-student-interventions.spec.ts` | Exists | Proctor interventions | — |

**Missing E2E tests:**
- `student-submit-flow.spec.ts` — End-to-end submission with unanswered questions
- `student-recovery.spec.ts` — Browser crash recovery, session resume
- `student-multi-device.spec.ts` — Device fingerprint mismatch flow
- `student-writing-draft.spec.ts` — Writing draft commit and undo flow
- `student-accessibility.spec.ts` — Accessibility settings end-to-end
- `student-time-extension.spec.ts` — Time extension request and grant flow
- `student-queue-admission.spec.ts` — Queued admission flow

---

## Priority Tiers

### Tier 1 — CRITICAL (exam integrity & data safety)
Tests that protect submitted exam answers being immutable, autosave durability, and submission correctness.

1. `studentAttemptProvider.conflictHandling.test.tsx` — ATTEMPT_SUBMITTED, SECTION_MISMATCH, OBJECTIVE_LOCKED
2. `studentAttemptProvider.durability.test.tsx` — localStorage + IndexedDB fallback
3. `studentMutationOutbox.coalescence.test.ts` — Mutation supersession
4. `studentMutationOutbox.conflicts.test.ts` — Server conflict handling
5. `studentAttemptRepository.compaction.test.ts` — Mutation compaction
6. `StudentApp.answerPipeline.test.tsx` — Answer change → mutation → persist → server
7. `StudentApp.autoSubmit.test.tsx` — Auto-submit boundary enforcement
8. `attemptCredentialAdapter.test.ts` — Token management for auth
9. Backend: `student_contract_submit.rs` — Submission endpoint contract
10. Backend: `student_contract_mutations.rs` — Mutation batch contract

### Tier 2 — HIGH (exam delivery & proctoring)
Tests that ensure the exam is delivered correctly and proctoring works.

11. `StudentRuntimeProvider.timer.test.tsx` — Timer countdown accuracy
12. `StudentRuntimeProvider.phaseTransitions.test.tsx` — Phase state machine
13. `StudentProctoringProvider.violations.test.tsx` — All violation types
14. `StudentNetworkProvider.heartbeat.test.tsx` — Heartbeat interval
15. `StudentNetworkProvider.reconnection.test.tsx` — Reconnection flow
16. `blockingStateMachine.priority.test.ts` — Priority ordering
17. `Lobby.test.tsx` — Lobby display and start
18. `QuestionNavigator.test.tsx` — Question navigation
19. `SubmitConfirmation.test.tsx` — Submit confirmation flow
20. Backend: `student_contract_heartbeat.rs` — Heartbeat contract

### Tier 3 — MEDIUM (module-specific functionality)
Tests for each exam module's unique behaviors.

21. `StudentListening.audioControls.test.tsx` — Audio playback
22. `StudentListening.navigation.test.tsx` — Listening navigation
23. `StudentReading.passageRendering.test.tsx` — Passage display
24. `StudentReading.highlightInteraction.test.tsx` — Highlight in reading
25. `StudentWriting.wordCount.test.tsx` — Word count edge cases
26. `StudentWriting.draftCommit.test.tsx` — Draft commit flow
27. `StudentWriting.keyboardShortcuts.test.tsx` — Writing shortcuts
28. `StudentSpeaking.timers.test.tsx` — Prep/speak timers
29. `StudentSpeaking.partNavigation.test.tsx` — Part navigation
30. `answerUndoRedoGuard.test.ts` — Undo/redo guard logic

### Tier 4 — LOW (utilities & edge cases)
Tests for utilities and edge cases.

31. `examUtils.questionCounting.test.ts` — All 14 question types
32. `answerRuleAutoUpgrade.test.ts` — Answer rule upgrades
33. `completionPromptText.test.ts` — Prompt text
34. `studentObservability.test.ts` — Metrics
35. `appleMobileDevice.test.ts` — Apple detection
36. `TableCompletionSlotCell.test.tsx` — Slot cell
37. `useHighlightSurfaceV2.test.tsx` — Highlight hook
38. `backendBridge.studentMapping.test.ts` — Response mapping
39. `authService.studentEntry.test.ts` — Student entry auth

### Tier 5 — E2E (full flow integration)
End-to-end tests covering complete user journeys.

40. `student-submit-flow.spec.ts` — Full submission
41. `student-recovery.spec.ts` — Crash recovery
42. `student-multi-device.spec.ts` — Device mismatch
43. `student-writing-draft.spec.ts` — Writing draft flow
44. `student-accessibility.spec.ts` — Accessibility
45. `student-time-extension.spec.ts` — Time extension
46. `student-queue-admission.spec.ts` — Queue admission

---

## Test File Naming Convention

Follow existing patterns:
- Component tests: `ComponentName.test.tsx`
- Service tests: `serviceName.test.ts`
- Policy tests: `serviceName.policy.test.ts`
- Backend contract tests: `domain_contract.rs`
- Backend integration tests: `feature_name.rs`
- E2E tests: `feature-name.spec.ts`

## Mocking Strategy

- **Frontend:** `vi.mock()` at module boundaries, `@testing-library/react` for rendering
- **Backend:** Real MySQL with transaction rollback, fixture builders from `backend/tests/support/fixtures.rs`
- **E2E:** Playwright with seeded data via `e2e_seed` binary

## Verification Commands

```bash
npm run test:run                    # Run all vitest tests
npm run test:coverage               # Coverage report
npm run playwright                  # Run all E2E tests
cargo test --manifest-path backend/Cargo.toml  # Backend tests
```

---

*Test plan: 2026-07-05 — 46 new test files needed for full coverage*
