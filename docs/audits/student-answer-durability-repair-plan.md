# Student answer durability — production-grade repair plan (ROADMAP V1)

> Scope: fix all five confirmed state-loss paths in `docs/audits/student-answer-state-loss-audit.md` (F1–F5) without changing the backend fencing contract. This turn delivers the plan only; no application code is changed.

## 0. Route and success card

**Route: ROADMAP.** Justification: cross-system change (shared engine + two provider integrations + browser storage + UX + verification), ordered dependencies, exam-integrity risk. Per the orchestrator rules, DIRECT/LIGHT are insufficient; no L2 manager is needed (L0 + one integrator + lane owners suffice).

```text
SUCCESS CARD
Goal: a student answer, flag, elimination, or annotation that is visibly accepted
  is never silently replaced, dropped, or relabeled "saved" by recovery,
  version seeding, control-epoch changes, slow storage, or quarantine.
User-visible outcome: typed work survives reload, reconnect, proctor
  pause/resume/extension, slow networks, and storage pressure; anything that
  cannot be delivered is shown explicitly as blocked/conflicted, never lost.
Must do:
- F1: recovery cannot overwrite newer input with an older local draft.
- F2: no command is issued with an uninitialized version; collisions keep the
  student draft visible with an explicit conflict state.
- F3: control-epoch bumps move unsent work to an explicit reconcile state,
  never to silent loss; timing-only changes can reconcile safely.
- F4: latest accepted intent is checkpointed synchronously, ahead of slow
  async storage; teardown cannot lose it.
- F5: quarantine archives durably BEFORE the source copy is removed; archive
  failure retains the source and raises a storage fault.
Must preserve:
- Backend fencing contract: lease/control epoch equality, per-question
  version uniqueness, writeId idempotency + exact replay, monotonic
  projection, superseded acks (backend/go/internal/attempts/service.go).
- Exam integrity: terminal/security fences never auto-replayed; no bypass of
  section admission, writability, or submission finality.
- Existing protections: ack write-identity checks, retry on missing ack,
  IELTS metadata-only legacy snapshot merge.
Must not do:
- No new "force-save / relabel under new epoch" server endpoint.
- No blind replay of local drafts across terminal or lease-takeover fences.
- No raw answer text or student PII in telemetry/logs.
Constraints: small diff, single ownership per file, shared logic lives in the
  engine (no IELTS/SAT duplicate recovery logic), old cached clients keep
  working against the unchanged backend contract.
Required evidence: inverted regression tests for all 6 audit witnesses +
  new fault-injection/integration/E2E coverage; focused + backend suites green.
Done when: all work packages meet acceptance criteria, L4 finds zero
  BLOCKING findings, and the rollout/rollback section is executable as written.
```

## 1. Invariants (reviewers check these explicitly)

- **I1 ordering:** visible state for a question is replaced only by a strictly newer write (higher order; versions allocated only after initialization).
- **I2 durability:** an accepted intent is synchronously checkpointed before any async work can delay or lose it; `destroy()` never discards an accepted intent.
- **I3 no uninitialized issuance:** no command enters the outbox/network with a version or epoch that recovery/snapshot has not seeded.
- **I4 honest status:** only server-acknowledged writes report "saved"; blocked/conflicted/quarantined drafts stay visible with explicit state.
- **I5 archive-before-delete:** quarantine source copies are removed only after the archive record is durable; archive failure keeps the source + raises fault.
- **I6 fences hold:** lease-takeover, terminal, and admission fences are never auto-crossed; timing-only control changes reconcile only via fresh snapshot + fresh version.

## 2. Architecture decisions (locked)

1. **Readiness barrier + intent ledger in the engine (F1/F2).** `acceptResponse` during recovery: update visible state synchronously, checkpoint synchronously (WP2), queue the intent unversioned; version + enqueue only after recovery seeds trackers. Callers (both providers) need no branching.
2. **Checkpoint-first, chain-second (F4).** Sync localStorage intent checkpoint is the teardown-safe path; IndexedDB persistence stays serialized per question but can never delay the checkpoint.
3. **Tombstone quarantine, not delete-then-archive (F5).** Quarantine writes a tombstone into the question's own checkpoint key (single-key atomic write) + an IndexedDB quarantine record; recovery surfaces tombstoned questions as blocked, never sendable.
4. **Explicit reconcile state for control changes (F3).** `EPOCH_STALE` from timing-only transitions → per-question `blockedReconcile` (visible, non-sending). Reconcile = fresh snapshot → seed → re-accept as a NEW writeId/version under the new epoch. Lease/terminal conflicts → existing superseded/terminal UX, no auto-reconcile.
5. **One shared status mapper.** Add `useResponseDurabilityStatus(engine)` used by both IELTS and SAT providers to prevent status-UX drift. No duplicated recovery logic.
6. **Submit gate.** Submission with blocked/quarantined drafts warns and refuses silent exclusion: student resolves or explicitly discards (with confirm + audit event) before submit completes.

## 3. Dependency graph and critical path

```text
WP0 baseline/test-lock ─┬─▶ WP1 readiness/versioning ──▶ WP4 reconcile/UX ──▶ WP5 providers ──▶ WP8 verification
                        ├─▶ WP2 checkpoint-first ────────├─▶ (WP1 needs WP2's sync checkpoint primitive)
                        ├─▶ WP3 tombstone quarantine ───┘         (WP4/WP5 consume blocked+quarantine states)
                        ├─▶ WP6 backend test-lock (parallel, no logic change)
                        └─▶ WP7 observability (parallel; consumes new reason codes)
Critical path: WP0 → WP1+WP2 → WP3 → WP4 → WP5 → WP8.
```

## 4. Ownership (one owner per mutable scope)

| Scope | Owner lane | Files |
|---|---|---|
| Engine core (readiness, versioning, reconcile, tombstone) | Engine | `src/shared/durability/DurableResponseEngine.ts`, `types.ts` |
| Browser storage primitives | Storage | `src/utils/durableDraftStore.ts` |
| Shared status mapper | Engine | new `src/shared/durability/useResponseDurabilityStatus.ts` |
| IELTS integration | IELTS | `src/components/student/providers/StudentAttemptProvider.tsx`, `StudentApp.tsx` |
| SAT integration | SAT | `src/features/student-delivery/hooks/useSatResponsePersistence.ts`, `useSatExamController.ts` |
| Backend test-lock | Backend | `backend/go/internal/attempts/*_test.go` (no prod-logic change) |
| Tests/E2E/load | Verification | `src/shared/durability/__tests__/*`, provider tests, `e2e/*`, `k6/*` |
| Rollout/runbook | Release | `docs/runbooks/*`, telemetry dashboards |

Rule: only the owning lane mutates its scope; integrator resolves contract mismatches.

## 5. Work packages

### WP0 — Baseline lock and witness inversion
Goal: freeze the failing behavior as executable specs before changing logic.
Inputs: audit report + 6 audit witnesses. Outputs: `DurableResponseEngine.preservation.test.ts` + provider preservation test asserting SAFE behavior (new answer+flag survive delayed recovery; no uninitialized versions; epoch bump → blocked-not-lost; slow storage → latest checkpoint present; quarantine archive failure → source retained + fault). Retire the `*.audit.test.ts` unsafe-expectation files at green.
Out of scope: any prod-logic change.
Acceptance: new tests fail on current code for the right reason (each failure message names the invariant violated); existing 21 engine/provider tests still pass.
Verification: `npx vitest run src/shared/durability/__tests__ src/components/student/providers/__tests__/StudentAttemptProvider.v2.test.tsx`.
Blocking: none.

### WP1 — Recovery readiness + version initialization (F1, F2)
Goal: make I1 + I3 structural: versions exist only after seeding; input during recovery is preserved as unversioned intent.
Scope: `DurableResponseEngine.ts` (+ types): `initialized` flag, `startupIntents[]` with monotonic `order` + `receivedAt`, `initializedPromise`; `acceptResponse` fast path (visible update + sync checkpoint + queue-or-version); `recoverInternal` seeds `versionTrackers`/`confirmed` from snapshot FIRST, then drains intents in order allocating `max(server, tracker)+1`; tombstoned quarantines never auto-drain. `flush()` awaits initialization + pending acceptances.
Core pattern:
```ts
acceptResponse(q, p) {
  const visible = clonePayload(p);
  this.setVisiblePending(q, visible);   // synchronous UI truth
  checkpointIntentSync(q, visible);     // WP2 primitive, sync, best-effort
  if (!this.initialized) return this.enqueueStartupIntent(q, visible);
  return this.versionAndEnqueue(q);
}
// recoverInternal: seed versions from snapshot → drain startupIntents in
// order → initialized = true. Never compare a seeded version against an
// unseeded counter; unseeded counters must not exist.
```
Out of scope: storage internals (WP2), quarantine format (WP3), UX copy (WP4/5).
Acceptance: F1/F2 witnesses inverted and green; rapid answer+flag during slow snapshot keeps both; no `clientVersion` issued before snapshot seeding (assert via transport spy); offline-start still queues visibly.
Verification: WP0 tests + `DurableResponseEngine.debounce.test.ts` + provider V2 test.

### WP2 — Synchronous latest-intent checkpoint (F4)
Goal: I2 — teardown-safe durability independent of IndexedDB latency.
Scope: engine + `durableDraftStore.ts`: `checkpointIntentSync()` (localStorage setItem, try/catch, includes `order`+`receivedAt`); async persistence path keeps per-question chain but performs compare-and-set (never overwrites a newer checkpoint on completion); recovery reads intent checkpoints as candidates with recency-tiebreak; `destroy()` only drops callbacks, never accepted intents; lifecycle `flush()` unchanged (best-effort) with status honest about unsent work.
Edge cases: quota/full → IndexedDB attempt → both fail → `durability_fault` + input blocked (existing) with in-memory intent retained + banner; corrupt checkpoint → skip single key, keep others (existing pattern).
Acceptance: stalled-IndexedDB + rapid typing + `destroy()` → checkpoint holds LATEST intent; reload recovers it; no binary-size/perf regression (per-keystroke write stays one small key).
Verification: new fault-injection tests (slow/blocked/quota IDB, missing localStorage) + reload-recovery integration test with fake storage.

### WP3 — Archive-before-delete quarantine (F5)
Goal: I5 — a rejected write is never left memory-only.
Scope: engine `quarantineEntry` + storage: state move is immediate (stop retry, visible blocked); then sync quarantine stub → await IndexedDB archive → tombstone the source checkpoint key in place (same-key write, never delete-first); archive failure → keep source + `durability_fault`; recovery maps tombstones to blocked state (visible, non-sendable) and rehydrates the quarantine list for the recovery view.
Bounded growth: cap e.g. 50 entries/attempt; prune ONLY on (a) server ack of a replacement write, or (b) explicit student discard with confirm + audit event. No silent pruning.
Acceptance: archive-rejected → localStorage source intact + fault raised; refresh → quarantined draft present in recovery view; fenced writes never re-enter outbox on recovery.
Verification: quarantine fault-injection tests + reload test + existing terminal-conflict tests.

### WP4 — Control-epoch reconcile + conflict UX contract (F3)
Goal: I4 + I6 — routine proctor actions never silently drop work; fences stay strict.
Scope: engine states `blockedReconcile` vs `conflict_fenced/conflict_terminal`; `reconcileBlocked(questionId)` (fresh snapshot → writability check → seed epochs/versions → re-accept as NEW writeId/version; server-newer/terminal → stay blocked with conflict UI); submit gate (blocked drafts → warn + require resolve-or-explicit-discard).
UX contract (both providers via WP5 mapper): per-question "needs attention" badge; banner copy states what happened + what is safe ("Your latest answer is kept on this device. Re-checking with the exam…"); status vocabulary fixed: `saving | saved_locally | blocked_attention | conflict | saved | error` — never "saved" for unacked work.
Out of scope: changing what pause/resume/extend do server-side; auto-reconcile across lease change (forbidden).
Acceptance: pause-while-typing E2E → draft visible + blocked, then reconciles and delivers once; takeover → no auto-resend, superseded UI; submit with blocked draft → explicit gate, no silent exclusion.
Verification: engine reconcile tests (fresh-version resend spy asserts new writeId + seeded version + new epoch) + Playwright pause/extend/takeover scenarios.

### WP5 — Provider integration (IELTS + SAT)
Goal: wire WP1–WP4 states into both apps with zero duplicated recovery logic.
Scope: IELTS `StudentAttemptProvider` (engine readiness flag, blocked/quarantine selectors, metadata-only snapshot merge UNCHANGED) + `StudentApp` handlers/banner/recovery panel; SAT `useSatResponsePersistence` (same mapper; serialize engine recreation on epoch props AFTER new engine recovers — sync checkpoints make the window safe) + controller banner wiring.
Preserve: `v2HydratedSnapshotKeyRef` answer/flag exclusions; immediate local echo; drain debounce for network only.
Acceptance: real-provider test (formerly audit witness) asserts answer+flag survive delayed recovery; SAT controller test asserts visible drafts + blocked banner mapping; no provider imports storage internals directly.
Verification: provider tests + SAT hook tests + typecheck/lint.

### WP6 — Backend contract test-lock (no logic change)
Goal: prove the server half of the contract the client now relies on.
Scope: tests only in `backend/go/internal/attempts` (+ runtime epoch-bump tests if gaps): version reuse with different writeId → `VERSION_COLLISION`; lower unused version → `superseded` with canonical current; exact writeId replay → `duplicate` incl. post-terminal replayability; epoch mismatch → fenced/stale. Any missing case is added as a test; prod-logic diffs require a new work package + re-review.
Acceptance: `go test ./internal/attempts ./internal/runtime` green with the four behaviors pinned.
Verification: go test (uncached: `go clean -testcache` for the two packages on the candidate).

### WP7 — Privacy-safe observability + log hygiene
Goal: detect recurrence without ever shipping answer content.
Scope: reason-coded counters only (`intent_queued_during_recovery`, `version_collision`, `control_epoch_blocked`, `reconcile_succeeded/failed`, `quarantine_archived/failed`, `checkpoint_sync_failed`) with attempt/schedule/question hashed-or-omitted per policy; FIX `emitAnswerMutationDebugLog` in `StudentApp.handleAnswerChange` to strip answer values (or dev-only gate) — the one security defect found incidentally.
Acceptance: no answer/PII strings in telemetry📦; dashboard/runbook documents alert thresholds; log test asserts redaction.
Verification: grep test for answer leakage in debug path + telemetry unit tests.

### WP8 — Full verification matrix and quality gate
Goal: prove production-grade across correctness, reliability, security, performance, maintainability.
Layers: unit (engine/storage/mapper) → provider/integration (fake transports, fault injection) → E2E Playwright (reload-during-recovery, pause/extend-while-typing, offline→online, takeover, submit-gate, storage-full) → backend package tests → load (`k6/prod-submit-storm-200.js`, section-transition) watching for single-client collision spikes → static (`tsc --noEmit`, eslint, `git diff --check`).
Gates: focused suites + `go test` green; zero BLOCKING L4 findings; rollout plan executable; audit witnesses retired (no unsafe expectations remain).
Out of scope: full-suite runs unrelated to the change surface (record what was/wasn't run).

### WP9 — Staged rollout, monitoring, rollback
Goal: ship safely given uncacheable mixed client versions.
Plan: no backend migration (contract unchanged) → rollback = redeploy previous client bundle. Stages: internal dogfood → pilot cohort → full; entry/exit criteria per stage (zero confirmed rollback/loss events, no spike in `quarantine_archive_failed`/`durability_fault`/`version_collision` beyond baseline, support-ticket watch for "answer disappeared").
Rollback triggers (any one): confirmed new loss/rollback event; archive-fault spike; submit-gate anomaly. Old cached bundles interoperate (same API); new storage keys namespaced so old readers ignore them. Runbook update: incident triage section from the audit (preserve browser storage keys `response-checkpoint:v2:*`, `v2_attempt_*`, `v2_quarantine:*` before clearing) + new status vocabulary.

## 6. Risks

- R1 regression of happy-path latency (sync checkpoint per keystroke): mitigate — single small key write; measure INP in E2E; no full-state serialization.
- R2 over-correction into auto-replay across fences: mitigate — I6 + tombstone non-sendability + WP4 tests asserting no resend on lease/terminal.
- R3 IELTS/SAT status drift: mitigate — shared mapper (WP5), contract test asserting identical mapping.
- R4 storage-schema skew across cached versions: mitigate — namespaced keys, old clients ignore unknown keys, tombstone = same-key write.
- R5 quarantine growth: mitigate — bounded list + prune-only-on-ack-or-explicit-discard + audit event.
- R6 submit flow change annoyance: mitigate — gate triggers ONLY when blocked drafts exist; copy reviewed for exam stress.
- R7 false "saved" confidence: mitigate — I4 + status-vocabulary test (no `saved` without ack).

## 7. Verification commands (candidate gate)

```sh
npx vitest run src/shared/durability/__tests__ src/components/student/providers/__tests__/StudentAttemptProvider.v2.test.tsx src/features/student-delivery/hooks/__tests__/useSatExamController.identity.test.tsx
npx tsc --noEmit && npx eslint src/shared/durability src/utils/durableDraftStore.ts src/components/student/providers/StudentAttemptProvider.tsx src/features/student-delivery/hooks/useSatResponsePersistence.ts && git diff --check
cd backend/go && go clean -testcache && go test ./internal/attempts ./internal/runtime
npx playwright test e2e/student-durability.spec.ts
k6 run k6/prod-submit-storm-200.js
```

## 8. L4 independent verification plan (against this roadmap)

General checker: trace F1→WP1, F2→WP1+WP4, F3→WP4, F4→WP2, F5→WP3; confirm every acceptance criterion is executable; confirm no backend contract break; confirm audit witnesses retired; re-run §7 on the frozen candidate. Security checker (drawn by R-risk rule, narrow scope): §WP7 redaction + telemetry payload review only.
Finding severity: incorrect behavior / silent-loss path / fence bypass / PII leak = BLOCKING; reliability/maintainability gaps = IMPORTANT; polish = OPTIONAL (non-blocking).
