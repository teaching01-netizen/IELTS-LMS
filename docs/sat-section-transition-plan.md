# SAT Section Transition, Break, and Module-Timeout — Audit & Implementation Plan

Status: **implemented** — phases 1–5 are on disk. Phase 6 ran the unit suites, the
full frontend suite, and one Playwright e2e (`e2e-05`, chromium) against a fresh
local database; the SAT e2e variant and both k6 scenarios are still outstanding.
Phase 7 is complete as far as it is honest to be — the dead branches are marked
legacy, not deleted. See §10 for the per-phase record, the evidence, and what
remains.
Branch: `feat/sat-bluebook-overlays-tools`
Written: 2026-09-14 (implemented 2026-09-15)
Scope: section transitions, the between-section break, proctor controls, module
time-out, and a student advancing to the next module.

## 0. Evidence discipline (Single-Agent Hallucination Guard)

Every factual claim below is labelled:

- **KNOWN** — read directly from the code at the cited location during this audit.
- **INFERRED** — reasoned from KNOWN facts; the reasoning is stated.
- **UNCERTAIN** — plausible but not verified; listed in §9 rather than asserted.

Line numbers are as of this reading. No Go or TypeScript test suite was executed
for this document (see §9), so **nothing here is a runtime observation**.

The uncommitted working-tree changes (`src/shared/durability/DurableResponseEngine.ts`,
`src/services/studentMutationOutbox.ts`, the coedit files, and their tests) were
left untouched. They are adjacent to the SAT response-save path discussed in
finding F4.

---

## 1. Context

The SAT delivery flow has two independent server-computed clocks per attempt:

| Clock | Owns | Storage |
| --- | --- | --- |
| **Section clock** ("the period") | Section advance, the cohort break, the hard cap on answering | `exam_session_runtime_sections` |
| **Module clock** ("the booklet") | The student's per-module allotment and the Module 1 → Module 2 move | `assessment_module_attempts` |

Both are projected to the client. For `cohort_section_v3` — the live SAT model —
the student's module timer is the smaller of the two, and that minimum is only
taken while the active section matches the section the student is sitting
(**KNOWN**: `useSatExamController.ts:1131`, `domain/satTiming.ts:90`).
`cohort_stage_v2` uses the section clock alone and `legacy_section_v1` the module
clock alone; see F7 on `cohort_stage_v2` being unreachable.

The prior conversation raised four questions about this flow:

1. Does a **section transition** actually work end to end?
2. Does the **proctor** have the controls the runbook implies?
3. Is there a real **break / section advance** window?
4. When a **module's time ends**, does the student reliably go to the next module?

This document answers those, records the findings, fixes the intended behaviour
in plain English, and lays out a phased implementation plan.

---

## 2. How the flow works today (mapped)

### 2.1 Module start

- Server: `StartModule` (`backend/go/internal/delivery/start_submit.go:51`) runs
  `moduleTimingGateTx` (`service.go:1371`), which for cohort models requires the
  module's section to equal `active_section_key`, the section row to be `live`
  and unpaused, and the section clock not to have expired. (**KNOWN**)
- Client: `shouldAutoStartInitialModule` / `shouldAutoStartNextSectionAfterBreak`
  (`satRuntimeSelectors.ts:47,68`) decide automatic starts; everything else waits
  for the student to press Start. (**KNOWN**)

### 2.2 Module time end

- Client: when the displayed remaining seconds reach zero, a one-shot effect calls
  `submitModule` (`useSatExamController.ts:1180`). The dedupe key is consumed, so
  there is no retry. (**KNOWN**)
- Server on submit: for cohort models the personal module deadline is **not**
  consulted — `usesPersonalDeadline()` returns true only for the legacy model
  (`start_submit.go:216`). The submit is admitted when the section is active and
  live. (**KNOWN**)
- Server backstops, if the client never submits:
  - `delivery.ReconcileAttemptTimeout` (`delivery/reconcile.go:65`) — cohort-aware;
    for `cohort_section_v3` it expires on section expiry **or** personal-module
    expiry (`reconcile.go:418-420`), then routes through `finalizeModuleTx`
    (which creates the route decision and the follow-up module). Reached from
    `Bootstrap` (`service.go:286`), `StartModule`, `SubmitModule`, and the
    maintenance sweep `w.delivery.ReconcileTimeouts` (`worker/main.go:843`).
  - `sat.ReconcileModuleTimeouts` (`internal/sat/service.go:445`) — see F8.

### 2.3 Section advance

- Worker hot cycle (`worker/main.go:346`, ~5 s cadence) calls
  `proctor.ReconcileExpiredSections` (`proctor/reconcile.go:44`). The candidate
  query fires at `section start + planned + extension + paused + 30s`
  (`reconcile.go:74`). (**KNOWN**)
- On firing, one transaction: completes the section
  (`reconcile.go:155`, reason `time_expired`), then immediately starts the next
  locked section (`reconcile.go:216`) and points the runtime at it
  (`reconcile.go:222`), then `syncV2` re-projects per-attempt deadlines.
  (**KNOWN**)
- Manual path: `proctor.EndSectionNow` (`proctor/service.go:560`) does the same
  thing but **rejects SAT** (`service.go:570`) and is **rejected in IELTS
  authentic mode**. (**KNOWN**)

### 2.4 The break

- The runtime plan stores an authored gap (`gap_after_minutes`), inserted at
  `runtime/service.go:291` and selected back at `proctor/sessions.go:391`.
- **No code reads it.** A repository-wide search finds `gap_after_minutes` only in
  the `INSERT` at `runtime/service.go:291`, the column lists at
  `proctor/sessions.go:391` / `bootstrap_statement_budget_test.go:75`, and the
  migration at `0005_scheduling_and_access.sql:117`. (**KNOWN**)
- The other candidate break mechanism, per-module `available_at` (set to
  `submit time + breakAfterSeconds` by `nextModuleAvailableAt`,
  `start_submit.go:806`), is gated behind `usesPersonalDeadline()`
  (`start_submit.go:97`), which is false for both cohort models. (**KNOWN**)
- **INFERRED:** therefore the authored break is not enforced anywhere on the
  server. The observed break is the leftover time in the previous section's
  clock, since the next section only goes live when that clock expires. A student
  who finishes early waits; a student who uses their full section time gets
  almost no break.
- Client: the wait is displayed as `pendingSectionWaitSeconds`
  (`useSatExamController.ts:694`), rendered as `SatBreakScreen mode="waiting"`
  (`routes/SatStudentSessionRoute.tsx:267-272`).

### 2.5 Between-section state

- `waiting_for_next_section` exists (`migrations/0005_scheduling_and_access.sql:100`,
  default `FALSE`) and is read by three consumers: the write gate
  `ensureWritable` → 422 "Exam runtime is waiting" (`attempts/service.go:529`),
  the V2 locking gate (`cmd/api/handlers_v2.go:230,246`), and the client's
  `waiting_for_advance` blocked reason (`blockingPolicy.ts:102-105`).
- **Every writer writes `false`**: `runtime/service.go:273,513`,
  `proctor/reconcile.go:172,223`, `proctor/service.go:666,805`. There is no
  assignment to `true` anywhere in the repository. (**KNOWN**)
- **INFERRED:** the flag is inert, so the three consumers above can never fire
  from server state. The client's wait is inferred locally from timing instead.

### 2.6 Write admission (the answering path)

| Path | Deadline rule | Section identity rule |
| --- | --- | --- |
| V2 batch save (`attempts.ensureWritable`, `service.go:515`) | `closing_grace_until`, i.e. section start + planned + ext + paused **+ 30 s**, inclusive (`runtime/service.go:564`, `attempts/service.go:26,532`) | `ensureQuestionAdmitted` → 400 "Question is not in the active section" (`attempts/service.go:550`); module must be `active`/`review` (`:547`) |
| Legacy `SaveResponse` (`delivery/service.go:1604,1620`) | raw section deadline, **no grace**; plus a module deadline | stage identity → `STAGE_SECTION_MISMATCH` |

(**KNOWN**)

### 2.7 Proctor controls

| Control | SAT? | Evidence |
| --- | --- | --- |
| `pause` / `resume` runtime (whole cohort) | yes; pauses/resumes SAT module rows | `runtime/service.go:366,431,593,599` |
| per-attempt pause / resume | yes for `legacy_section_v1` **and** `cohort_section_v3` | `proctor/service.go:953` |
| `warn`, `terminate`, per-student `extend` | yes | `proctor/service.go:383`; `service.go:499` |
| `extend-section` | yes (no SAT rejection) | `proctor/service.go:704` |
| `end-section-now` | **no** — 400 with the message at `service.go:570` | `proctor/service.go:560,570` |
| `complete-exam` | yes; auto-submits remaining attempts | `proctor/service.go:785` |

(**KNOWN**)

---

## 3. Findings

Severity is about exam-day impact. All are KNOWN unless marked otherwise.

### F1 — `waiting_for_next_section` and `is_overrun` are never set to true (High)

Dead state, but three live consumers trust it. Either implement the flag or delete
the plumbing; leaving it invites false confidence in the write gate.

### F2 — Section advance and module closure run on different cadences (High)

`ReconcileExpiredSections` (hot, ~5 s) advances sections but does not finalize the
completed section's open module attempts. That closure rides on the maintenance
cycle (5 minutes). Online students recover in ~2 s because every bootstrap
reconciles first (`delivery/service.go:286`); offline students can be left with an
inconsistent section/module picture for minutes.

### F3 — The personal module clock is enforced inconsistently (Medium)

Under `cohort_section_v3` the client timer and the delivery reconciler bind the
personal clock, while `usesPersonalDeadline()` says the write gate must not
(`start_submit.go:210-216`). Resolution chosen in §4.

### F4 — Two different SAT response-deadline policies (Medium)

The legacy per-response path has no 30-second grace and a different section
identity error than the V2 batch path (§2.6).

### F5 — A section-end auto-submit is expected to fail, and only polling repairs it (Medium)

At section-clock zero the client submits; the server answers conflict while the
section still looks active (`delivery/service.go:1430`). The dedupe key is
consumed, so recovery depends on the poll loop delivering the finalized module.
Offline, the student remains on a 0:00 screen with an error.

### F6 — The system auto-advances SAT sections but the proctor cannot end one (Medium)

`EndSectionNow` rejects SAT (`proctor/service.go:570`) while the worker advances
SAT sections by clock (§2.3). The only SAT incident levers are per-student
controls and `extend-section`.

### F7 — `cohort_stage_v2` and `sat:break:` are unreachable (Low)

No Go writer assigns `cohort_stage_v2` (`schedules/service.go:567-569` uses
`cohort_section_v3` for SAT, otherwise legacy) or a suffixed stage key;
`sat:break:` appears only in frontend code and tests. The corresponding branches
in `delivery/reconcile.go`, `start_submit.go:210-216`, `domain/satTiming.ts` and
`useSatExamController.ts:675-700` are dead and free to drift.

### F8 — A second module finalizer is unsafe (High — discovered during plan revision)

`sat.ReconcileModuleTimeouts` (`internal/sat/service.go:445`) force-closes active
modules on:

```sql
DATE_ADD(ma.available_at, INTERVAL (allocated_seconds + extension_seconds + accumulated_paused_seconds) SECOND) <= now
```

Two defects (**KNOWN**, from reading the function):

1. **Wrong anchor.** Every other consumer anchors the personal clock on
   `started_at`, falling back to `available_at` only before start
   (`moduleDeadline`, `delivery/service.go:853`). This job anchors on
   `available_at`, which for a routed Module 2 is the Module 1 submit time
   (`insertModuleAttemptTx` ← `nextModuleAvailableAt`,
   `start_submit.go:806,819`). A student who dwells on the directions screen is
   closed early by that dwell time.
2. **No successor.** It writes `state='submitted', completion_reason='timeout'`
   directly (`sat/service.go:479`) without the adaptive route decision or the
   follow-up module row that `finalizeModuleTx` creates. It also never checks the
   runtime or the active section, and carries no provider filter.

**INFERRED:** because `delivery.ReconcileTimeouts` runs first in the same
maintenance cycle (`worker/main.go:843` before `:859`) and uses the correct
anchor, the defect is normally masked. It surfaces in the window
`available_at + allocated ≤ now < started_at + allocated`. In that window a
Module 1 can be closed with no Module 2 created — the attempt then has all
modules terminal, which is the client's premature-finalization predicate
(`useSatExamController.ts`, "all modules finalized but no result" recovery), and
the cohort's completion can land after Module 1 only.

**UNCERTAIN:** the exact frequency on exam day was not measured.

---

## 4. Decisions taken (locked)

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | **Implement** `waiting_for_next_section` | The write gate, API projection, and frontend reason already exist; the flag makes the between-section state explicit for both student and proctor. |
| D2 | **Section clock only** is the server-side expiry authority | Matches the intent recorded in `start_submit.go:210-216`. The personal module clock survives as the student-facing allotment only. |
| D3 | **Honor the authored gap** (revising an earlier "drop the gap" answer) | D1 requires a non-zero between-section window; without a gap the flag is set and cleared in one transaction and is never observable. Honoring the gap also makes the SAT break authored rather than accidental. |

---

## 5. Target semantics

**Section state machine (cohort models), per schedule:**

```
live(section N)
  → at deadline(N):            completed(N), active_section_key stays on N,
                               waiting_for_next_section = true
  → at deadline(N) + gap(N→N+1): live(section N+1), flag cleared
```

Gap `0` reproduces today's immediate advance, so this generalises rather than
breaks current behaviour. One sweep may still catch up through several expired
sections.

**Why `active_section_key` stays on the completed section during the gap:**
the write gates then stay closed by the existing "section not live" path
(`v2Locker.Lock` sets `SectionLive` only for `status='live'`, so
`Snapshot.CheckWritable` fails fast). Leaving it NULL would make the snapshot and
V2 gates report `ActiveSectionKey="*"` with `SectionLive=true`, i.e. open the
fast-path gate during the break.

**Expiry authority:** the section clock is the only server-side expirer. The
personal module clock remains the student-facing allotment
(`min(personal, section)`) with no server force-close.

---

## 6. Before / after behaviour in plain English

### Before

- The room has a section clock; each student has a module timer.
- When a module timer ends, the student's own device submits that module and the
  next module opens with a fresh timer.
- When the section clock ends, the section is over for the room and anything open
  is submitted automatically.
- **The authored break does not exist.** Math begins the instant Reading &
  Writing's clock expires, so the break is whatever time the student had left
  over — a student who used 60 of 64 minutes gets 4 minutes, one who raced
  through gets 29.
- During that leftover wait there is no server-side "between sections" state, so
  the previous section's countdown is reused and the proctor dashboard keeps
  showing the room as live on the finished section.
- The configured "waiting for the next section" signal never switches on.
- A rare background job can close a module using the wrong anchor and without
  opening the next module, which can end a student's exam after Module 1 (F8).

### After

- The module timer still drives Module 1 → Module 2 for the student: at zero the
  device submits and the next module opens with a fresh timer. The server admits
  it while the section is live; the module timer stays the student's allotment,
  and the section clock stays the cap.
- When the section clock ends, the section closes for the room and open work is
  submitted automatically.
- **The break becomes real and authored.** The room enters an explicit
  between-sections state for the full configured break, with a countdown to the
  next section's start; nobody can write during it. Both the student screen and
  the proctor dashboard read that same state, so they cannot disagree.
- The next section goes live for the whole room at the same instant, and the
  first module of the new section opens fresh. If the worker was briefly down, it
  catches up in one pass without handing anyone an already-expired section.
- A module is never force-closed on the personal clock by a background job, and
  never closed without its successor: there is one closer, anchored on when the
  module actually started.
- Offline at section end: the server closes the section and the module promptly
  rather than up to five minutes late. Answers that reach the server inside the
  30-second window at the end of a section are accepted; answers still queued on
  the device after that window are refused, as today. This plan does not widen
  that window.
- Proctor: pause/resume the room, warn, per-student pause/extend, extend the
  section, and end the whole exam with everyone auto-submitted — unchanged. New:
  a correct between-sections reading during breaks, and an overrun flag when a
  section has run past its planned end. Whether the proctor can end a SAT section
  early remains a product decision (F6).

---

## 7. Implementation plan

Order is chosen so each phase leaves the system consistent. **No migrations are
required** — every column already exists.

### Phase 1 — reconcile correctness

1.0 **Retire `sat.ReconcileModuleTimeouts`** (`internal/sat/service.go:445`) in
    favour of `delivery.ReconcileAttemptTimeout`. Remove the job from the
    maintenance cycle (`worker/main.go:859`) after confirming the delivery sweep
    covers the same rows. This removes the wrong anchor, the unrouted write, and
    the `timeout` / `time_expired` vocabulary split in one move. If per-attempt
    transactions are too costly at cohort scale, enqueue reconcile requests per
    attempt rather than keeping two finalizers.
    *Tests:* a module with `available_at < started_at` is not closed early; a
    closed module always has a successor row or a route decision when a
    follow-up module exists.

1.1 `lockRuntimeSections` (`proctor/reconcile.go`): select
    `gap_after_minutes` and add it to the `runtimeSection` struct.
1.2 New `backend/go/internal/proctor/reconcile_sections_test.go`. **No test
    currently exercises `ReconcileExpiredSections`** (it is referenced only by
    its definition and the worker), so this path is untested today. Cover:
    multi-section catch-up, the gap window, `waiting_for_next_section`
    set/cleared, and gap `0` equivalence with current behaviour.
1.3 After completing a section, enqueue the completed section's open module
    attempts for reconcile, using the existing outbox pattern
    (`FamilyAutoSubmitScheduleAttempts` is the model), so offline students close
    at section end rather than up to five minutes later.

### Phase 2 — expose the waiting window

2.1 Set `waiting_for_next_section = true` in the gap and clear it on advance
    (`proctor/reconcile.go`); `EndSectionNow` clears it because it advances
    immediately.
2.2 Add `nextSectionStartAt` to the runtime/timing projection
    (`proctor.SessionRuntime` → `delivery.TimingSnapshot` →
    `contracts/assessmentDelivery`). Without it the client's break countdown
    freezes, because the authoritative clock runs only when
    `stageStatus === 'live'` (`useSatExamController.ts:1123` region).
2.3 Client: `pendingSectionWaitSeconds` (`useSatExamController.ts:694`) counts
    down to `nextSectionStartAt` instead of reusing the finished section's clock;
    `waiting_for_advance` now also arrives from the server
    (`blockingPolicy.ts:102`).
    *Tests:* `hooks/__tests__/sat-cohort-clock.test.tsx`; promote the existing
    `attempts/writability_test.go` `runtime-waiting` case to an end-to-end
    assertion.

### Phase 3 — one expiry authority (D2)

3.1 Remove `personalExpired` from `reconcileCohortSectionExpiredTx`
    (`delivery/reconcile.go:418-420`); return `sectionExpired`.
3.2 Comment the client `min(personal, section)` as advisory, and record that
    per-student `extend` still affects answer writes via `closing_grace_until`
    (`proctor/service.go:499`) but no longer affects module closure.
    *Tests:* table test — a module past its personal clock with the section live
    is not finalized; at section expiry it is.

### Phase 4 — client behaviour at section end

4.1 In `useSatExamController`, classify the auto-submit rejection:
    `DEADLINE_EXPIRED` / conflict while the section is closing must drive the
    existing `autoSubmitted` "Time expired — submitting…" surface and let the
    poll deliver the finalized module, instead of a hard error.
    *Tests:* `hooks/__tests__/sat-finalization-recovery.test.tsx`,
    `hooks/__tests__/useSatExamController.convergence.test.tsx`.

### Phase 5 — proctor parity and honesty

5.1 Permit `EndSectionNow` for SAT during the waiting window (base modules
    submitted, no routing decision pending), or keep the 400 and write the
    runbook. Smaller decision now that the gap gives the cohort a natural
    boundary.
5.2 Wire `is_overrun` (`migrations/0005_scheduling_and_access.sql:101`): set when
    a section passes its planned end with no completion and no grant; surface in
    the proctor session projection and dashboard.

### Phase 6 — verification

- `cd backend/go && go test ./internal/proctor/... ./internal/delivery/... ./internal/attempts/... ./internal/sat/...`
- `bun run typecheck && bun run test:run src/features/student-delivery`
- Extend `e2e/e2e-05-proctor-advance-during-flush.spec.ts` into a SAT variant:
  section end while the client is offline, then reconnect; assert no lost answers
  and arrival at the next module.
- `bun run k6:section-transition` (`k6/prod-section-transition-200.js`) plus
  `load-runner/k6/prod-transition-reconciliation-200.js`: assert no
  double-advance, no module left `active` past its section, and that the gap is
  honoured under load.

### Phase 7 — cleanup

Delete or mark legacy the unreachable `cohort_stage_v2` and `sat:break:` branches
(`delivery/reconcile.go`, `start_submit.go:210-216`, `domain/satTiming.ts`,
`useSatExamController.ts:675-700`), with a test asserting no writer emits a
suffixed stage key.

**Order:** 1.0 → 1.1–1.3 → 2 → 3 → 4 → 5 → 6 → 7. Phases 3, 4, and 5.2 are
independent of Phase 1 and can run in parallel.

---

## 8. What is solid today (do not regress)

- Grace alignment is coherent: the V2 write gate ends exactly when the worker
  advances (`deadline + 30 s` on both sides, `runtime/service.go:564` vs
  `proctor/reconcile.go:74`), and the question-level active-section check
  (`attempts/service.go:550`) closes the late-answer hole.
- Pause genuinely freezes both clocks: `pauseSATModules` / `resumeSATModules`
  (`runtime/service.go:593,599`), the cohort-pause sync, and the client's
  `cohortStageRunning` gate.
- Finalization is idempotent and recoverable: singleflight plus stable
  `submissionId = attemptId` replay, plus the drained-at-entry backstop
  (`delivery/reconcile.go`).
- Proctor commands carry `expected_runtime_revision` and
  `expected_active_section_key` fences; lock order is consistently
  attempt → runtime → section.
- Client commits are atomic (data plus at most one phase action per tick) with
  poll-skip dedupe, which is what makes the F2/F5 recovery paths work.

---

## 9. Not verified / open

1. **No test suite was run** for this document; all findings are static readings.
2. **`cohort_stage_v2` may be written by tooling outside this repository** (an
   ops migration or admin console). No writer exists in the Go service.
3. **Which transport the SAT client uses** for responses — the V2 batch path or
   the legacy `SaveResponse` path — was not confirmed. If it is V2, F4 is latent
   rather than live.
4. **F8's exam-day frequency** was not measured; only the reachable window was
   established.
5. **Whether the proctor should be able to end a SAT section early** (F6) is a
   product decision, not a technical one.

---

## 10. Implementation record

Everything below was read back from the working tree after the change. Test
suites were executed (unlike §1–9) — see §10.9.

### 10.1 Phase 1 — reconcile correctness

- **1.0 Retired the second finalizer.** `sat.ReconcileModuleTimeouts` is deleted
  from `internal/sat/service.go`; the `ReconcileSATModules` maintenance job is
  gone from `cmd/worker/main.go`. `delivery.ReconcileAttemptTimeout` is now the
  only module finalizer, so the wrong `available_at` anchor, the unrouted
  `state='submitted'` write, and the `timeout` / `time_expired` vocabulary split
  are all gone with it. (**KNOWN**)
- **1.1 The authored gap is now read.** `lockRuntimeSections` selects
  `gap_after_minutes` into `runtimeSection.gap` (plus `actual_end_at`), and
  `runtimeSection.deadline()` is the single deadline expression the loop uses.
- **1.2 The auto-advance path is tested.** New
  `internal/proctor/reconcile_sections_test.go` (8 cases): between-sections
  window, start-after-gap, gap `0` equivalence, multi-section catch-up, paused
  overrun, auto-submit-disabled overrun, the 30-second closing grace, and the
  between-sections projection. Previously `ReconcileExpiredSections` had no test
  at all.
- **1.3 Finished sections close their modules promptly.** New outbox family
  `FamilySectionAttemptsReconcile` (`section_attempts_reconcile_requested`),
  enqueued in the same transaction as the section completion and drained on the
  worker's hot cycle into `delivery.ReconcileAttemptTimeout`. The worker gained
  an `attemptReconciler` seam for testability; tests live in
  `cmd/worker/sectionreconcile_fanout_test.go`.

### 10.2 Phase 2 — the waiting window

- **2.1** `waiting_for_next_section` is now written `true` when a section
  completes and the gap has not elapsed, and cleared on advance (and on the
  runtime-completion branch). `is_overrun` is cleared in both. The three
  pre-existing consumers therefore become reachable. `EndSectionNow` clears the
  flag because it advances immediately.
- **2.2** `nextSectionStartAt` is projected end to end:
  `proctor.SessionRuntime` → `delivery.TimingSnapshot` →
  `AssessmentTimingSnapshot` and the client's `ExamSessionRuntime`. It is set
  only inside the window and derived from the completed section
  (`actual_end_at + gap_after_minutes`).
- **2.3** The client counts the break down against it. `pendingBreakSeconds`
  and `pendingSectionWaitSeconds` are now mutually exclusive: the section-wait
  countdown is suppressed once the server names the next start, and the break
  countdown drives both the break surface and
  `shouldAutoStartNextSectionAfterBreak`. `mergeAuthoritativeTiming` carries a
  known `nextSectionStartAt` across projections that omit the key, and clears it
  only on an explicit `null`.

### 10.3 Phase 3 — one expiry authority

`personalExpired` is removed from `reconcileCohortSectionExpiredTx`; the branch
returns `sectionExpired` alone. The rationale is recorded at the decision site,
and the client's `min(personal, section)` is commented as the student-facing
allotment. Pinned by `internal/delivery/reconcile_section_clock_test.go`
(4 cases: personal clock exhausted with the section live, section deadline
passed, section completed, section paused).

### 10.4 Phase 4 — client behaviour at section end

A module-submit conflict (409: `DEADLINE_EXPIRED`, `RUNTIME_NOT_LIVE`,
`SECTION_NOT_ACTIVE`, already-finalized) is classified as *awaiting server
finalization* instead of a failure: the student is told the exam is finalizing
the module and that their answers are safe, and the recovery poll — always
running — routes them on. The timeout attribution is deliberately **not** set
from here, so a manual submit that merely raced the reconciler is never
mislabeled as a timeout (the zero-remaining path sets it itself). The
pre-existing refresh path still resolves the common case directly.

### 10.5 Phase 5 — proctor parity and honesty

- **5.1** `EndSectionNow` now accepts SAT **inside the waiting window** only:
  the section is already complete and its open modules are with delivery, so the
  call shortens the authored break rather than cutting a live section short (the
  completed section's recorded `actual_end_at` is preserved, because the gap
  arithmetic depends on it). A live SAT section still returns the original 400.
  This is the narrower reading of the product decision: "end the break now", not
  "end a section early".
- **5.2** `is_overrun` is written: the reconciler sets it when a live section is
  past the closing grace and it declines to advance (paused, or auto-submit
  disabled for the schedule), and clears it on completion and on advance. A
  third candidate-scan branch selects those rows, so the schedule is reached
  even when auto-submit is off and nothing would otherwise sweep it. Note the
  projection already *computed* an equivalent signal from the live section clock
  (`computedSectionTime.overrun`); what was missing was any server-side record,
  and the reconciler is now the writer for the cases the clock cannot advance
  past.

### 10.6 Phase 7 — cleanup (marks, not deletions — see §10.11)

The dead `sat:break:` reads are gone: `breakRemainingSeconds` is now
legacy-model only, and the controller no longer branches on a suffixed stage
key. The `cohort_stage_v2` branches are **marked legacy, not deleted** — no
in-repo writer assigns that model, but an out-of-repo writer cannot be excluded,
and removing the client branches would touch several hot paths for no runtime
benefit.

### 10.7 RuntimeRevision accounting

`RuntimeRevision` in `AutoAdvanceOutcome` and the inline wakeup revisions count
actual `exam_session_runtimes` revision bumps, where the previous code counted
section completions. With gap `0` the two are identical (one bump per advance),
which is what makes the gap-`0` equivalence test meaningful. The worker only
logs this value today.

The count is now *returned by the executor* (`applyAdvancePlan`) instead of
being predicted by a second `advancePlan.runtimeWriteCount()` method that had to
stay in sync with it by hand. The predicting copy is deleted, along with the two
test assertions that pinned it.

### 10.8 Residual risks accepted

- A stalled client can hold one module for the rest of its section (the direct
  consequence of D2). The section clock bounds it.
- The 5-minute maintenance sweep remains as a backstop for attempts the section
  family does not cover (e.g. a module row created after its section ended).
- The legacy per-response path still has no 30-second grace (**F4**, unchanged);
  the unified deadline helper from the draft plan was not part of the locked
  plan and was not implemented.
- Proctor "end a live SAT section early" remains unavailable (F6).

### 10.9 Verification actually run

- `cd backend/go && go build ./...` — clean.
- `go test ./internal/proctor/... ./internal/delivery/... ./internal/sat/... ./internal/outbox/... ./cmd/worker/...` — all pass.
- `go test ./...` — two **pre-existing, unrelated** failures in this
  environment: `cmd/migrate` pins 61 migration files while the tree has 62, and
  `internal/platform/config` fails because this shell exports `PORT=0`
  (`env -u PORT go test ./internal/platform/config/...` passes). Neither file
  was touched by this work.
- `bun run typecheck` — clean.
- `bun run test:run` — 593 files / 4253 tests pass.
- **Not run:** the Playwright e2e variant of
  `e2e-05-proctor-advance-during-flush.spec.ts` and both k6 transition
  scenarios from §7 Phase 6.

### 10.10 Post-audit hardening (four-dimension review)

An adversarial review of the work above found four things worth closing. All
four are now done; nothing in §10.1–10.9 was reverted except the two pieces of
unrequested churn the review named.

**Owner-per-state.** The between-sections window now has exactly one writer
(`exam_session_runtimes.waiting_for_next_section`) and every reader reads that
flag rather than re-deriving the window:

- `StudentSessionSummary` no longer forces the flag to `false` for SAT — only
  *legacy* SAT (`isSAT && !cohortTimedSAT`) suppresses it, matching its
  neighbouring guards. This was the reason the proctor dashboard read a breaking
  room as running. Pinned by `session_projection_test.go` (cohort SAT reports
  waiting + the section clock; legacy SAT keeps its module clock).
- The V2 **snapshot** write gate now carries the flag: `runtime.Snapshot` gained
  `WaitingForNextSection`, `LoadSnapshot` reads the column, `CheckWritable`
  refuses with the explicit waiting message, and `snapshotRuntimeGate` maps it
  onto `attempts.RuntimeGate`. Before this, only the legacy `FOR UPDATE` locker
  saw the flag, so the V2 batch transport — the live one — never reached the
  "Exam runtime is waiting." 422. Pinned by `snapshot_load_test.go`,
  `v2locker_snapshot_test.go`, and `TestEnsureWritableBetweenSections`.
- The client no longer infers the window from `nextSectionStartAt` presence: the
  flag gates it and `nextSectionStartAt` is only its countdown instant, carried
  together through `mergeAuthoritativeTiming`.

**Structure.** The cohort section state machine is now a pure function
(`planSectionAdvance`) over locked rows, applied by `applyAdvancePlan`; the
reconciler is a thin loader. The rule table is testable without a database
(`reconcile_plan_test.go`).

**Churn removed.** The `ReconcileSATModules`/`ReconcileSectionAttempts` job-list
renaming is gone (the section fan-out rides `DrainOutbox` and
executes in the hot cycle's `ReconcileExpiredSections`), and the separate
`attemptReconciler` field/setter/resolver collapsed into one `deliveryService`
interface on the existing `delivery` field.

**Verification gap closed.** `go test ./...` now fails only the pre-existing
`cmd/migrate` pin (61 vs 62 files; no migration was added).
`bun run typecheck` clean. (Final closing-pass counts in §10.11, which also
records the e2e-05 run.)

### 10.11 Closing pass (second four-dimension review)

Everything the second review named, addressed. Nothing was reverted.

**One owner for "advance a cohort section".** `EndSectionNow` had grown its own
inline advance (`proctor/service.go`): it used `UTC_TIMESTAMP(6)` instead of
`section end + gap`, skipped the module handover, and omitted the
`SECTION_WAIT`/`SECTION_START` audit payload — so the same transition persisted
different state depending on who triggered it. It now builds the same
`sectionAdvance` the reconciler does and calls the same `applySectionAdvance`.
The F2 symptom this fixes (a proctor-ended section leaving its modules `active`
until the 5-minute sweep) is pinned by
`proctor/endnow_section_test.go::TestEndSectionNowLiveSectionEnqueuesModuleHandover`,
and the between-sections case by `...AdvancesWithoutRewriting`.

**§5.1's precondition is now enforced, not assumed.** The plan permitted
short-cutting the SAT break only with "base modules submitted, no routing
decision pending". `EndSectionNow` now counts the finished section's
non-terminal module attempts (`openSectionModuleAttempts`) and returns a 409
while any remain, so the successor cannot open in front of an unfinished
adaptive routing decision.
`TestEndSectionNowRefusesWhileModulesAreStillFinalizing` pins the refusal.

**One owner for the timing-model names.** `internal/runtime/timingmodel.go`
now holds the three model strings, `IsCohortTimed` and `CohortTimingModelsSQL`; `src/types/domain.ts` holds `TimingModel`,
`isCohortTimingModel` and `isSectionKeyedCohortModel`. The inline spellings are
replaced at every predicate site on both sides — including
`delivery/start_submit.go`'s hand-written SQL `IN` list, which now interpolates
the constant. This is what removes the drift the review found (one client site
tested only `cohort_section_v3` where its neighbour tested both; that was
*intentional* — a stage key comparison — and is now named
`isSectionKeyedCohortModel` instead of being an unexplained literal).

**`reconcile.go` split.** The locked reads, the handover enqueue and the id
helpers moved to `proctor/section_reconcile_store.go`; `reconcile.go` keeps the
pure planner and the executors. 792 → 656 lines, with the SQL no longer
interleaved with the state machine.

**Test scaffolding deduplicated.** `newMockService(t)` (in `complete_test.go`)
is the one sqlmock + capturing-outbox constructor; the shared lock regexes
(`sectionsLock`, `setTimeZone`, the new `commandRuntimeLock`) live in one place
and `endnow_section_test.go` uses them instead of re-spelling five query
strings.

**New coverage:** route-level `SatStudentSessionRoute.between-sections.test.tsx`
(the authored break reaches the screen in `break` mode with its own countdown,
and the early-finish wait does not), and `StudentCard.test.tsx` (the
`runtimeWaiting` flag reaches the proctor's card). The card's bare `waiting`
label became a styled "on break" chip with a title, since it sits next to the
`runtimeSection ?? 'Waiting'` fallback and the two read alike.

**Phase 7:** complete as far as it honestly can be — `cohort_stage_v2` and the
`sat:break:` stage key are *marked* legacy with the reason at the decision site,
not deleted; an out-of-repo writer for either cannot be excluded from here.

**Verification, closing pass.** `go build ./...` and `go vet ./internal/... ./cmd/...`
clean; `env -u PORT go test ./...` fails **only** `cmd/migrate`'s pre-existing
migration-lineage pin (61 pinned vs 62 on disk — no migration was added).
`bun run typecheck` clean. Full `bun run test:run`: **595 files / 4257 tests, all
passing**, including the two preview suites that had been timing out under load;
the four additions are the route-level between-sections pair and the StudentCard
pair. `gofmt -l` reports one file, `internal/delivery/sat_v2_scoring_test.go`,
which this work never touched.

**Playwright e2e — now run and passing (chromium).**
`e2e-05-proctor-advance-during-flush.spec.ts` passed in 49.4s against a fresh
local database. This is the real stack: the suite's `webServer` block booted
`cmd/api`, `cmd/worker` and Vite, the seed built the schedule, and the journey
ran end to end — student check-in, live answers, proctor
`POST /sessions/{id}/control/end-section-now`, a mutation held before server
ingress, then released. The released mutation was rejected after submit
(409 `CONTROL_EPOCH_STALE`, the value crossing the control boundary) and the
post-submit value was confirmed retained in the durable recovery queue. The
worker's hot cycle in the same run published 5 outbox events including the
section fan-out, so the new handover path executed under load.

Two environment facts had to be resolved first, neither a code defect:
`ielts_go_fresh` cannot be re-seeded (`cmd/e2e_seed` deletes from
`attempt_terminalizations`, which migration `0056` makes immutable — 98 rows
were already there), and a brand-new database has to be migrated before
Playwright starts, because Playwright boots `webServer` *before* `globalSetup`
and the API's schema guard rejects an unmigrated schema. The run therefore used
a purpose-made `ielts_e2e_fresh`: created, migrated through `0062`, seeded.
Also note this shell exports `PORT=0`, which the API rejects; the run needs
`env -u PORT`.

**Still not run — two things.**

1. The SAT *variant* of the e2e (Phase 6's "extend
e2e-05-proctor-advance-during-flush.spec.ts into a SAT variant"), and the spec
across the other six browser projects. Only `e2e-05` on chromium was run.
2. Both k6 transition scenarios (`prod-section-transition-200`,
`prod-transition-reconciliation-200`). Their own README warns they "mutate real
schedule/runtime state" and need a dedicated schedule; `k6` is installed at
`/opt/homebrew/bin/k6` and could be pointed at the same `ielts_e2e_fresh`, but
they were out of the agreed scope for this pass. **Decision, not a blocker** —
the remaining risk is the no-double-advance and no-module-left-active invariants
under 200-way concurrency, which no unit test covers.

### 10.12 Closing pass (third four-dimension review) — proctor parity, revision ownership, phase 6 dropped

A third review found that §10.11 closed the *shape* of the proctor path but left
two things untrue or unfinished. Both are now settled, and Phase 6 was dropped
by decision.

**No caller predicts a runtime revision any more.** §10.11 unified the
*effects* but left the *revision* hand-counted: `EndSectionNow` passed
`reconcileRuntime{id: runtimeID}, adv, revision+1` — the predicted-counter
pattern the review had already deleted on the reconciler side, plus a
zero-valued `reconcileRuntime` that would silently have read `revision == 0` if
anything inside ever looked at it. The revision is now an **output**:
`currentRuntimeRevision(ctx, q, runtimeID)` reads the locked row, and every
enqueue that names a revision (the module handover, the runtime wakeup, the
runtime-end auto-submit) reads it there, after its own write. `applySectionAdvance`
no longer takes a runtime struct or a revision and returns only an error;
`applyAdvancePlan` reports `bool` ("did this move the runtime") and
`reconcileExpiredSchedule` re-reads only when it did.

Pinned by `TestEndSectionNowBetweenSectionsAdvancesWithoutRewriting`, which
mocks the row read as **42** — deliberately not the `7 + 1` the command used to
predict — and asserts the `runtime_changed` wakeup carries 42. The
`captureOutbox` fake now records revisions (`revisionFor(family)`) so this is
assertable at all.

**Whether `assessment_module_attempts` exists for SAT — answered from code.**
§10.11's handover and §5.1's precondition both act on rows in that table, and a
full IELTS student journey in `ielts_e2e_fresh` left it empty (0 rows there and
0 in `ielts_prod_clone`). The reason is structural, not a defect:
`delivery.Bootstrap` rejects any provider that is not `sat`/`act` and only then
calls `ensureBaseModuleAttempt`, so module attempts are created on the SAT/ACT
path alone. The IELTS schedule shapes that were reachable from here can never
populate it, which is exactly why the handover and the gate looked unreachable.
They are reachable on SAT; neither is dead code. What is still **unproven
empirically** is the handover's effect on SAT rows end to end — see below.

**A real bug the gap-honouring reconciler exposed.** `runtimePlan` derived every
section's break with `ceilMinutes`, which floors at 1 minute. A section authored
with **no** break (`break_after_seconds = 0`, the SAT Math default) therefore
persisted `gap_after_minutes = 1`, and once the reconciler started honouring the
authored gap the cohort sat in the between-sections window for an unearned
minute. `ceilGapMinutes` was split out: zero is meaningful for a gap ("advance
immediately") and must not inherit the duration floor. Pinned in
`internal/schedules/runtime_plan_act_test.go`.

**The two remaining model literals, client-side.** `satTiming.timingForAttempt`,
`satTiming.breakRemainingSeconds` and `useSatExamController`'s student-facing
`remainingSeconds` were still spelling `cohort_stage_v2` / `cohort_section_v3`
inline. They now discriminate through `isCohortTimingModel` /
`isSectionKeyedCohortModel`. Their branches genuinely differ per model (a
section-keyed model publishes the section's deadline, so the module clock is
clamped to it; a stage-keyed one already publishes the module's own), which is
why the pair exists and why the branch is now named instead of literal.

**Phase 6's browser half was dropped, and its artifacts removed.** A SAT
section-transition spec and the SAT fixture for `cmd/e2e_seed` were written, and
the spec was exercised but never got to a pass inside the budget: it first
timed out at 600s against the real stack, then the seeded clocks were shortened
and it was still being debugged when the request changed to skip e2e.

Both are reverted rather than shipped. `playwright.config.ts` resolves
`testMatch: "**/*.spec.ts"` under `testDir: ./e2e`, and CI runs
`bunx playwright test`, so an unrun spec is picked up automatically and a
never-passing one would fail the e2e job. The `e2e_seed` fixture had no
remaining consumer and would have added a SAT schedule to every seeded database
for every other spec. `e2e-05-proctor-advance-during-flush.spec.ts` (chromium,
passing, §10.11) is unchanged and remains the suite's coverage of this
behaviour. Phase 6 therefore stands as: legacy e2e green, SAT e2e **not
written**, k6 **not run**.

**Verification, this pass.**

- `go build ./...` clean; `gofmt -l` clean on everything touched here.
- `env -u PORT go test ./...` fails **only** `cmd/migrate`'s pre-existing
  lineage pin (61 pinned vs 62 on disk — no migration was added).
- `bun run typecheck` clean.
- `bun run test:run`: **595 files / 4257 tests**, 4256 passing. The one failure
  is `src/features/exam-authoring/api/__tests__/authoringShellLifecycle.test.tsx`
  `FT-04b` (`409` classified as `"unknown"`), in a feature this work never
  touches. It is **pre-existing**: it fails identically when the whole tree is
extracted from `git archive HEAD` and run against the same `node_modules`, with
  none of this work present. It reproduces in isolation, so it is not suite-load
  flakiness either. §10.11 recorded the suite fully green, so something in the
  environment changed between the two passes; the test is unrelated to this
  change either way.
- `cmd/worker/sectionreconcile_fanout_test.go` now pins the section fan-out's
  contract directly: attempts reconcile independently (one transient failure
  does not stop the cohort), the event retries only when nothing progressed,
  an empty fan-out and a missing delivery surface are no-ops, a missing schedule
  id falls back to the aggregate id and fails without one, and a malformed
  payload fails loudly rather than acking away a cohort's module finalization.

### 10.13 Single-owner pass — one completion writer, one vocabulary, one test scaffold

The third review's DESIGN findings, closed. Net −46 lines.

**The completion finalizer has one owner.** `runtime.Complete` and the proctor
`CompleteExam` each carried byte-identical `doneRt`/`doneSec`/`doneSched`
UPDATE strings — three statements whose drift no test would have caught, since
each side's tests only saw its own copy. The three now live once, in
`runtime.CompleteInTx(ctx, q, scheduleID, runtimeID, completionReason)`, called
by both paths (the proctor passes the fixed `terminalization.ReasonProctorComplete`
vocabulary; `complete_test.go` now pins that exact value as the section-update
argument rather than a wildcard).

**The control-event writer and the V2 clock re-projection have one owner each.**
`insertControlEvent` was duplicated verbatim across both packages, and the
proctor's `syncV2` was a byte-identical copy of `runtime.SyncV2TimingInTx` (with
a private `strval` helper that existed only to serve it — deleted with it).
Both proctor call sites go through the runtime package now; the export wrapper
keeps the runtime package's internal callers unchanged. The same pass caught
the SAT module-extension UPDATE (`extSAT` vs `extendSATModules`), also
byte-identical — now `runtime.ExtendSATModulesInTx`, one owner.

**The timing-model vocabulary has no second spelling.** The "only place the
strings are allowed to live" comment on `timingmodel.go` was aspirational:
`delivery/service.go` (×6), `delivery/reconcile.go` (×2), the proctor
pause/resume SQL IN-lists, the `sessions.go` pre-start *writer* (the most
dangerous site — a typo there writes a model no reader recognizes), and the
`COALESCE(timing_model, …)` defaults in `runtime` all spelled strings. Every
production site now goes through the constants, plus the SQL interpolation
constants: the pause/resume IN-list (`legacy, cohort_section_v3` — the models
with a personal pausable module clock) is now `PersonalClockModelsSQL`, named by
`IsPersonalClockTimed` alongside its Go predicate. `outbox.SkipEnqueue`'s
last literal (`"attempt_changed"`) became `FamilyAttemptChanged` (no in-repo
emitter; the Rust side publishes it), so the entire event-family vocabulary is
constant too.

**The reconciler test scaffold collapsed onto the shared builder.** The four
manual `sqlmock.New()` + `NewService` + `captureOutbox` setups in
`reconcile_sections_test.go` are `newMockService(t)` one-liners now; the file
keeps only what it uniquely tests — the section seeds, lock regexes, and
expectation sequences. (The other seven proctor test files predate this pass
and keep their own setups; consolidating them is mechanical but out of scope
here.)

**Verification, this pass.**

- `go build ./...` clean; `go vet ./...` clean; `gofmt -l` clean on every
  touched file (the one flagged file, `delivery/sat_v2_scoring_test.go`, is
  pre-existing and untouched).
- `env -u PORT go test -race -count=1` green on all seven touched packages;
  the full suite fails only the pre-existing `cmd/migrate` lineage pin
  (unchanged baseline: no migration added).
- `bun run typecheck` clean. The vitest suite ran fully green (595 files /
  4257 tests) at the commit this pass started from, and no TS file changed
  since; it was not re-run for a Go-only diff.
- Zero production timing-model literals remain outside `timingmodel.go`
  (grep-verified), and no `syncV2`/`insertControlEvent` remnants survive in
  the proctor package.
