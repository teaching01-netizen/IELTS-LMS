# Low-level implementation plan: SAT break starts at the section boundary

Status: planned, 2026-10-29. Input: production symptom report (RW ends → "Scheduled break / Preparing Math…" for 10–20 s) plus the architecture review in this session. No code has been changed.

Scope: `sat_personal_v1` (SAT personal timing) only. Cohort/legacy break behaviour is explicitly out of scope.

## 1. Change boundary and repository evidence

### Current behaviour

The Reading & Writing module expires. The browser closes it, the server finalizes it and — in the **same transaction** — routes Math Module 1 and creates the attempt's scheduled break. The close response is a narrow projection (`SatModuleCloseAck`) that carries the new module rows and the next section, but **not the break rows**. The client merges the module rows, leaves `attempt.personalBreaks` at its previous value, derives `breakWindow.phase === "none"`, and renders the terminal break phase `ending` ("Preparing Math…") — with no timer and no way to arm the break. The break can only start after some *other* payload arrives: an `attempt` socket frame, or the recovery poll (60 s with a live socket, 20 s ± full jitter → 10–20 s without one).

### Desired behaviour

The close response is self-sufficient: a successful close that creates a break returns that break, and the break surface moves to `preparing` immediately, arms, and starts the break on the server-issued lead. No recovery poll and no socket frame may be required for the break to begin.

### Verified implementation map

| File / symbol | Verified role | Consequence for this work |
| --- | --- | --- |
| `backend/go/internal/delivery/close_module.go`: `SatModuleCloseAck` (49-67), `closeAck` (552-614), `loadCloseAckProjection` (629-), call site (215) | Sole builder of the close ack; every close (fresh, `alreadyClosed`, recovery) goes through it; invoked inside `withTxDatabase(t)` | Add one field + one indexed read here; nothing else on the server writes the ack |
| `backend/go/internal/delivery/start_submit.go`: `openFollowUpModuleTx` (1238), `createPersonalBreakTx` (1363) | Creates the break row in the close transaction, `state='pending'`, guarded by `currentSectionID != next.sectionID && breakAfterSeconds > 0` | Confirms the row exists before the ack is built, and confirms `breakAfterSeconds > 0` is the exact "a break will exist" predicate |
| `backend/go/internal/delivery/service.go`: `withTxDatabase` (109), `PersonalBreak` (357), `loadPersonalBreaks` (1202) | `withTxDatabase` swaps `s.db` to the transaction, so the new read sees the uncommitted row; `loadPersonalBreaks` already computes `remainingSeconds` | Reuse `loadPersonalBreaks` unchanged |
| `backend/go/internal/delivery/personal_break.go`: `StartBreak`, `EnterBreak` (205), `MarkBreakVisible`, `completeDuePersonalBreaksTx` (294-330) | `revision` increments on every transition; completion sets the next module's `available_at` to the break deadline | Makes break rows safely mergeable by revision and confirms Math cannot start before break completion |
| `backend/go/migrations/0069_sat_personal_timing.sql` (32-67) | `uq_attempt_break_section (attempt_id, after_section_id)`, state check, `attempt_id`-leading index | New read is one indexed lookup over ≤1 row per boundary |
| `src/features/student-delivery/application/satEntryAck.ts`: `applyCloseAck` (77-90) | Merges `moduleAttempts` + `selectedSection` only | The field is dropped here today |
| `src/features/student-delivery/contracts/assessmentDelivery.ts`: `AssessmentModuleCloseAck` (407-421), `AssessmentPersonalBreakSnapshot` (111-127) | No runtime parser: the JSON is typed only (`api/assessmentDeliveryApi.ts:602-614`) | Adding an optional field is a type-only client change |
| `src/features/student-delivery/application/satTimingPolicy.ts`: `satOpenPersonalBreak` (312), `satBreakWindow` (320-351) | Single owner of the break phase; both the controller and the per-second runtime call it | The "authored but not yet known" state must be decided here or the surface will re-derive `ending` every second |
| `src/features/student-delivery/application/satStudentSurface.ts`: `deriveSatStudentStage` (265-284) | Maps `none` → `ending`, `preparing`/`active` → themselves | No change needed once the window reports `preparing` |
| `src/features/student-delivery/application/satRuntimeSelectors.ts`: `modulesInExamOrder` (91), `previousModuleInExamOrder` (103), `moduleStartsNewSection` (121) | Structural boundary facts | Add the sibling "authored break before this module" selector here |
| `src/features/student-delivery/hooks/useSatExamController.ts`: break derivation (1212-1226), close-ack commit (812-824), `useSatBreakEntry` wiring (1530-1547), break-end pull (1986-2011), `temporalModel` memo (1854-1875) | Owns payload facts, boundary effects and the temporal model | Three small insertions: ack metric, pull loop, model field |
| `src/features/student-delivery/timing/satTemporalModel.ts`: `SatTemporalModel` (19-28), `deriveSatTemporalSnapshot` (75-87) | Per-second re-derivation used by the break surface | Must receive the same authored-break input |
| `src/features/student-delivery/ui/break/SatScheduledBreakScreen.tsx` (36-71) | Re-derives the phase from the temporal snapshot; renders the timer slot | Only the optional lead countdown touches this file |
| `src/features/student-delivery/hooks/useSatBreakEntry.ts`: `decideSatBreakEntryStep` (39-68), effect (170-...) | Arms then confirms; refuses to arm without `personalBreak` | Unchanged. It starts working the moment the row exists |
| `src/features/student-delivery/application/satPollCadence.ts` (23-43) | 60 s live / 20 s offline, 50–100 % jitter | Explains the observed 10–20 s; after this change the cadence is no longer load-bearing at the boundary |
| `src/features/student-delivery/routes/__tests__/SatStudentSessionRoute.between-sections.test.tsx` (399-454) | Encodes the "hold the surface, no timer, Preparing Math…" behaviour | Must keep passing for the `breakAfterSeconds: 0` fixture; new cases are added beside it |

### Assumptions and unknowns

- `Verified`: the break row is visible to `loadPersonalBreaks` inside `closeAck` because `closeAck` runs under `withTxDatabase(t)`.
- `Verified`: `breakAfterSeconds` is delivered to the browser for every section (`bulk_sections.go:62-72`, `DeliveredAssessmentSection` in `exam-authoring/contracts/assessment.ts:303`).
- `Inferred`: the 10–20 s figure is the offline poll cadence with jitter, i.e. the socket never delivered the `attempt` frame. Confirm with the close response body before coding (see §8.3): if it already contains `personalBreaks`, this plan fixes the wrong layer.
- `Unknown`: whether the reporting environment terminates TLS/proxies `/api/v1/ws/live`. Not required for this fix (the fix must work without the socket), but it is the reason the symptom is 20 s rather than 1 s.
- `Unknown`: production p95 for the close endpoint. One extra indexed read inside the existing transaction is assumed negligible; measure with `sat_module_close` latency if a counter exists.

### Non-goals

- No schema change or migration.
- No new endpoint.
- No change to the 3 s server lead, the arm/confirm protocol, or the "the break clock never runs before entry is confirmed" rule.
- No change to cohort/legacy break derivation (`isSatPersonalTimingModel` guard keeps them on the existing path).
- No client-side clock authority; the browser still never completes or starts a break on its own.
- No attempt to make the WebSocket transport work in the reporting environment; the fix removes the dependency instead.

## 2. Requirements, rules and invariants

| ID | Requirement / invariant |
| --- | --- |
| FR-1 | A close that creates a scheduled break returns that break in the same response, with `id`, `afterSectionId`, `durationSeconds`, `state`, `revision`. |
| FR-2 | The browser applies the ack's break rows to the attempt before it decides which surface to render. |
| FR-3 | While a break is authored but not yet present in the payload, the break surface reports `preparing` (never `ending`) and never claims the break is over. |
| FR-4 | When the break row is unknown at a section boundary, the client performs a bounded authoritative pull (≤5 reads over ≤10 s, one loop per boundary) instead of waiting out the recovery cadence. |
| RULE-1 | The break is armed and confirmed only by `useSatBreakEntry`, from an authoritative row; the browser never invents a start time. |
| RULE-2 | `ending` is reachable only after this boundary's break row exists and is `completed`. |
| RULE-3 | Entry into the next module stays blocked while the break window blocks entry; break completion (server-side) is what unblocks it. |
| ERR-1 | A failure to read breaks inside the close must not fail the close; the ack still returns and the client's bounded pull recovers. |
| ERR-2 | A close replay (`alreadyClosed`, or the stored-ack path) returns the same break projection as a fresh close at that commit. |
| INV-1 | The server is the only owner of break state; every client field is a projection of `assessment_attempt_breaks`. |
| INV-2 | For one attempt and one boundary there is at most one break row (`uq_attempt_break_section`), so "which break is this" is unambiguous. |
| INV-3 | No payload merge may resurrect a break row that the server has advanced; the projection always carries the full row list for the attempt. |
| INV-4 | The break surface phase is derived from exactly one function (`satBreakWindow`) so the controller and the per-second surface cannot disagree. |

Operation contracts:

| Operation | Preconditions | Committed success | Failure / unchanged state |
| --- | --- | --- | --- |
| Timeout close crossing a section with an authored break | Module `active`/`review` at/after deadline; break not yet recorded | Module finalized, Math M1 row inserted `not_started`, break row `pending`; ack includes the break | Any pre-commit failure rolls back everything; break read failure → ack still returned with no breaks (ERR-1) |
| Close replay (same `closeId`) | Stored ack exists | Stored ack returned verbatim | Never a second break row |
| Client applies close ack | Ack matches `scheduleId` + `attemptId` | `moduleAttempts` replaced, `personalBreaks` replaced when the field is an array | Mismatched identity → `null`, no state written |
| Boundary pull | Break surface mounted, runtime live, boundary authored, row absent, module `not_started` | At most one loop; stops as soon as the row appears | Reads exhausted → phase stays `preparing`, steady poll continues; no user-visible failure |
| Break arm / confirm | Unchanged | Unchanged | Unchanged |

## 3. Entities, ownership and relationships

`assessment_attempt_breaks` is the entity; the server owns it. `SatModuleCloseAck.PersonalBreaks` is a **projection at commit time**, not a second source of truth. `satBreakWindow` is the single owner of the client-visible phase; `deriveSatStudentStage` and `SatScheduledBreakScreen` only translate it.

| Break row state | Open row? | Client window | Surface | Next module enterable |
| --- | --- | --- | --- | --- |
| (row absent, break authored) | no | `preparing` | "Preparing your break…", no timer | no |
| (row absent, no break authored) | no | `none` | `ending` → next module opening | yes (server-owned start) |
| `pending` | yes | `preparing` | "Preparing your break…", no timer | no |
| `armed` (offer issued, future `entryStartsAt`) | yes | `preparing` | "Preparing your break…" | no |
| `active`, `startsAt` in the future | yes | `preparing` (+ optional lead countdown) | "Your break starts in 0:03" | no |
| `active`, counting | yes | `active` | countdown | no |
| `active`, deadline passed | yes | `ending` | break ending | no |
| `completed` | no | `none` | `ending` → next module opening | yes, once `available_at` ≤ now |

The only new client-side concept is **authored-but-unknown**: derived, never stored, produced by `satPendingAuthoredBreak(data, moduleId)`.

## 4. Exact function-level design

### 4.1 Go — `SatModuleCloseAck` carries the attempt's breaks

`backend/go/internal/delivery/close_module.go`

```go
type SatModuleCloseAck struct {
    // … existing fields …
    // PersonalBreaks is the attempt's full break projection at commit time
    // (pending/armed/active/completed). The close transaction creates this
    // boundary's break, so the browser can render and arm the break without a
    // follow-up read. Always non-nil.
    PersonalBreaks []PersonalBreak `json:"personalBreaks"`
}
```

In `closeAck`, after `loadCloseAckProjection` succeeds:

```go
ack.PersonalBreaks = []PersonalBreak{}
breaks, breakErr := s.loadPersonalBreaks(ctx, attemptID, projection.serverNow)
if breakErr != nil {
    // The module is already committed; a failed projection read must not turn
    // a display defect into a refused close. The browser's bounded boundary
    // pull is the recovery path.
    slog.WarnContext(ctx, "SAT close ack: break projection failed",
        "attempt_id", attemptID, "error", breakErr)
} else if breaks != nil {
    ack.PersonalBreaks = breaks
}
```

- **Owns**: the projection only.
- **Reads**: `assessment_attempt_breaks` by `attempt_id`, through the transaction handle.
- **Writes**: nothing.
- **Wire compatibility**: `PersonalBreak` (`service.go:357-373`) already carries the JSON tags and field set of `AssessmentPersonalBreakSnapshot` (`assessmentDelivery.ts:111-127`) — verified field-by-field; no serializer work.
- **Error contract**: non-fatal by design (ERR-1). The alternative — propagating — rolls back a committed close and costs the student 20 s of closing overlay, which is strictly worse than a missing projection that FR-3/FR-4 already handle.
- **Callers**: unchanged; `lifecycle.Store` stores the enlarged ack, and the stored-ack replay returns the same projection (ERR-2).
- **Payload growth**: ≤1 row per boundary, ~300 bytes.

### 4.2 TS — contract and merge

`src/features/student-delivery/contracts/assessmentDelivery.ts`

```ts
export interface AssessmentModuleCloseAck {
  // … existing fields …
  /** Full break projection at close time. Absent on servers before this field. */
  personalBreaks?: AssessmentPersonalBreakSnapshot[];
}
```

`src/features/student-delivery/application/satEntryAck.ts`

```ts
export function applyCloseAck(base, ack): AssessmentDeliveryBootstrap | null {
  if (ack.scheduleId !== base.scheduleId || ack.attemptId !== base.attempt.id) return null;
  const sections = ack.selectedSection ? mergeSelectedSection(base.sections, ack.selectedSection) : base.sections;
  return {
    ...base,
    serverNow: ack.serverNow,
    timing: { ...base.timing, serverNow: ack.serverNow },
    attempt: {
      ...base.attempt,
      moduleAttempts: ack.moduleAttempts,
      // The server returns every break row for the attempt, so an array is a
      // complete projection and replaces the previous one. `undefined`/`null`
      // (an older server) preserves whatever the client already had.
      ...(Array.isArray(ack.personalBreaks) ? { personalBreaks: ack.personalBreaks } : {}),
    },
    sections,
  };
}
```

Wholesale replacement is safe because the server never returns a partial list and because a stored-ack replay can only be older than the client's first application of that same ack (§1 evidence: arming requires the ack to have been applied).

### 4.3 TS — the authored-boundary selector

`src/features/student-delivery/application/satRuntimeSelectors.ts`

```ts
export interface SatPendingAuthoredBreak {
  /** The section whose authored break precedes `moduleId`. */
  readonly sectionId: string;
  readonly seconds: number;
}

/**
 * The scheduled break authored between the module before `moduleId` and
 * `moduleId`, but only while this attempt has no break row for that boundary.
 * Null for a same-section handoff, for a first/last module, and once the row
 * exists (its own state is then the truth).
 */
export function satPendingAuthoredBreak(
  data: AssessmentDeliveryBootstrap,
  moduleId: string,
): SatPendingAuthoredBreak | null {
  const previous = previousModuleInExamOrder(data, moduleId);
  if (!previous) return null;
  const previousSection = sectionForModule(data, previous.id);
  const section = sectionForModule(data, moduleId);
  if (!previousSection || !section || previousSection.id === section.id) return null;
  if (!(previousSection.breakAfterSeconds > 0)) return null;
  const hasRow = data.attempt.personalBreaks?.some(
    (candidate) => candidate.afterSectionId === previousSection.id,
  ) ?? false;
  return hasRow ? null : { sectionId: previousSection.id, seconds: previousSection.breakAfterSeconds };
}

/** Convenience for the window input; 0 when there is nothing authored. */
export function satPendingAuthoredBreakSeconds(
  data: AssessmentDeliveryBootstrap,
  moduleId: string,
): number {
  return satPendingAuthoredBreak(data, moduleId)?.seconds ?? 0;
}
```

- Pure, no clock, no React. Mirrors `moduleStartsNewSection` so the two boundary facts cannot diverge.
- Returns null/0 for cohort/legacy payloads too (they have no rows); callers gate on `isSatPersonalTimingModel` inside `satBreakWindow`.
- The `sectionId` is what the pull loop compares against, so it never re-derives exam order itself.

### 4.4 TS — `satBreakWindow` gains one optional input

`src/features/student-delivery/application/satTimingPolicy.ts`

```ts
export interface SatBreakWindow {
  readonly phase: SatBreakWindowPhase;
  readonly seconds: number | null;
  readonly blocksEntry: boolean;
  /** Seconds until the confirmed future start, preparing only; else null. */
  readonly leadSeconds: number | null;
}

export function satBreakWindow(input: {
  timingModel: MaybeString;
  personalBreak: SatBreakWindowBreak | null;
  serverNowMs: number;
  sharedSeconds: number;
  /** Authored boundary break with no row yet (satPendingAuthoredBreakSeconds). */
  authoredBreakSeconds?: number;
}): SatBreakWindow {
  if (!isSatPersonalTimingModel(input.timingModel)) {
    return input.sharedSeconds > 0
      ? { phase: "active", seconds: input.sharedSeconds, blocksEntry: true, leadSeconds: null }
      : NO_BREAK;
  }
  const brk = input.personalBreak;
  if (!brk) {
    return (input.authoredBreakSeconds ?? 0) > 0
      ? { phase: "preparing", seconds: null, blocksEntry: true, leadSeconds: null }
      : NO_BREAK;
  }
  if (brk.state === "completed") return NO_BREAK;
  // … existing branches, now also returning leadSeconds …
}
```

Behaviour rules, all testable:

1. `personalBreak === null` + authored break → `preparing`, `blocksEntry: true` (FR-3, RULE-3).
2. `personalBreak === null` + no authored break → `none` (unchanged).
3. `active` with `startsAt > now` → `preparing` with `leadSeconds = ceil((startsAt - now)/1000)`; this is the confirmed 3 s lead, so the surface can count into the break instead of showing an empty timer slot. `state === "active"` already implies `entryConfirmedAt` was set in the same update (`personal_break.go:205-208`), so no extra flag is needed.
4. Every other branch unchanged.

Exact edits inside the current body (`satTimingPolicy.ts:320-351`):

- `NO_BREAK` (304) → `{ phase: "none", seconds: null, blocksEntry: false, leadSeconds: null }`.
- the shared-model branch (330-332) → add `leadSeconds: null`.
- the local `preparing` (336) and `ending` (337) constants → add `leadSeconds: null`.
- the paused-active branch (344-346) → unchanged apart from `leadSeconds: null`; a paused break has no meaningful lead.
- the future-start branch (348) → `return { phase: "preparing", seconds: null, blocksEntry: true, leadSeconds: Math.ceil((startsAt - input.serverNowMs) / 1_000) };`
- the final `active` / `ending` return (350) → add `leadSeconds: null`.

`leadSeconds` is null in every branch except rule 3, so no consumer can accidentally treat a stale value as a live countdown.

### 4.5 TS — plumb the authored value into both derivations

`useSatExamController.ts`

```ts
// Memoized: a fresh object every render would retrigger the pull effect's
// cleanup and cancel the in-flight loop (§4.6).
const authoredBreak = useMemo(
  () => (data && pendingModule ? satPendingAuthoredBreak(data, pendingModule.id) : null),
  [data, pendingModule],
);
const authoredBreakSeconds = authoredBreak?.seconds ?? 0;
const authoredSectionId = authoredBreak?.sectionId ?? null;

const breakWindow = satBreakWindow({
  timingModel: effectiveTiming?.timingModel,
  personalBreak,
  serverNowMs: now + serverClockOffsetMs,
  sharedSeconds: …,
  authoredBreakSeconds,
});
```

`SatTemporalModel` gains `authoredBreakSeconds: number`; `deriveSatTemporalSnapshot` passes it to the same function; the `temporalModel` memo (1854-1875) includes it in the value and the dependency list. A primitive keeps the memo stable when `data` does not change.

`deriveSatStudentStage` needs no change: it already maps `preparing` → `preparing` and keeps the same presence key `break:${attemptKey}:${sectionKey}`, so the surface does not remount.

### 4.6 TS — bounded boundary pull

`useSatExamController.ts`, next to the break-end pull refs (≈1553):

```ts
const boundaryPullRef = useRef<string | null>(null);

useEffect(() => {
  const key = pendingModule ? `${attemptId}:${pendingModule.id}` : null;
  if (
    !key ||
    !breakSurfaceMounted ||
    data?.scheduleRuntimeStatus !== "live" ||
    personalBreak ||                      // row known: nothing to pull
    authoredSectionId === null ||         // no authored break: nothing will appear
    pendingAttempt?.state !== "not_started" ||
    boundaryPullRef.current === key       // one loop per boundary
  ) return;
  boundaryPullRef.current = key;
  const generation = identityGenerationRef.current;
  let cancelled = false;
  let reads = 0;
  let timer = 0;
  const tick = async () => {
    if (cancelled || identityGenerationRef.current !== generation) return;
    reads += 1;
    await refresh(false);
    if (cancelled || identityGenerationRef.current !== generation) return;
    const row = dataRef.current?.attempt.personalBreaks?.some(
      (candidate) => candidate.afterSectionId === authoredSectionId,
    );
    if (row || reads >= SAT_BOUNDARY_PULL_MAX_READS) return;
    timer = window.setTimeout(tick, SAT_BOUNDARY_PULL_INTERVAL_MS);
  };
  void tick();
  return () => { cancelled = true; window.clearTimeout(timer); };
}, [attemptId, authoredSectionId, breakSurfaceMounted, data?.scheduleRuntimeStatus,
    identityKey, pendingAttempt?.state, pendingModule?.id, personalBreak, refresh]);
```

Constants beside the existing ones (≈131): `SAT_BOUNDARY_PULL_INTERVAL_MS = 2_000`, `SAT_BOUNDARY_PULL_MAX_READS = 5` (≤10 s, strictly less than the 20 s offline cadence and shorter than the 60 s live cadence).

Termination is the row appearing (the effect's deps change because `personalBreak` becomes non-null) or the read budget. `boundaryPullRef` prevents a second loop for the same boundary after a transient identity-preserving re-render.

Two properties worth stating because they are easy to get wrong:

- The effect's dependency list uses the **primitives** `authoredSectionId` / `pendingModule?.id`, never the selector's object. If it depended on the object, every render would run the cleanup, cancel the pending timer, and then hit the `boundaryPullRef` guard on the next run — the loop would die after one read instead of finishing its budget.
- The loop never re-reads the selector; it compares `afterSectionId` against the id it started with. A stale closure therefore cannot switch boundaries mid-loop, and `identityGenerationRef` stops it across attempt rotation.

### 4.7 TS — optional lead countdown (P1)

`SatScheduledBreakScreen.tsx`: when the phase is `preparing` and `temporal.breakWindow.leadSeconds > 0`, render that in the existing reserved slot and keep the headline. No new element, no layout shift. This removes the "blank timer for 3 s" moment that reads as frozen.

### 4.8 Telemetry (P2, optional but recommended)

- Client, at the close-ack commit: `sat_break_boundary_ready` with the existing `latencyMs` dimension = `Date.now() - boundaryStartedAt`, where `boundaryStartedAt` is captured when `closeTimedOutModule` starts.
- Client, in the pull loop: `sat_break_boundary_pull` with `reason` = `hit` | `exhausted`.
- Server: a counter for ERR-1 (`sat_close_ack_breaks_read_total{outcome=ok|error}`), which requires the three usual edits in `internal/platform/telemetry/telemetry.go` (const, description map, allow-list at ≈494). If that registry churn is unwanted, `slog.WarnContext` alone is acceptable for the first ship.

## 5. Algorithm and control flow

Happy path (timeout close, §7 walkthrough):

```
browser: personal clock hits 0
  -> closeTimedOutModule(moduleId, moduleAttemptId)
  -> POST /modules/close { moduleId, moduleAttemptId, closeId, answers }
server: tx
  -> lock module, verify deadline, score
  -> finalize; route follow-up:
       createPersonalBreakTx(rwSection, 600)      // state='pending', revision 0
       insertModuleAttemptTx(mathM1, available_at=NULL)
  -> closeAck: projection + loadPersonalBreaks(attempt)   // NEW
  -> lifecycle.Store(ack) ; commit
browser:
  -> applyCloseAck: moduleAttempts replaced, personalBreaks = [pending 600s]  // FIX
  -> satOpenPersonalBreak -> row
  -> satBreakWindow -> preparing, blocksEntry
  -> stage = scheduled-break/preparing  ("Preparing your break…")
  -> useSatBreakEntry (surface mounted, visible):
       decideSatBreakEntryStep -> arm
       -> POST /break/start -> Bootstrap{state:'armed', entryStartsAt = now+3s}
       commit -> decide -> confirm
       -> POST /break/enter -> Bootstrap{state:'active', startsAt, deadlineAt}
       -> preparing with leadSeconds 3, then active
  -> countdown to deadline
  -> temporal boundary personal-break-end -> pull until state='completed'
  -> completeDuePersonalBreaksTx sets Math available_at = deadline
  -> useSatModuleEntry starts Math (server-driven) or explicit entry
```

Failure branches, each with one owner:

| Case | Behaviour | Enforced in |
| --- | --- | --- |
| Break projection read fails in `closeAck` | Ack returns without breaks, warn log; client stays `preparing` and pulls | `close_ack` (ERR-1) + `useSatExamController` pull (FR-4) |
| Close response lost after commit | Retry with the same `closeId` returns the stored ack (with the break); the pull covers the gap until then | `lifecycle.Store` + pull |
| Background reconciler closes the module first | Client close returns `alreadyClosed` with a freshly built projection that includes the break row | `closeAck` (single builder) |
| Old server, new client | `personalBreaks` undefined → merge keeps the old value; `authoredBreakSeconds > 0` keeps the screen in `preparing` while the pull (≤10 s) recovers | `applyCloseAck` guard, FR-3 |
| New server, old client | Extra JSON field ignored | — |
| Break never arrives (server fault) | Surface stays `preparing` (honest), steady poll continues; the student is never told the break is over | RULE-2 |
| Attempt paused during `preparing` | `useSatBreakEntry.enabled` false; resume brings a fresh projection | unchanged |
| Identity rotation mid-pull | `cancelled` + generation check stop the loop; new identity starts its own | pull effect |
| Duplicate close ack applied | Idempotent merge; no second break row | INV-2 |

## 6. Concrete implementation sequence

Each step is independently testable and reversible.

1. **Go ack** — `close_module.go`: struct field, read, warn path; `close_module_test.go`: add the sqlmock expectation for `SELECT id, after_section_id, duration_seconds … FROM assessment_attempt_breaks` to the existing `closeAck` test and assert the field. *(This step alone makes the payload correct.)*
2. **TS contract + merge** — `assessmentDelivery.ts`, `satEntryAck.ts`; new unit tests in `application/__tests__/satEntryAck.test.ts` (create if absent).
3. **Selector** — `satRuntimeSelectors.ts` + `application/__tests__/satRuntimeSelectors.test.ts`.
4. **Window** — `satTimingPolicy.ts` + existing policy tests; then `satTemporalModel.ts` and the controller memo (compile-driven, both call sites must pass the new input).
5. **Pull loop** — `useSatExamController.ts`; new hook test.
6. **Lead countdown (P1)** — `SatScheduledBreakScreen.tsx` + route test.
7. **Telemetry (P2)** — controller metric, optional server counter.
8. **Docs** — update `docs/sat_break.md` with the close-ack contract and the "preparing vs ending" distinction.

Compatibility: server first, client second. The client change is a no-op against an old server (undefined field, plus a bounded pull that only runs where the break surface already exists).

## 7. Worked trace

Normal path, socket down (the reported case):

| Step | Authoritative state | Browser |
| --- | --- | --- |
| 0 | RW M2 `active`, no break rows | exam, 0:04 left |
| 1 | 0:00 | `onTemporalBoundary("expiry")` → close |
| 2 | tx: RW `locked`, Math M1 `not_started(available_at NULL)`, break `pending` rev 0 | request in flight |
| 3 | ack `{moduleAttempts[…], personalBreaks:[pending]}` | `applyCloseAck` → stage `break/preparing` |
| 4 | break `pending` | surface mounted → arm `POST /break/start` |
| 5 | break `armed` rev 1, `entryStartsAt = T+3s` | confirm `POST /break/enter` |
| 6 | break `active` rev 2, `startsAt = T+3s`, `deadlineAt = startsAt+600` | `preparing` (lead 3) → `active` |
| 7 | break `active` | countdown to deadline, no further reads needed |
| 8 | deadline passes | `personal-break-end` → pull |
| 9 | `completeDuePersonalBreaksTx`: break `completed` rev 3, Math `available_at = deadline` | `ending` → Math M1 opens |

Adversarial path, reconciler wins the close race and the socket is down:

| Step | State | Browser |
| --- | --- | --- |
| 1 | RW `locked` by reconciler, break `pending` created | still on the 0:00 exam frame |
| 2 | — | close request returns `alreadyClosed: true` + `personalBreaks:[pending]` |
| 3 | — | same as step 4 above; total added latency = one request |

Assertion for the implementation: in both traces the number of `bootstrap` (lifecycle) reads between steps 3 and 6 is **zero**.

## 8. Verification

### 8.1 Test matrix

| # | Layer / file | Assertion |
| --- | --- | --- |
| 1 | Go unit `internal/delivery/close_module_test.go` | `closeAck` returns the pending break (`state`, `afterSectionId`, `durationSeconds`, `revision`) alongside the existing module rows |
| 2 | Go unit | Break read error → `ack` non-nil, `PersonalBreaks` empty (not nil in JSON), no error returned |
| 3 | Go unit | `alreadyClosed` build (fresh id) still returns the current break row |
| 4 | Go unit | Same-section close (Math M1→M2) returns the full list including a previously completed RW break |
| 5 | MySQL integration `cmd/api` (`TEST_MYSQL_DSN`) | Close RW at the boundary → response JSON `personalBreaks[0].state == "pending"`, `afterSectionId == rw section`, `durationSeconds == break_after_seconds`; exactly one row for the attempt |
| 6 | TS unit `satEntryAck` | Replace when array; preserve when `undefined`; `null` treated as absent; mismatched attempt still `null` |
| 7 | TS unit `satRuntimeSelectors` | Authored 600 s + no row → 600; row exists (any state) → 0; same-section handoff → 0; first module → 0; `breakAfterSeconds: 0` → 0 |
| 8 | TS unit `satTimingPolicy` | No row + authored → `preparing`/`blocksEntry`; completed row + authored input 0 → `none`; `active` future start → `preparing` with `leadSeconds`; unchanged cohort branches |
| 9 | TS unit `satStudentSurface` | `preparing` → `preparing` (same key); `none` → `ending` |
| 10 | Hook `useSatExamController` **(the regression test)** | Close ack with a `pending` break → `startBreak` called with that id, surface phase `preparing`, and **no** additional `bootstrap` call. Fails on today's code. |
| 11 | Hook | Pull: break appears on read 2 → loop stops, ≤5 reads; no loop when `breakAfterSeconds === 0`, when a row exists, or when the runtime is not live |
| 12 | Route `SatStudentSessionRoute.between-sections.test.tsx` | Existing "holds the same break surface … Preparing Math…" (fixture `breakAfterSeconds: 0`) still passes; new case: `breakAfterSeconds: 600`, no row → "Preparing your break…", no timer, no button; new case: completed row → "Preparing Math…" |
| 13 | Regression | `SatStudentSessionRoute.moduleHandoff`, `satPersonalEntry`, `useSatExamController.adaptiveHandoff`, `sat-recovery-poll` unchanged and green |

Commands:

```bash
cd backend/go && go test ./internal/delivery -run 'TestCloseAck|TestPersonal'
cd backend/go && TEST_MYSQL_DSN=… go test ./cmd/api -run 'TestSATPersonalBreak|TestSectionForm'
bunx vitest run src/features/student-delivery/application src/features/student-delivery/hooks
bun run typecheck && bun run lint
```

### 8.2 Existing tests that must be touched

- `backend/go/internal/delivery/close_module_test.go:50` — the `closeAck` call now issues one more query; add the expectation or the test fails on sqlmock ordering.
- `src/features/student-delivery/routes/__tests__/SatStudentSessionRoute.between-sections.test.tsx:427-441` — must keep passing unchanged (it uses `breakAfterSeconds: 0`, so the authored fallback does not apply). If it starts failing, the selector is too broad.

### 8.3 Manual runbook (order matters)

1. Inspect one close response by hand (`devtools` or curl) with the current build. Record whether `personalBreaks` is present. This splits "server payload" from "socket transport" before any code changes.
2. Apply steps 1–5. Run the flow with `VITE_STUDENT_REALTIME=poll`. Expected: "Preparing your break…" immediately after 0:00, counted break within ~3 s, and **zero** lifecycle `bootstrap` calls between the close ack and the arm.
3. Repeat with `VITE_STUDENT_REALTIME=websocket`. Expected: identical timings; `liveSocketConnected` may be `true` but the break no longer depends on it.
4. Repeat with the network throttled to offline for 5 s around 0:00. Expected: the close fails, the reconciler closes the module, and either the retry's `alreadyClosed` ack or the pull delivers the break within ~4 s.
5. Confirm the break runs the full authored duration (the countdown starts at `durationSeconds`, not at `durationSeconds − elapsed`).

## 9. Extensibility and remaining risks

**Extension probe 1 — a second scheduled break (e.g. after Math Module 1).** The ack field is already a list; the selector is keyed by `afterSectionId`; the pull key includes the module id; `uq_attempt_break_section` already permits one row per boundary. No structural change, only the authored data.

**Extension probe 2 — a cohort break reaching the same surface.** `satBreakWindow` returns early for non-personal models, so the new input is inert there. If cohort breaks ever need the same treatment, the change is one branch inside the same function, not a second derivation.

**Extension probe 3 — reopening the break after a proctor re-arm.** `revision`-carrying rows and `entryGeneration` already exist; the close ack is not involved.

Risks and mitigations:

- **Close latency**: one indexed read inside an existing transaction. If the close endpoint has a p99 budget, verify with the existing `sat_module_close` telemetry before and after.
- **Payload growth**: ≤1 row.
- **Stale ack replay**: the stored-ack path can only be replayed for the same `closeId`, and the break cannot advance before that ack is applied; wholesale replacement is therefore safe. The pull and the steady poll are the recovery if the assumption is ever violated.
- **`preparing` blocking entry**: intentional and consistent with the server, which does not set Math's `available_at` until the break completes. If a future change allows entry before break completion, `blocksEntry` is the single place to revisit.
- **Unknown**: whether the reporting environment's socket is misconfigured. This plan removes the dependency for the boundary but does not diagnose the transport; a separate check of `student_ws_connect_success` and the proxy `/api/v1/ws/live` route is still worthwhile.
