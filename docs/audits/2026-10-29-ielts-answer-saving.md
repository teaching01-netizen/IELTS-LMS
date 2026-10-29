# IELTS answer-saving audit — 2026-10-29

## 1. Executive Assessment

Focused review of question membership and temporary save refusals. Three additional defects were reproduced with failing tests and fixed locally. The production logs supplied earlier establish the original slot-ID failure; they do not prove these additional cases occurred in production. No deployment or production-data inspection was performed.

Critical findings: 0 confirmed. High findings: 3 fixed. Specification gaps: none blocking these fixes. Most fragile workflow: a queued answer racing a pause. Overall confidence is limited to the paths and tests described here, not an exhaustive IELTS certification.

## 2. Domain Model

An attempt pins an exam version. The student adapter hydrates that snapshot into answer keys. The server resolves each key to a section and checks its current write window. The durability engine retains each write until acknowledged or explicitly refused as terminal.

## 3. Critical Invariants

| ID | Invariant | Enforcement | Status after fixes |
| --- | --- | --- | --- |
| INV-1 | Legacy task and MCQ keys displayed by the student must resolve in the pinned snapshot. | Shared single/batch snapshot ID visitor. | Protected for tested legacy shapes. |
| INV-2 | A temporary pause must preserve a queued write for resume. | Server SAVE_PAUSED reason and client retry routing. | Protected for tested attempt/runtime/section/timeline pauses. |
| INV-3 | Terminal attempts and unknown IDs remain unwritable. | Existing admission and terminal gates; negative regression cases. | Protected by tested paths. |

## 4. State-Machine Findings

Previously, ATTEMPT_NOT_WRITABLE represented both a pause and a permanent closure. A save racing the pause moved the client into conflict_terminal, quarantining drafts; resuming the exam did not reopen that engine. Pauses now reject with SAVE_PAUSED, retaining the same write for bounded retries. Terminal states still use their existing refusal paths.

## 5. Confirmed Bugs

### P1 — Pause could permanently stop autosaving

Given a pending answer, when a pause rejects its save with ATTEMPT_NOT_WRITABLE, the engine previously quarantined the answer and stopped accepting subsequent answers even after resume. Server refusals now identify temporary pauses, and the engine retries them without changing the write identity. Personal IELTS section timeline pauses receive the same treatment.

Evidence: TestEnsureWritableIELTSPauseIsRetryable, TestEnsureIELTSPersonalTimelinePauseIsRetryable, and “retries a paused IELTS save and delivers it after resume.” Each new behavior was observed failing before its fix.

### P1 — Legacy writing answers could receive NOT_FOUND

Given a writing snapshot with task1Prompt/task2Prompt and no explicit task IDs, the student hydrator creates task1/task2. The resolver previously recognized neither key. It now recognizes the legacy prompt fields as the corresponding task identities.

Evidence: TestSnapshotOwnersRecognizeHydratedLegacyIELTSIDs failed for both task keys before the fix and passes afterward for both single and batch resolution.

### P1 — Legacy multiple-choice answers could receive NOT_FOUND

Given a SINGLE_MCQ block with multiple questions lacking IDs, normalizeSingleMcqBlock assigns the first question the block ID and later questions block-id:q2, etc. The resolver previously rejected the generated IDs. It now derives the same bounded IDs from the actual question positions, while preserving explicit IDs and rejecting nonexistent positions.

Evidence: TestSnapshotOwnersRecognizeHydratedLegacyIELTSIDs failed for mcq:q2 before the fix; negative cases reject mcq:q3 when that position has an explicit ID, mcq:q4 when absent, and task3.

## 6. Edge Cases

- Historical/integration: legacy writing prompt fields, missing MCQ IDs, explicit MCQ IDs, single/batch parity.
- State/time: paused attempt, room, cohort section, personal timeline, resume, terminal attempt with a concurrent pause.
- Retry/data integrity: identical write envelope is retried after pause; no quarantine; server acknowledgement confirms the retained answer.
- Authorization: pauses continue to refuse writes while paused; unknown IDs and SAT snapshot fallback restrictions remain enforced.

## 7. Concurrency and Idempotency

The regression simulates a save racing a pause, followed by resume. It verifies that retry sends the same command identity and payload. Existing durability, module-scope, control-epoch, backend API, and attempt-service tests passed. No new multi-browser or live-database concurrency load test was run.

## 8. Data Integrity Risks

No schema, storage-retention, ledger, or database constraint changes were made. The fixes prevent rejection or quarantine of otherwise-valid pending writes. They cannot restore data already cleared from a student's device. Database constraint coverage beyond the existing attempt tests was outside this focused audit.

## 9. Cross-Feature Inconsistencies

The root inconsistencies were student hydration versus server snapshot membership, and server temporary-pause semantics versus client terminal-error classification. Fixes belong at those shared boundaries, covering all callers.

## 10. Missing Regression Tests

No known blocking gap remains for the three fixes. Remaining verification limits: real deployed pause/resume, historical production snapshots, and real-browser local-storage recovery were not exercised in this pass.

Validation: API and attempt Go suites pass; 124 frontend durability/provider/transport tests pass; TypeScript typecheck passes. Targeted ESLint and diff whitespace checks are also run before completion.

## 11. Recommended Fix Order

All three local fixes are implemented. Deploy the backend and frontend together so SAVE_PAUSED is understood by the client. Verify one legacy writing task, one legacy MCQ, and an answer-save/pause/resume cycle on the deployed environment. Keep affected browser storage intact until pending answers have been reconciled.
