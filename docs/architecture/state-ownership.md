# State Ownership

One owner per piece of state. Dual runtime (new studentExamStore seam + legacy providers, both mounted in src/components/student/StudentAppWrapper.tsx) is the main structural risk.

## Owner table

| State                                         | Owner                       | Notes                                                                                                                          |
| --------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Exam definitions, ordinary server resources   | TanStack Query              | src/app/data queries, src/shared/api/queryClient                                                                               |
| Active attempt phase + answer commands        | Exam application store      | studentExamStoreFactory (vanilla Zustand + subscribeWithSelector); answerCommands / submissionCommands                         |
| Unsynchronized mutations                      | Durable outbox              | Exactly one canonical path per product (Wave 2.3 decides): V2 DurableResponseEngine or legacy studentMutationOutbox + adapters |
| Countdown presentation                        | Isolated clock subscription | useAuthoritativeDeadlineClock; only clock UI subscribes                                                                        |
| Dialog visibility, hover, temporary selection | Local UI state              | Never in the attempt store                                                                                                     |
| Theme / sidebar preferences                   | Existing persisted UI store | Unchanged                                                                                                                      |
| Authoritative acceptance + terminal status    | Server                      | Client mirrors via acks + getVerifiedTerminalState                                                                             |

## Composition root

StudentAppWrapper composes (outer to inner): StudentRuntimeProvider (1341 lines) > StudentAttemptProvider (1973 lines) > StudentExamSessionProvider (key=sessionScopeKey, scope = scheduleId:attemptId:candidateId) > ProctoringProvider > StudentNetworkProvider > UI. Store scope is fixed at creation; the provider only syncs live slices (phase/runtime/persistence/blocking) without remount.

## Writer map (T2.1 verified current state — read before editing providers)

IELTS live answers: UI (StudentApp handlers) → StudentAttemptProvider.persistAnswer/persistWritingAnswer/persistFlag (thin adapters at StudentAttemptProvider.tsx:1143-1190) → single enqueueV2Response (:1064) → V2 DurableResponseEngine; position/violations/pre-check/network go through applyPatch (:630) with persistenceEnabled=false local-only branches (:880-918,1249-1262,1353-1355). New seam (answerCommands.ts → enqueue → outbox) exists but is not yet the mounted path.

SAT live answers: question UI → useSatExamController.setAnswer/toggleReview (useSatExamController.ts:785-812) → satRunnerReducer dispatch (local state) + useSatResponsePersistence.save (outbox/durability). Previews on both products are out of this chain: IELTS preview is fully local (invariant 8), SAT preview is useState-only (useSatPreviewController.ts:67-91,133-138).

Rule: one writer per answer field per product — add new answer paths only through the canonical command/persistence above; never add a second direct repository/transport call from UI.

## Direction of migration (Wave 2.1)

1. Map every answer/runtime field to its current writers.
2. Route answer changes through one application command (answerCommands canonical; StudentAttemptProvider persist* becomes a thin adapter, then is removed).
3. Outbox owns pending-delivery state; one reconcile function (reconcileServerSnapshot + freshness guards).
4. Question-scoped selectors (useQuestionAnswer, useExamTimer); keep scope-key remount semantics. Refetch must preserve focus/scroll; typing in one question must not re-render unrelated questions.

## Enforcement

student-exam-architecture.test.ts + architectureRules.ts: domain has no React/browser/service imports; application has no React UI imports; feature internals import only via public interfaces; new services imports allowed only from approved infrastructure adapters (StudentAttemptProvider.tsx is the intentional compatibility exception).
