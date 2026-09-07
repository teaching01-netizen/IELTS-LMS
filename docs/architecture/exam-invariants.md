# Exam Invariants

Source of truth for rules every implementation (frontend, backend, QA) must preserve.
Unresolved rules are explicit decisions with owners — never silent assumptions.

## Verified vocabulary (do not rename without updating these docs)

- Phases: `STUDENT_EXAM_PHASE` = `pre-check | lobby | exam | post-exam | submitted`
  (`src/features/student/domain/exam-session/studentExamPhase.ts`).
- Terminal: `VerifiedTerminalState = not_terminal | completed | terminated`, resolved by
  `getVerifiedTerminalState({ attempt, runtime })`; structural completion by
  `isRuntimeStructurallyCompleted(runtime)`
  (`src/features/student/domain/exam-session/terminalState.ts`).
- Submission gate: `evaluateSubmissionBarrier({ phase, pendingMutationCount, durabilityReady,
runtimeBacked, runtimeStatus, runtimeCompletionVerified })`
  (`src/features/student/domain/exam-session/submissionPolicy.ts`).
- Blocking: `StudentBlockingReason`, resolved by `deriveBlockingState`; `offline |
syncing_reconnect | heartbeat_lost | device_mismatch` are log-only and never drive
  blocking UI by themselves
  (`src/features/student/domain/exam-session/blockingPolicy.ts`).
- Sync display: `AttemptSyncState = idle | saving | saved | offline | syncing_reconnect | error`
  (`src/types/studentAttempt.ts`).
- V2 durability display: `DurabilitySyncStatus = synced | saving | saved_locally |
durability_fault | conflict_fenced | conflict_terminal`; visible answer =
  `getVisibleResponse(state)` (pending-first)
  (`src/shared/durability/types.ts`).

## Invariants

1. **Immutable version reference.** An attempt references the exam version it started
   with. Grading resolves that pinned version and its versioned grading policy.
   Draft edits after start must not alter historical grading. (T1.4 implements the
   pin; until then this is ENFORCED-BY-TEST, not by code.)
2. **Server decides acceptance.** No answer is "saved to server" without a server
   acknowledgement: legacy `serverAcceptedThroughSeq` or a V2 per-write
   acknowledgement (`ResponseAcknowledgementV2`, outcome `applied | duplicate |
superseded`). Pending-first rendering (`getVisibleResponse`) is a display rule,
   not acceptance.
3. **Distinct save states.** "Saved on device" (local persistence completed) and
   "saved to server" (acknowledgement received) are different verified states.
   Never display one on the other's evidence. See `docs/architecture/delivery-contracts.md`.
4. **Idempotent retry.** Retrying a mutation or submission cannot create duplicate
   effects: V2 retries reuse the same `writeId`/`submissionId`; reuse of an identity
   with different content is rejected. Backend reference: submission-replay guard
   (HTTP 409 + `existingSubmissionId`) in `backend/go/internal/attempts/submit.go`.
5. **Stale rejection.** A stale response cannot overwrite a newer accepted answer:
   client via `reconcileServerSnapshot` + freshness guards
   (`highestSeenAttemptRevisionRef`, epoch checks in
   `src/features/student/hooks/useStudentSessionRouteData.ts`); server via
   lease/control-epoch fencing (`backend/go/internal/attempts/submit.go`).
6. **Verified terminal only.** An attempt reaches a terminal state only through
   `getVerifiedTerminalState` / `isRuntimeStructurallyCompleted`, never through a
   client-side flag alone. "Submission pending" ≠ "submitted".
7. **Submission barrier.** `evaluateSubmissionBarrier` must return `{ kind: 'ready' }`
   before submit: phase is `exam`, zero pending mutations, durability ready, and
   runtime completion verified when runtime-backed. The coordinator order is
   `commitAll → flushDurability → flushPending → submit`
   (`src/features/student/application/exam-session/studentSubmissionCoordinator.ts`).
8. **Preview purity.** `StudentExamPreview` renders fully local state: synthetic
   `preview-attempt-<examId>` snapshot, `persistenceEnabled={false}`, monitoring
   disabled, and pre-check completes locally without POST
   (`src/components/student/StudentExamPreview.tsx:47-151`,
   `src/components/student/providers/StudentAttemptProvider.tsx:880-918,1249-1262,1353-1355`).
   Typing + flagging in IELTS preview performs zero `fetch`/`sendBeacon`/
   `WebSocket` calls across a 60s timer flush (regression spec in
   `src/components/student/__tests__/StudentExamPreview.test.tsx`). SAT staff
   preview keeps answers in `useState` with the draft projection as the only
   read (`useSatPreviewController.ts:67-91,133-138`); answering performs zero
   delivery writes (mirror spec in
   `src/features/student-delivery/routes/__tests__/SatPreviewRoute.test.tsx`). Builder
   runtime preview is the documented exception: it intentionally provisions an
   isolated `__preview_runtime__` schedule/attempt and disables only downstream
   answer sync (`src/features/builder/services/previewRuntimeSessionService.ts:1-9`,
   `src/features/builder/routes/ExamPreviewRoute.tsx`).
9. **Timer purity.** Countdown display updates cannot reset answers, focus, or
   navigation. Only clock UI subscribes to ticks
   (`useAuthoritativeDeadlineClock` + `StudentExamClockEffects`); content never
   re-renders on tick.
10. **Auth-recovery preservation.** Authentication recovery cannot silently discard
    pending answers; reauthentication returns to the same attempt with queued work
    preserved per policy (ASSUMED — revalidate in T0.2; spec required in T1.2).

## Open decisions (owner required before Wave 2)

- D1: Offline edits received after the deadline — accept, grace-period, or review?
  Owner: backend + exam policy. Client timestamps are not proof.
- D2: Allowed active-device policy (single writer? takeover flow?). Owner: backend.
- D3: Legacy `serverAcceptedThroughSeq` contiguous-prefix semantics vs V2
  per-write acks during migration — which is authoritative per product? Owner: delivery.
