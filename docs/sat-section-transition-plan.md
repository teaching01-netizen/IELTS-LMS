# SAT Section Transition, Break, and Module-Timeout — Audit & Implementation Plan

Status: **plan, not implemented**
Branch: `feat/sat-bluebook-overlays-tools`
Written: 2026-09-14
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
