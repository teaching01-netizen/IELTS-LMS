# SAT Module 2 Auto-Advance — Audit & ATDD Implementation Plan

Status: **implemented** — the client fix, its tests, and the server-side
assumption checks are on disk. §17 is the implementation record: what shipped,
the evidence, and what was deliberately not done.
Branch: `feat/sat-bluebook-overlays-tools`
Written: 2026-09-19
Scope: the student's Module 1 → Module 2 move inside one SAT section (the adaptive
lower/higher branch module), and the Module 2 → next section move that follows it.

Reported symptom (user): *"module 2 of that section e.g. math or verbal does not
start automatically; it should — if the time runs out of that module it should go
to the next module (module 1 → 2, hard or easy depending on question correct), and
after module 2 finishes it should go to the next subject."*

## 0. Evidence discipline

Every factual claim is labelled **KNOWN** (read directly from the code at the cited
location during this audit), **INFERRED** (reasoned from KNOWN facts, reasoning
stated), or **UNCERTAIN** (plausible, listed in §15 rather than asserted). Line
numbers are as of this reading. No test suite was executed for this document, so
**nothing here is a runtime observation** — every KNOWN claim is a static read.

The 2026-09-14 `docs/sat-section-transition-plan.md` in this repo describes the
section/break/module-timeout machinery as implemented. This document builds on
that work and does **not** contradict it; §2 records where the two overlap.

---

## 1. Goal

Make the tested student journey below true end to end:

```text
Section N, Module 1          Section N, Module 2 (lower|higher branch)
   timer hits 0:00   ──────►   opens by itself, fresh timer starts
   (auto-submit)               (no click required)

Section N, Module 2          Section N+1, Module 1
   timer hits 0:00   ──────►   authored break / between-sections wait,
   (auto-submit)               then opens by itself
```

Locked behaviour (user decision, 2026-09-19): the automatic Module 1 → Module 2
advance happens **only when Module 1's time ran out**. A student who submits
Module 1 early still gets the Module 2 directions screen — but with a Start button
that works (see F2).

**Out of scope**

- Server-side timing policy (section clock, module clock, break/gap): unchanged.
- The adaptive routing *decision* (`minimumCorrectForHigher` → lower/higher).
  This plan consumes the decision; it does not change how it is computed.
- The proctor console, the IELTS/ACT paths, and the authoring preview harness
  (`src/features/student-delivery/routes/SatPreviewRoute.tsx` drives
  `useSatPreviewController`, a separate authoring preview with manual navigation —
  it is not the delivery runner). **VERIFY only.**
- The legacy `legacy_section_v1` timing model's own entry rules (unreachable for
  live SAT; see §11).

---

## 2. Current-system understanding

### 2.1 The section/module data model

Two independent server clocks exist (from `docs/sat-section-transition-plan.md` §1,
unchanged):

- **Section clock** — `exam_session_runtimes` / `exam_session_runtime_sections`:
  section liveness, the cohort break, the hard cap.
- **Module clock** — `assessment_module_attempts`: `allocated_seconds`,
  `started_at`, `deadline_at` (derived), `completion_reason`.

For the live model `cohort_section_v3`, the student-facing countdown is
`min(personal module clock, section clock)` and the stage key is the plain section
key (`reading-writing` | `math`). **KNOWN** — `application/satTimingPolicy.ts`
(`satCountdown`, `satExpectedStageKey`), `backend/go/internal/delivery/service.go:1513`
(`moduleTimingGateTx`, cohort-section branch uses `sectionKey` directly).

### 2.2 Module 1 → Module 2 on the server

1. The student's Module 1 timer reaches zero and the client calls
   `submitModule`. **KNOWN** — `hooks/useSatExamController.ts` expiry effect,
   `void submitModule(stateModule.id)`.
2. `delivery.SubmitModule` (`backend/go/internal/delivery/start_submit.go:146`)
   runs `moduleTimingGateTx` (section live, not paused, section clock not expired,
   stage matches — for a section-keyed model the branch module's stage is its
   section, so a branch module passes this gate identically to the base module),
   then calls `finalizeModuleTx(..., "student_submit")`
   (`start_submit.go:438`, called at `:199`).
3. For a base module, `finalizeModuleTx` → `nextModuleTx` (`start_submit.go:678`)
   scores the module, applies the routing policy, writes
   `assessment_route_decisions`, and returns the selected module — the **lower or
   higher branch module**. **KNOWN.**
4. `insertModuleAttemptTx` (`start_submit.go:847`) inserts that branch module as a
   `not_started` `assessment_module_attempts` row, with
   `available_at = now` for a same-section follow-up (`nextModuleAvailableAt`,
   `start_submit.go:834`). **KNOWN.**
5. `assembleBootstrap` re-reads everything and returns the branch module in the
   payload. **KNOWN.**

So after the submit, the payload contains: Module 1 `submitted` + Module 2
`not_started` with `adaptiveRole = 'lower_branch' | 'higher_branch'`
(`contracts/assessmentDelivery.ts:19`, `exam-authoring/contracts/assessment.ts:262`).

**INFERRED:** the server therefore needs no change for Module 2 to be openable —
the row exists, the gate admits it, and the branch role is delivered. The gap is
entirely in the client's entry policy.

### 2.3 The client's entry policy (single owner)

One pure decision owns "may the student enter a module now", read by both the
automatic path and the manual button:

- `application/satEntry.ts` → `deriveSatEntryDecision`, `satEntryBlockedReason`,
  `canEnterModule`. **KNOWN.**
- `hooks/useSatModuleEntry.ts` drives it: single-flight per `attemptId:moduleId`,
  a 2 s retry window (`SAT_ENTRY_RETRY_WINDOW_MS`, `satEntry.ts:152`), and
  `surface.recoverable` — true only once an automatic attempt has settled
  **without opening** the module. **KNOWN.**
- `hooks/useSatExamController.ts` calls it once
  (`entryDecision = deriveSatEntryDecision({...})`) and feeds
  `useSatModuleEntry({ enabled: entryDecision.shouldStart, ... })`. **KNOWN.**
- `routes/SatStudentSessionRoute.tsx` passes `entryRecoverable` into
  `SatDirectionsScreen`.

### 2.4 The routing hand-off after a submit

`application/satCommitRouting.ts` → `decideSatCommitRoute`, hint
`{ kind: "submitModule", moduleId }`:

```text
next module missing                       → { type: "submit" }        (finalize the attempt)
next module in a DIFFERENT section        → { type: "startBreak", ... }
next module in the SAME section           → { type: "showDirections" }
```

**KNOWN.** For Module 1 → Module 2 the last branch fires, so the runner lands on
`phase: 'directions'` with `pendingModule` = the branch module. That is correct and
stays unchanged.

---

## 3. Findings

### F1 — Module 2 is never auto-started: the entry policy refuses every branch role — High (root cause)

`application/satEntry.ts`, inside `deriveSatEntryDecision`:

```ts
if (module.adaptiveRole !== "base") return { shouldStart: false, reason: "not-base-module" };
```

**KNOWN.** Both the lower and the higher branch module have a non-`base` role
(`exam-authoring/contracts/assessment.ts:269`), so `shouldStart` is false for
Module 2 in every phase, and `useSatModuleEntry` never attempts the start. Module 2
therefore requires a manual click — which is exactly the reported symptom, and see
F2 for why the manual click is not available either.

### F2 — The manual Start button is a dead end for Module 2 — High (blocker)

`ui/transitions/SatDirectionsScreen.tsx:42`:

```ts
const canStart = moduleEnterable && Boolean(props.entryRecoverable);
```

`entryRecoverable` is `useSatModuleEntry`'s `recoverable`, which is only ever set
**by a settled automatic attempt** (`hooks/useSatModuleEntry.ts`). For a branch
module no automatic attempt ever runs (F1), so `recoverable` stays `false`
permanently and the button stays `disabled`. **KNOWN.**

The same screen then renders the opposite of the truth:
`autoEntryHandling = moduleEnterable && !props.entryRecoverable` →
`showStarting` → `SAT_COPY.directions.autoEntryNotice` =
*"Your module opens automatically. If it does not, this button becomes available."*
(`domain/satCopy.ts:131-132`). **KNOWN.** It never opens, and the button never
becomes available.

**INFERRED:** for a student who does not navigate away, the only way off that screen
is the section clock expiring — the section reconciler then finalizes the
`not_started` Module 2 row and advances. Net effect: the student silently loses the
whole of Module 2 (the timer for it never starts) and their score is computed from
an unanswered module. This is the most severe consequence of this bug and it is
why F2 is a blocker, not a cosmetic issue.

### F3 — The timeout/non-timeout distinction does not exist in the entry policy — Medium

The entry decision's inputs (`SatEntryDecisionInput`) are: `data`, `module`,
`sectionDisplayOrder`, `stageReady`, `breakSeconds`, `sectionWaitSeconds`, `phase`.
Nothing tells it *how the previous module ended*. **KNOWN.** Per §1 the fix needs
that signal for branch modules.

Where the signal exists today:

- locally: `useSatExamController` sets `autoSubmitted` in the zero-remaining effect
  before calling `submitModule`; this survives only for the live session and is
  used for student-facing copy. **KNOWN.**
- in the payload: the finished module's own `deadlineAt` and `remainingSeconds`
  (`computeModuleTiming`, `service.go:991`) — for a module closed by its own clock,
  `deadlineAt <= serverNow`. **KNOWN** (arithmetic: `remaining = deadline - now`,
  clamped at 0).
- **not** in `completion_reason`: the client's own expiry submit goes through
  `SubmitModule`, which always records `"student_submit"` (`start_submit.go:199`),
  and only the server reconciler writes `"time_expired"`. **KNOWN.** So
  `completionReason` alone cannot express "the student's module clock ran out".

### F4 — Module 2 → next section is implemented but unproven, and one predicate is load-bearing — Medium

For a branch module the submit route compares sections
(`satCommitRouting.ts`, `submitModule` case) and emits `startBreak` when the next
module is the next section's base module; the base module of a later section is
then auto-started by the existing `next-section-entry` rule once the break and the
section wait are both zero. **KNOWN** for the code path, **verified only by
reading** — the existing auto-entry tests
(`hooks/__tests__/useSatExamController.autoEntry.test.tsx`) cover "first module"
and "next section's base module after the break", and there is **no test that walks
Module 1 → Module 2 → next section as a sequence**. **KNOWN.**

The load-bearing predicate in that window is the terminal-finalization effect in
`useSatExamController.ts`: it finalizes the attempt when the payload has no pending
attempt and **all** module attempts are final. If Module 2 were ever the only row
while the Math base row did not exist yet, the attempt would be finalized
prematurely. Today `ensureBaseModuleAttempt` seeds exactly one row
(`service.go:653`, "seeds the first base module attempt when the attempt has none
yet") and `insertModuleAttemptTx` creates the successor inside the same
transaction as the module finalization, so the predicate is safe. **INFERRED from
KNOWN** — and it is exactly the invariant AT-09 below must pin.

### F5 — No server test starts a branch module — Low (coverage gap)

`grep lower_branch|higher_branch backend/go/**/*_test.go` finds branch roles only
in scoring/topology/section-scope fixtures; no test drives `StartModule` for a
branch module under a live section. **KNOWN.**

---

## 4. Behavioural contract (after the change)

Invariants:

- **I1** The server remains the authority. No new endpoint, no new column, no
  migration; the client never opens a module the server would reject.
- **I2** The module a student lands in is always the row the server created after
  the routing decision (never a re-derivation on the client).
- **I3** At most one start request per `(attempt, module)`; a duplicate is a
  no-op or a server conflict, never a second module row.
- **I4** The adaptive branch is chosen by the server's existing policy
  (`minimumCorrectForHigher`); the client only enters whatever it was handed.
- **I5** A module that is not enterable for a reason that will never resolve must
  always leave the student a working manual path (no dead ends).
- **I6** Nothing about an *early* manual submit changes: the student reads the
  Module 2 directions and presses Start.
- **I7** The section clock remains the cap: a student who idles on the Module 2
  screen still loses the section, never the exam.

---

## 5. Acceptance scenarios (ATDD)

| ID | Scenario | Preconditions | Action | Expected result | Layer |
| --- | --- | --- | --- | --- | --- |
| AT-01 | Module 1 timeout auto-starts Module 2 (lower) | cohort_section_v3, section live, Module 1 `active` with `deadlineAt` reached, policy routes `lower` | Module 1's clock reaches 0:00 | Module 1 submits; a `startModule` call for the lower-branch module is issued **with no student action**; runner reaches `phase: 'module'`; the Module 2 timer is running from a fresh allotment | Hook + pure |
| AT-02 | Module 1 timeout auto-starts Module 2 (higher) | as AT-01, policy routes `higher` | as AT-01 | the `higher_branch` module opens, not the lower one | Hook + pure |
| AT-03 | Early manual submit keeps the directions screen and offers a working Start | Module 1 submitted with its own clock still running (`deadlineAt > serverNow`) | student submits Module 1 at 12:00 remaining | runner goes to `directions` showing Module 2; **no** automatic `startModule`; the Start button is **enabled** | Pure + component |
| AT-04 | Manual Start on Module 2 works | as AT-03 | student presses Start | exactly one `startModule` for the branch module; runner reaches `phase: 'module'` | Component + hook |
| AT-05 | Routing follows the answers | two runs, one above and one below `minimumCorrectForHigher` | Module 1 timeout | first run opens the higher branch, second the lower — whichever the server wrote in `assessment_route_decisions` | API + e2e |
| AT-06 | Module 2 timeout advances to the next section | Module 2 `active`, section clock still live, Math base row not yet created | Module 2's clock reaches 0:00 | Module 2 submits; route = `startBreak`; runner reaches `break`/waiting; **no** `submitAssessment` is issued | Hook |
| AT-07 | Next section's Module 1 auto-starts after the break | as AT-06, then section advances + authored gap elapses | break countdown reaches 0 | `startModule` for the Math base module with no student action; runner reaches `phase: 'module'` | Hook |
| AT-08 | Full cascade | live cohort SAT with two sections | Module 1 timeout → Module 2 timeout → break | M2 opens by itself, then M1 of Math opens by itself; one timer per module; no click anywhere | e2e |
| AT-09 | No premature finalization between sections | Module 2 submitted, next base row `not_started`, no `result` | payload polled | finalization effect does not fire; no `submitAssessment`; the student stays on the wait/break surface | Hook |
| AT-10 | Reload mid-advance | Module 1 closed at/after its own deadline; student reloads before Module 2 opens | bootstrap loads | Module 2 auto-starts from payload-derived state (no click, no dependence on the pre-reload session) | Hook + route |
| AT-11 | Offline at Module 1 timeout | device offline when the clock hits 0:00 | reconnect | the server already finalized Module 1 and created Module 2; on reconnect the poll commits and Module 2 auto-starts (or the student is on a wait surface if the section ended) | Hook |
| AT-12 | Nothing regresses for base modules | proctor Start; later-section base module after the break | as today | `initial-entry` and `next-section-entry` behave exactly as before; the button stays recovery-only for them | Existing suites |
| AT-13 | One-section (scoped) run ends | access link scoped to a single section | Module 2's clock reaches 0:00 | no successor exists; the attempt finalizes and the result screen appears | Hook + Go |
| AT-14 | Section ends while the student is on the Module 2 directions screen | Module 1 submitted early (AT-03 state), Module 2 not started, section clock then expires | wait | student is moved to the between-sections wait/break surface; no start attempt is made against the completed section; no error is shown | Hook + route |
| AT-15 | Branch module start is admitted server-side | cohort_section_v3, section live, branch row `not_started` | `POST .../modules/start` for the branch module | 200; row `active` with `started_at`; stage check uses the section key and passes | Go |
| AT-16 | Branch module start is refused when the section is not live | as AT-15 but the section is `completed`/paused/the clock has expired | same call | 409 with `SECTION_NOT_ACTIVE` / `RUNTIME_NOT_LIVE` / `DEADLINE_EXPIRED`; the row stays `not_started` | Go |

---

## 6. Change-surface / dependency map

```text
Server routing decision (unchanged)          VERIFY (AT-15/16)
   ↓ assessment_route_decisions + branch row (not_started, available_at)
Bootstrap payload                            VERIFY (adaptiveRole, deadlineAt)
   ↓
satCommitRouting.submitModule → showDirections   VERIFY (same-section branch)
   ↓
NEW: "previous module ended by its own clock" derivation      ADD
   ↓
satEntry.deriveSatEntryDecision (branch rule + autoOwned)     CHANGE
   ↓
useSatExamController entryDecision / entrySurface wiring       CHANGE
   ↓
SatStudentSessionRoute props                                   CHANGE
   ↓
SatDirectionsScreen button gating + notice copy                CHANGE
   ↓
satCopy strings                                                CHANGE (may)
```

| Area | Classification |
| --- | --- |
| `application/satEntry.ts` (decision + gates + reasons) | **CHANGE** |
| `hooks/useSatExamController.ts` (inputs + exposure) | **CHANGE** |
| `routes/SatStudentSessionRoute.tsx` (prop pass-through) | **CHANGE** |
| `ui/transitions/SatDirectionsScreen.tsx` (button gating, notice) | **CHANGE** |
| `domain/satCopy.ts` (branch-module directions copy) | **CHANGE (may)** |
| `hooks/useSatModuleEntry.ts` (single-flight/retry) | **VERIFY** — must not need changes |
| `application/satCommitRouting.ts` (route table) | **VERIFY** — `showDirections` for same-section branch is correct |
| `domain/satTiming.ts` / `application/satTimingPolicy.ts` | **VERIFY** — `satCountdown` already handles a branch module (stage = section key) |
| `hooks/useSatResponsePersistence` / durability | **N/A** — answers per module, no change |
| Backend `delivery` (SubmitModule/StartModule/finalize/routing) | **VERIFY** (AT-15/16, AT-13) |
| Backend `proctor` reconcile (section advance, gap) | **VERIFY** — the break/wait path already implemented |
| DB schema / migrations | **N/A** — no column changes |
| API contracts (`contracts/assessmentDelivery.ts`) | **VERIFY** — no new field needed |
| Proctor console | **N/A** |
| Authoring preview (`SatPreviewRoute`) | **N/A** (separate harness; confirm no shared entry code) |
| Analytics / observability | **CHANGE (may)** — one entry outcome metric (see §13) |

---

## 7. Design decisions

### D1 — Auto-advance only on timeout; manual early finish keeps the directions screen

**Reason:** the user's locked decision (2026-09-19). It also matches the existing
Bluebook-shaped design, where the directions screen is the place a student reads
the module length and instructions.
**Alternatives considered:** always auto-start; auto-start behind a timed
transition screen.
**Why rejected:** auto-starting after a deliberate manual submit removes the only
screen where the student can read Module 2's directions, and it changes behaviour
the current suite pins for base modules without a reported need.

### D2 — Derive "Module 1 ended by its own clock" from the payload, not from local state

**Policy:** `previousModuleTimedOut(payload, moduleId)` is true when the module
attempt for `moduleId` is terminal (`submitted`/`locked`) **and**
`deadlineAt != null` **and** `Date.parse(deadlineAt) <= Date.parse(payload.serverNow)`
(with a small, named tolerance for the client's ceil-based countdown and the
server round trip).

**Reason:** it is one pure function over server data, so the live session, a poll
that discovers the finalization, an offline reconnect, and a page reload all reach
the same verdict. `completion_reason` cannot express it (F3), and a local flag dies
on reload (`autoSubmitted` is component state).
**Alternatives considered:** a local `autoSubmitted`/timeout-key flag; a new server
`completion_reason` value for "closed by its own clock".
**Why rejected:** the local flag fails AT-10/AT-11; the server value would mean
changing what `SubmitModule` records for every module submit, which is a wider
blast radius than this bug needs.
**Invariant protected:** I2 — the verdict is read from the same rows the routing
decision was written to, never re-derived from answers.

### D3 — Split "who owns this module's entry" from "an attempt already failed"

`SatEntryDecision` gains a field (proposed name `autoStartPending`) meaning *the
automatic path owns this module and will start it as soon as its gates open*. It is
false for a branch module that is merely waiting for a student.

`SatDirectionsScreen` then gates the button on
`moduleEnterable && (entryRecoverable || !autoStartPending)`, and shows the
"opens automatically" notice only while `autoStartPending` is true.

**Reason:** the current single boolean conflates three states (auto-owns,
auto-failed, no-auto-path), which is what produced the F2 dead end.
**Alternatives considered:** flip `not-base-module` to `recoverable`; enable the
button unconditionally.
**Why rejected:** the first keeps the decision and the button in two places; the
second re-opens the double-start race for base modules during a normal automatic
entry and changes pinned copy.
**Invariant protected:** I5 (no dead ends) without weakening I3.

### D4 — No server change

**Reason:** §2.2 shows the branch row is created, gated, and delivered correctly,
and AT-15/AT-16 exist to prove it rather than assume it. If AT-15 fails, the plan
reopens with a backend phase (§8 Phase 6) before any client work ships.
**Invariant protected:** I1.

### D5 — The new rule replaces the blanket branch-role veto, but keeps a veto

The veto becomes: a branch module is enterable only as *this section's* Module 2,
i.e. when it is the pending attempt and `stageReady` holds (which already encodes
"the section the module belongs to is live"). A branch module belonging to a
completed/other section stays refused — that is AT-14, and `satStageReady` +
`sectionWaitSeconds` already provide the guard. **Reason:** prevents the new rule
from opening a module in a section that has ended.

---

## 8. Detailed implementation TODOs

Sequenced so each phase leaves the tree consistent. Phase 0 first: the plan's
timeout derivation depends on reading real payloads.

### Phase 0 — Characterisation (evidence before change)

- [ ] **0.1 Capture the real Module 1 → Module 2 payload.**
  - Where: a local run against a live seeded SAT schedule (Playwright `webServer`
    stack, as used by `e2e/e2e-05-proctor-advance-during-flush.spec.ts`), or a
    recorded bootstrap fixture if a run is impractical.
  - What: record the bootstrap JSON immediately after Module 1 is submitted —
    the branch attempt's `state`, `availableAt`, `startedAt`, `deadlineAt`,
    `remainingSeconds`, and `sections[].modules[].adaptiveRole`.
  - Why: confirms the derivation in D2 uses real numbers (in particular that the
    finished module's `deadlineAt` is at/before `serverNow` after an expiry submit
    and **after** an early manual submit it is still in the future).
  - Depends on: nothing. Blocks: 2.1.
  - Verify: the recorded fixture is committed under the existing delivery fixture
    convention (or attached to the PR) and both AT-01 and AT-03 derivations can be
    evaluated against it by hand.
- [ ] **0.2 Confirm the branch module's stage passes the server gate.**
  - Where: `backend/go/internal/delivery/service.go:1513` (`moduleTimingGateTx`).
  - What: record the expected stage for `cohort_section_v3` (`sectionKey`, not
    `sectionKey:m2`) and the fact that a branch module reaches the same expected
    value as the base module.
  - Why: proves the fix is client-only before removing the client-side veto.
  - Verify: written into the Go test of 6.1.

### Phase 1 — Acceptance tests first (red)

- [ ] **1.1 Extend the pure entry-decision tests.**
  - Where: `src/features/student-delivery/domain/satDomain.test.ts` (the two cases
    asserting `reason: 'not-base-module'`).
  - What: replace them with the branch rules — branch + previous module timed out
    → `shouldStart: true`; branch + previous module submitted early →
    `shouldStart: false` with the new "student must press Start" reason and
    `autoStartPending: false`; branch + section ended → blocked.
  - Why: the policy is the single owner; the wiring tests then have something true
    to wire.
  - Preserve: every existing base-module expectation (`initial-entry`,
    `next-section-entry`, `break-active`, `section-wait`, `stage-not-ready`,
    `runtime-not-live`, `proctor-blocked`, `already-started`, `unknown-section`).
  - Enables: AT-01, AT-02, AT-03, AT-14.
  - Verify: `bun run test:run src/features/student-delivery/domain/satDomain.test.ts`
    fails for the new cases before Phase 2 and passes after.
- [ ] **1.2 Add the pure timeout-derivation tests.**
  - Where: new cases in `src/features/student-delivery/domain/satDomain.test.ts`
    (or `satTiming.test.ts`, next to the other clock helpers).
  - What: table tests for the D2 helper — deadline in the past; deadline in the
    future; a `not_started` module; a missing `deadlineAt`; `locked` as well as
    `submitted`; the tolerance boundary.
  - Enables: AT-10, AT-11.
- [ ] **1.3 Add the component test for the manual path.**
  - Where: `src/features/student-delivery/ui/transitions/SatDirectionsScreen.test.tsx`.
  - What: with `autoStartPending` false (branch module, early submit) the Start
    button is **enabled** and the "opens automatically" notice is absent; with
    `autoStartPending` true it stays disabled with the notice (existing behaviour).
  - Preserve: the existing "enables the start button as recovery once auto-entry
    has failed" case.
  - Enables: AT-03, AT-04.
- [ ] **1.4 Add the hook-level advance tests.**
  - Where: `src/features/student-delivery/hooks/__tests__/useSatExamController.autoEntry.test.tsx`
    (same gateway/persistence mock pattern; add a branch module to the fixtures).
  - What: AT-01/AT-02 (timeout → automatic `startModule` for the branch module,
    exactly one call), AT-03 (early-submit payload → no automatic call), AT-06
    (branch timeout → `startBreak`, no `submitAssessment`), AT-09 (no premature
    finalization), AT-10/AT-11 (reload / reconnect payload).
  - Depends on: 1.1. Enables: AT-01, AT-02, AT-03, AT-06, AT-09, AT-10, AT-11.
  - Verify: the new cases fail on the current tree, each for the intended reason
    (assert the failure message, not just "it failed").
- [ ] **1.5 Add the Go gate tests.**
  - Where: `backend/go/internal/delivery/` (next to `submit_sat_module_gate_test.go`).
  - What: AT-15 (branch module start admitted under a live section; the stage
    query is called with the section key) and AT-16 (refused when the section is
    completed/paused/expired; the row stays `not_started`).
  - Why: removes the "does the server even allow this?" uncertainty from the
    client change (D4).
  - Verify: `cd backend/go && go test ./internal/delivery/...`.

### Phase 2 — Entry policy (the fix)

- [ ] **2.1 Add the timeout derivation as one pure helper.**
  - Where: `src/features/student-delivery/application/satEntry.ts` (or
    `application/satRuntimeSelectors.ts` if it reads better next to the other
    payload selectors — pick one and keep it single-owner).
  - What: implement `previousModuleTimedOut(payload, moduleId)` exactly as D2
    defines, with a named tolerance constant; no React, no clock reads.
  - Depends on: 0.1, 1.2. Enables: AT-01, AT-10, AT-11.
  - Invariants: pure; never throws on a missing attempt or an unparsable date.
- [ ] **2.2 Rework `deriveSatEntryDecision`.**
  - Where: `src/features/student-delivery/application/satEntry.ts`.
  - What: (a) add the `previousModuleTimedOut` input; (b) replace the
    `module.adaptiveRole !== "base"` veto with the branch rule of D5 —
    branch + previous timed out + gates open + unstarted → `shouldStart: true`,
    new reason; branch + not timed out → `shouldStart: false`, new reason,
    `autoStartPending: false`; (c) add `autoStartPending` to `SatEntryDecision`
    and set it true on every path that keeps the existing automatic behaviour.
  - Why: the automatic path and the button must keep reading one verdict.
  - Preserve: `initial-entry` requires `displayOrder === 0` **and** phase
    `directions` **and** every attempt unstarted — unchanged; `next-section-entry`
    unchanged for base modules.
  - Enables: AT-01 … AT-04, AT-12, AT-14.
  - Verify: 1.1 green; the whole existing `satDomain.test.ts` green.

### Phase 3 — Wiring

- [ ] **3.1 Feed the new input from the controller.**
  - Where: `src/features/student-delivery/hooks/useSatExamController.ts`
    (the `entryDecision = deriveSatEntryDecision({...})` call).
  - What: pass `previousModuleTimedOut` computed for the module that just ended —
    the pending module's section is the same section, so resolve the previous
    module's id from the payload (`state.moduleKey` when it still exists in the
    payload, else the terminal attempt in the same section), and memoize it.
  - Depends on: 2.1, 2.2. Enables: AT-01, AT-10, AT-11.
  - Preserve: the entry decision must not re-render per clock tick beyond what it
    already does (memoize on payload identity, not on `now`).
  - Verify: 1.4.
- [ ] **3.2 Expose the auto-ownership to the route.**
  - Where: same hook (the object returned to `SatStudentSessionRoute`).
  - What: return `entryAutoStartPending` (or equivalent) alongside
    `autoEntryRecoverable`, sourced from `entryDecision.autoStartPending`.
  - Depends on: 2.2. Enables: AT-03, AT-04.
- [ ] **3.3 Pass it to the screen.**
  - Where: `src/features/student-delivery/routes/SatStudentSessionRoute.tsx`
    (`SatDirectionsScreen` props) and the component's prop interface.
  - What: thread the new prop through, with the same undefined-tolerant style as
    `entryRecoverable`.
  - Depends on: 3.2. Enables: AT-03.

### Phase 4 — Presentation

- [ ] **4.1 Fix the button and the notice.**
  - Where: `src/features/student-delivery/ui/transitions/SatDirectionsScreen.tsx`.
  - What: `canStart = moduleEnterable && (entryRecoverable || !autoStartPending)`;
    `autoEntryHandling = moduleEnterable && autoStartPending && !entryRecoverable`;
    keep `showStarting`/`showStartHint` consistent with those two.
  - Why: removes the F2 dead end; a branch module waiting for a click must be
    clickable.
  - Preserve: for base modules the button remains recovery-only and the
    "Starting your module…" surface remains (AT-12).
  - Enables: AT-03, AT-04.
  - Verify: 1.3.
- [ ] **4.2 Copy for the branch-module directions state.**
  - Where: `src/features/student-delivery/domain/satCopy.ts`.
  - What: only if the reused strings read wrong for a branch module (the blocked
    hint "The start button enables when the proctor opens this module." is
    inaccurate for Module 2), add one string keyed by state, not by module role
    inference at the call site.
  - Depends on: 4.1. Preserve: existing keys and their consumers.
  - Verify: `SatDirectionsScreen.test.tsx` asserts text by role/name, so keep the
    accessible name of the button unchanged.

### Phase 5 — End-to-end and regression

- [ ] **5.1 Prove the full cascade in one test.**
  - Where: `src/features/student-delivery/hooks/__tests__/`
    (a new `sat-module-advance.test.tsx`, or extend the convergence suite) —
    AT-08 at the hook level, using the existing fake-clock pattern from
    `sat-cohort-clock.test.tsx`.
  - What: M1 timeout → M2 opens by itself → M2 timeout → wait/break → Math M1
    opens by itself, asserting exactly one `startModule` per module and one
    running timer per module.
  - Depends on: Phase 2–4. Enables: AT-07, AT-08.
- [ ] **5.2 Route-level test for the two Module 2 surfaces.**
  - Where: `src/features/student-delivery/routes/__tests__/`
    (follow `SatStudentSessionRoute.between-sections.test.tsx`).
  - What: (a) timeout case renders the starting surface then the module; (b)
    early-submit case renders the directions screen with an enabled Start; (c)
    AT-14 — section expires while on the directions screen → wait/break surface,
    no error.
  - Depends on: 4.1. Enables: AT-14.
- [ ] **5.3 Backend regression.**
  - Where: `backend/go/internal/delivery/`, `backend/go/internal/sat/`.
  - What: confirm AT-13 (a scoped one-section run ends after Module 2) and that
    no scorer/topology test asserts anything about client entry.
  - Verify: `cd backend/go && env -u PORT go test ./internal/delivery/... ./internal/sat/...`.
    **Note:** `cmd/migrate` fails on this tree for a pre-existing reason (pinned
    migration count 61 vs 62 on disk, per `docs/sat-section-transition-plan.md`
    §10.9); that is the baseline, not a regression from this work.
- [ ] **5.4 Browser e2e.**
  - Where: `e2e/` (a new `sat-module-advance.spec.ts`, or extend
    `e2e-05-proctor-advance-during-flush.spec.ts` with a SAT variant only if a SAT
    seed shape already exists — the section-transition doc §10.12 records that an
    earlier attempt to add a SAT e2e fixture was reverted because an unrun spec
    would fail CI).
  - What: AT-08 against the real stack with shortened module clocks.
  - Depends on: 5.1 passing. If the spec cannot be made to pass inside the budget,
    **do not commit it** — the same reasoning that reverted the earlier SAT e2e.
  - Verify: `bunx playwright test e2e/sat-module-advance.spec.ts --project=chromium`.

### Phase 6 — Contingency (only if Phase 0 or AT-15 disproves D4)

- [ ] **6.1 Reopen with a backend phase** if a branch module cannot be started
      under a live section, or if the branch row is not created/ delivered as
      §2.2 describes. Stop client work, fix the server first, re-run Phase 1.

---

## 9. File-by-file change plan

| Path | Existing responsibility | Required modification | Reason | ATs |
| --- | --- | --- | --- | --- |
| `src/features/student-delivery/application/satEntry.ts` | The one pure entry policy + attempt bookkeeping | Add `previousModuleTimedOut` input and the timeout helper; replace the branch veto; add `autoStartPending`; add the two new reasons | F1, F3, D2, D5 | 01–04, 10, 11, 14 |
| `src/features/student-delivery/hooks/useSatExamController.ts` | Owns `entryDecision`, `useSatModuleEntry`, the zero-remaining expiry effect | Compute and pass the new input; expose `autoStartPending` to the route | F1 | 01, 02, 10, 11 |
| `src/features/student-delivery/routes/SatStudentSessionRoute.tsx` | Mounts the phase surfaces | Thread the new prop into `SatDirectionsScreen` | F2 | 03 |
| `src/features/student-delivery/ui/transitions/SatDirectionsScreen.tsx` | Directions surface + Start button | Button gating and notice per D3 | F2 | 03, 04 |
| `src/features/student-delivery/domain/satCopy.ts` | Student copy | Only if the branch-module hint needs its own wording | F2 | 04 |
| `src/features/student-delivery/domain/satDomain.test.ts` | Pure policy tests | Replace the two `not-base-module` cases; add timeout-helper cases | — | 01–03, 14 |
| `src/features/student-delivery/ui/transitions/SatDirectionsScreen.test.tsx` | Component tests | Add the enabled-button / no-notice case | — | 03, 04 |
| `src/features/student-delivery/hooks/__tests__/useSatExamController.autoEntry.test.tsx` | Entry wiring tests | Add branch-module fixtures and the advance cases | — | 01–03, 06, 09–11 |
| `src/features/student-delivery/hooks/__tests__/sat-module-advance.test.tsx` | **new** | Full cascade (AT-08) | — | 07, 08 |
| `src/features/student-delivery/routes/__tests__/SatStudentSessionRoute.module-advance.test.tsx` | **new** | Route-level surfaces | — | 03, 14 |
| `backend/go/internal/delivery/start_branch_module_test.go` | **new** | Branch-module start gate | D4, F5 | 15, 16 |
| `e2e/sat-module-advance.spec.ts` | **new (conditional)** | AT-08 against the real stack | — | 08 |

No files are expected to be deleted. No migration files are added.

---

## 10. State lifecycle

```text
Module 1 attempt: not_started
  → active        (StartModule CAS, started_at = gateNow)
  → submitted     (SubmitModule → finalizeModuleTx "student_submit")
                  deadline_at (derived) is now ≤ serverNow  ⇔  timeout path
  → (per-module) student_submit is the ONLY reason written by the client's path

Routing decision (server, same tx):
  assessment_route_decisions row + branch module attempt row
  (not_started, available_at = now for a same-section follow-up)

Client:
  payload(moduleAttempts) is the source of truth for "what exists"
  previousModuleTimedOut = pure function over that payload  → entry policy
  entry policy            → useSatModuleEntry (single-flight, key = attempt:module)
  entry policy            → SatDirectionsScreen button/notice

Module 2:
  → active (auto or manual start) → timer = min(module clock, section clock)
  → submitted → route: next section's base module → startBreak
  → next section base module not_started → break/wait → auto entry (unchanged path)
```

Duplicated/derived state is unchanged: the only new derived value is
`previousModuleTimedOut`, computed per render from the committed payload and never
persisted. No cache invalidation, no cross-tab concern beyond what already exists
(the attempt's writer-session fencing is untouched).

---

## 11. Error and edge-case matrix

| Condition | Expected behaviour | Layer handling it | AT |
| --- | --- | --- | --- |
| Module 1 clock hits 0:00 while the section clock is still live | submit accepted; Module 2 auto-starts | entry policy | 01, 02 |
| Student submits Module 1 early | directions screen, enabled Start, no automatic call | entry policy + screen | 03, 04 |
| Server already finalized Module 1 (offline client) | poll commits, Module 2 auto-starts on reconnect | entry policy (payload-derived) | 11 |
| Reload after the timeout, before Module 2 opened | same as above; no local state required | entry policy | 10 |
| Routing picks higher vs lower | the module the server created opens; no client re-derivation | entry policy (uses payload) | 02, 05 |
| Auto-start request fails (network/5xx) | attempt stays retryable; button becomes available (recoverable) | `useSatModuleEntry` (unchanged) | 04 |
| Auto-start returns a transition conflict | silent retry, no student-facing error | existing `isSectionClosingRejection`/`isStaleConflictRejection` path | 12 |
| Section clock expires while the student is on the Module 2 directions screen | wait/break surface; no start against a completed section; no error | `satStageReady` + `sectionWaitSeconds` + `satCountdown` | 14 |
| Module 2 clock reaches 0:00 | submit; `startBreak`; no premature finalization | route table + finalization predicate | 06, 09 |
| Next section's Module 1 opens after the authored gap | auto-start (existing rule) | entry policy | 07, 08 |
| One-section scoped run | no successor → finalize → result | server routing + client finalization | 13 |
| Duplicate start (double click / StrictMode / two tabs) | one row transition; the loser gets a conflict | server CAS + entry single-flight | 12 |
| Proctor pauses during any of the above | both clocks freeze; entry blocked (`runtime-not-live`) | existing | 12 |
| Legacy `legacy_section_v1` SAT run | unchanged (base veto path not reachable for branch modules in practice) | marked in code comment at the change site | — |

---

## 12. Compatibility and migration

- **No schema change, no backfill, no feature flag.** Every column already exists;
  the server path is unchanged (D4).
- **Existing attempts in flight during deploy:** the client change is additive in
  behaviour terms — it only opens a module that the server has already created and
  would accept. A student mid-session at deploy time cannot be stranded: the old
  behaviour (no advance) is replaced by the new behaviour on the next poll, and
  both derive from the same payload.
- **Old clients:** an old bundle keeps the F1/F2 behaviour. This is acceptable —
  the section clock still bounds the mismatch — but it is the reason the fix must
  ship as a client deploy, and why AT-14 (section end while stuck on directions)
  must keep working for them too.
- **Rollback:** revert the client commit; no data implications (no new persisted
  field, no server-side state introduced).
- **Downgrade:** nothing to downgrade; the payload contract is unchanged.

---

## 13. Test strategy

| Layer | What it proves | Risks protected |
| --- | --- | --- |
| Pure (`satDomain.test.ts`, `satTiming.test.ts`) | policy and derivation truth tables | wrong auto-start; regression of base-module rules |
| Component (`SatDirectionsScreen.test.tsx`) | button/notice states | the F2 dead end; copy regressions |
| Hook (`useSatExamController*.test.tsx`, `sat-module-advance.test.tsx`) | wiring, single-flight, retry, cascade | double starts; lost advances; premature finalization |
| Route (`SatStudentSessionRoute*.test.tsx`) | what the student actually sees per state | surfaces that contradict each other (the "opens automatically" lie) |
| Go (`start_branch_module_test.go`) | the server admits/refuses branch starts as assumed | shipping a client fix against a server that rejects it |
| e2e (conditional) | the real stack, real timers | the class of bug that unit mocks cannot show |

Deliberately **not** added: tests asserting implementation details of the helper
(internal call counts, private shapes), and blanket snapshots of the directions
screen. The only new unit surface is the derivation and the decision.

Commands:

```bash
bun run typecheck
bun run test:run src/features/student-delivery
cd backend/go && env -u PORT go test ./internal/delivery/... ./internal/sat/...
```

(`env -u PORT` matters: this shell exports `PORT=0`, which the config test
rejects — see `docs/sat-section-transition-plan.md` §10.9/§10.11.)

---

## 14. Observability

- The existing student metric seam (`emitStudentObservabilityMetric`, as used by
  `sat_finalize_attempt`) is the right place for **one** new event:
  `sat_module_advance` with `{ reason: 'timeout' | 'student', sectionKey,
  adaptiveRole }`, emitted once per committed module advance.
  **Reason:** this bug was invisible in telemetry — a student who never started
  Module 2 looked identical to one who was mid-module. The metric makes "M1
  submitted by timeout, M2 never started" a queryable funnel step.
  Do not add more than this; no new dashboard is in scope.
- Worth watching after rollout: the count of advances with
  `reason: 'timeout'` versus `startModule` calls for branch modules (a gap means
  the auto-entry path is still not firing for some population).
- Log/alert threshold: not defined here (no existing SAT alerting surface was
  identified in this audit) — **UNCERTAIN**, see §15.

---

## 15. Rollout, rollback, open questions

**Rollout order:** Phase 0/1 (evidence + failing tests) → Phase 2 (policy) →
Phase 3 (wiring) → Phase 4 (presentation) → Phase 5 (cascade + e2e). The client is
a single deployable; there is no cross-service sequencing. The Go tests in Phase 1
gate the whole thing: if AT-15 fails, ship nothing until it is fixed.

**Verification after deploy:** one live-seeded SAT run per section type with
shortened module clocks; confirm two module starts with no clicks and the
`sat_module_advance` metric with `reason: 'timeout'`.

**Rollback trigger:** any student reaching the Module 2 directions screen unable to
start, or a duplicate module start. **Mechanism:** revert the client commit (no
state to unwind). **Data implications:** none.

**Open questions / uncertainties**

1. **ASSUMPTION TO VERIFY (0.1):** that after an expiry submit the finished
   module's `deadline_at` is at/before `server_now` in the payload. This is
   INFERRED from `computeModuleTiming`; if it is false for some pause/extension
   combination, D2's derivation needs an additional signal (a local flag or a
   `completion_reason` value). AT-01/AT-03 pin it either way, and 0.1 decides.
2. **UNCERTAIN:** whether any real-schedule combination reaches Module 2 without
   Module 1 ever being `active` (e.g. a module row created after its section
   ended). Behaviour is defined (AT-14: wait surface, no start), but the frequency
   was not measured.
3. **UNCERTAIN:** the exact multi-tab behaviour of the new rule when two tabs sit
   on the same branch module and both see `previousModuleTimedOut` — the server
   CAS should make one of them conflict (I3). Not measured; AT-12 asserts only the
   single-tab duplicate case.
4. **OPEN QUESTION (product):** should the Module 2 directions screen for the
   timeout path be shown at all, or skipped? The locked decision (D1) implies it
   may flash briefly while the start is in flight. If a deliberate transition
   screen is wanted later, it is a separate change to the routing hint.
5. **UNCERTAIN:** whether an alerting threshold should accompany the new metric
   (§14); no SAT alert surface was located in this audit.

---

## 16. Final acceptance checklist

```text
- [ ] AT-01 … AT-16 pass (16 scenarios).
- [ ] Existing regression suite passes: bun run test:run src/features/student-delivery
- [ ] Whole frontend suite passes: bun run test:run   (baseline: any pre-existing
      failures are recorded, not silently accepted — see the section-transition
      doc's records for the current baseline)
- [ ] Backend suites pass: env -u PORT go test ./internal/delivery/... ./internal/sat/...
- [ ] Typecheck clean: bun run typecheck
- [ ] No schema/data migration is required (verified: none added).
- [ ] API compatibility verified: no contract field added or removed.
- [ ] Authorization behavior unchanged (proctor gates, writer session, expiry).
- [ ] Failure paths verified: failed auto-start → retryable + button available.
- [ ] No student-reachable dead end on the directions screen for any role.
- [ ] Base-module entry behaviour unchanged (AT-12).
- [ ] Observability: sat_module_advance emitted once per committed advance.
- [ ] Rollback path verified: client-only revert, no data implications.
- [ ] Requirement → test → change traceability complete (F1/F2/F3/F4 → AT-* → §8).
```

Feature-specific gates on top of the standard list:

```text
- [ ] Zero clicks required for Module 1 timeout → Module 2 (both branch roles).
- [ ] Exactly one start per (attempt, module) across the whole cascade.
- [ ] No submitAssessment between Module 2's submit and the next section going live.
- [ ] The directions screen never claims "opens automatically" for a module that
      no automatic path owns.
```

---

## 17. Implementation record

Written 2026-09-19, from the working tree after the change. Labels as in §0: every
result below is **KNOWN** (commands actually run, output read).

### 17.1 What shipped

| File | Change |
| --- | --- |
| `application/satEntry.ts` | The blanket `not-base-module` veto is gone. New `moduleAttemptEndedByOwnClock` + `previousModuleTimedOut` (payload-derived timeout, §7 D2) with the `SAT_MODULE_TIMEOUT_TOLERANCE_MS` tolerance. `deriveSatEntryDecision` gains `previousModuleTimedOut` as an input and `autoStartPending` on its result; new reasons `next-module-entry` and `awaiting-student`. |
| `hooks/useSatExamController.ts` | Derives `previousModuleTimedOut` from the committed payload (memoized above `startPendingModule`, which consumes it) and feeds the decision; exposes `entryAutoStartPending`. Also emits the one new `sat_module_advance` metric (§14) on every confirmed open, labelled `timeout` / `student`. |
| `routes/SatStudentSessionRoute.tsx` | Threads `autoStartPending` into `SatDirectionsScreen`. |
| `ui/transitions/SatDirectionsScreen.tsx` | `canStart = moduleEnterable && (entryRecoverable || !autoStartPending)`; the "opens automatically" surface now requires `autoStartPending`. An absent prop reads as `true`, so base-module behaviour and every existing caller are unchanged. |
| `domain/satDomain.test.ts` | The two `not-base-module` expectations became the branch rules; a new case covers the derivation (past/future deadline, `not_started`, missing deadline, unknown section, both terminal states, the tolerance boundary). |
| `ui/transitions/SatDirectionsScreen.test.tsx` | Enabled-button / no-notice case, the inverse, and click -> `onStart`. |
| `hooks/__tests__/useSatExamController.autoEntry.test.tsx` | Branch-module fixtures plus: both branch roles open after a timeout, an early submit does not open, a timed-out Module 2 reaches the wait without finalizing, and a waiting next-section module never finalizes the attempt. |
| `routes/__tests__/SatStudentSessionRoute.between-sections.test.tsx` | `pendingModuleOf` now resolves the pending module the way the controller does (the old "first module of the first section" shortcut cannot express Module 2); two route-level Module 2 cases. |
| `backend/go/internal/delivery/start_branch_module_test.go` | **new** — AT-15 / AT-16. |

### 17.2 Deviations from the plan as written

- **§4.2 (copy) turned out to be unnecessary.** The only string that read wrong
  for a branch module was the auto-open notice, and that is now rendered only
  when the automatic path really owns the module. The blocked hint ("The start
  button enables when the proctor opens this module.") renders only while the
  module is **not** enterable, which is accurate for Module 2 too. No new copy
  key was added.
- **Phase 5.1 is not one scripted cascade.** The three segments — open Module 2
  after the timeout, Module 2's own timeout reaching the next-section wait, and
  no premature finalization while that section waits — are three tests in the
  existing auto-entry suite instead of one journey with a scripted section
  advance. Each transition has one owner and those tests pin them; a scripted
  journey would add fake-timer surface without pinning a new rule.
- **AT-15/16 are endpoint tests as planned**, not gate-unit tests: they drive
  `Service.StartModule` for a branch module and assert the CAS/phase writes (and,
  on refusal, that no CAS happens).
- **0.1 was not run as a live capture.** The timeout derivation was instead
  pinned by unit cases over both deadline directions plus AT-15/16 on the server
  side, and the branch fixtures encode the payload shape §2.2 describes. A live
  capture against a seeded schedule remains the strongest evidence and is the
  first thing to do if a real run disagrees with the fixture.

### 17.3 Verification actually run

- `cd backend/go && env -u PORT go test ./internal/delivery/... ./internal/sat/... -count=1` — **ok** in both packages.
- `bun run typecheck` — clean.
- `bunx eslint` on every changed TS file — 0 errors, 3 warnings, all three the
  pre-existing `react-hooks/exhaustive-deps` warnings about `candidateId` in
  effects this change does not touch.
- `gofmt -l internal/delivery/start_branch_module_test.go` — clean.
- `bun run test:run src/features/student-delivery` — **115 files / 1021 tests, 1020 passing**.
  The single failure is `ui/__tests__/bluebookBans.test.ts` -> "forbids
  backdrop-blur in SAT exam scope", which flags `ui/media/SatImageViewer.tsx`.
  That file is **untouched here and contains `backdrop-blur` at HEAD** (checked
  with `git show HEAD:... | rg -c backdrop-blur` -> 1), so the failure is
  pre-existing and unrelated; no file changed by this work is named by that scan.

### 17.4 Acceptance coverage map

| AT | Covered by |
| --- | --- |
| AT-01, AT-02 | `useSatExamController.autoEntry.test.tsx` — `it.each` over both branch roles: one `startModule` with no student action, phase `module`, moduleKey = the routed module |
| AT-03 | same file, "leaves Module 2 to the student when Module 1 was submitted early" (no call, `entryAutoStartPending === false`) plus `SatDirectionsScreen.test.tsx` |
| AT-04 | `SatDirectionsScreen.test.tsx` click -> `onStart`; the command behind it is the existing `startPendingModule` |
| AT-05 | server routing is unchanged and already covered by `internal/sat` / `sat_v2_scoring_test.go`; the client side is the `it.each` role parameterization (whatever the payload names is what opens) |
| AT-06 | "moves a timed-out Module 2 to the next section's wait without finalizing" |
| AT-07 | existing "enters the next section with no student action once the authoritative break has ended" (base module) |
| AT-08 | **split** across AT-01 / AT-06 / AT-07 — not one scripted journey, and no browser spec (§17.5) |
| AT-09 | "never finalizes an attempt whose next section module is still waiting" |
| AT-10, AT-11 | the same payload-derived path as AT-01: the test seeds the post-timeout payload directly, which is what a reload or a reconnect sees |
| AT-12 | the pre-existing auto-entry and `satDomain` suites, unchanged and green |
| AT-13 | Go `internal/sat` one-section scoring/topology suites (unchanged) |
| AT-14 | `satStageReady` / `sectionWaitSeconds` are unchanged; the waiting surfaces have route-level coverage in the between-sections suite |
| AT-15, AT-16 | `start_branch_module_test.go` |

### 17.5 Deliberately not done

1. **No e2e spec.** A SAT variant needs its own seeded schedule shape, and an
   unrun `.spec.ts` under `e2e/` is picked up by CI's `playwright test` — the
   reason the 2026-09-14 work reverted its SAT e2e (§10.12 of the section-plan
   document). Shipping one that will not be run and kept green is worse than not
   writing it.
2. **No k6 scenario.** The existing transition scenarios mutate real
   schedule/runtime state and were already out of scope for that work; this
   change adds no server write path, so there is no new concurrency invariant to
   load.
3. **No alert threshold for `sat_module_advance`.** The event is emitted now;
   picking a threshold needs a product/ops decision (§15.5).
