# SAT Room Scores — Edge-Case Fix Plan (from business-logic audit)

**Date:** 2026-11-03
**Source audit:** business-logic-edge-case-auditor on zero-click scores (room roster + `useRoomScores` + proctor projection)
**Mode:** low-level-implementation-engineer `plan` — no source edits in this doc
**Prior plan:** `docs/plans/2026-11-03-sat-room-zero-click-scores.md` (functional BE/FE + polish, R-gated PASS with labeled gaps)

---

## 1. Change boundary & repository evidence

### Current behavior (Verified)

* FE join: `src/products/sat/ui/useRoomScores.ts:232-281` — `useRoomScores(scheduleId, examId, sessions)` calls `useSatAttemptsQuery(examId, scheduleId, 0, '', 'all', {})` (hardcoded `offset 0`, default `limit:50` in `src/features/results/api/satResultsQueries.ts:164-178`), builds `rowsByAttempt` first-wins (`useRoomScores.ts:246-252`), then `resolveRoomScore(session, row)` (`:70-191`).
* View-model: `resolveRoomScore` (`:70-191`), `finiteCount` (`:38-40`), `normalizeModules` (`:42-56`), `shortModuleLabel` (`:58-63`), `isSameRoomScore` (`:199-225`).
* Sort: `src/products/sat/ui/SatSessionRoomRoster.tsx:40-64` — `compareScore` ranks `correct!=null` first in both directions, tie → `byName`; `holdOrder` anti-jitter (`:124-142`).
* BE projection: `backend/go/internal/proctor/sessions.go` — `StudentSessionSummary` score keys (`:305-316`, all `omitempty`), `loadScoreOutcomes` fenced on `terminal_generation` (`:1395-1424`), `scoreOutcomeSeverity` (`:1426-1437`: invalidated 3 > scored 2 > pending 1 > default 0), `buildScoreProjections` (`:1451-1590`, only `invalidated_proctor|timeout → not_scored` at `:1552-1558`), `scoreReadQuerier` repeatable-read + fallback (`:1597-1609`), `loadScoreProjections` best-effort nil-on-error (`:1616-1631`), `applyScoreProjection` (`:1635-1648`).
* Tests (Verified): `session_projection_score_test.go:197-218` (invalidated only covers the two `invalidated_*`, not `unscored`); `useRoomScores.test.tsx`, `SatSessionRoomStudents.test.tsx` (29+11+ suites green per R gate).

### Desired behavior (audit fixes, smallest maintainable delta)

1. Rooms >50 show scores for **all** visible students (no silent dash).
2. `outcome_status='unscored'` projects `not_scored` on **both** wire and UI (no divergence).
3. Module split labels never misfire on non-SAT keys.
4. Corrupt/degenerate counts (`answered>total`, `total=0`, missing plan, `ended`-without-submit) have one defined badge each, never a zero flash, with a repair signal where appropriate.
5. Stale age is truthful without a per-second ticker storm; View-answers predicate is single-sourced.

### Non-goals

* No new endpoints, no migrations, no grading/conversion changes, no key/verdict in proctor payloads, no auth model change (`requireSessionReader` stays).
* No E2E seeding infra in this plan (R gate already labels it); unit+integration+contract only.

---

## 2. Requirements & invariants

* `FR-1` Teacher sees `correct/total + pct + M1/M2 split + unanswered` zero-click for **every** roster row, regardless of room size.
  * Accept: 51-attempt room (page1 50 + page2 1, `hasMore`) renders 51/51 badges; 51st is `scored` when its result is scored.
* `RULE-1` Key/correct-choice text never appears in proctor payloads or roster DOM (unchanged, regression-guarded).
* `RULE-2` `invalidated_proctor | invalidated_timeout | unscored` → `not_scored`, `correct=null`, module `Correct=nil`, never `0/total`.
  * Accept: BE unit with each of the three outcomes asserts `status==not_scored`, `correct==nil`, per-module `Correct==nil`, `total` preserved.
* `RULE-3` `NULL` (unknown/ungraded) ≠ `0` (graded zero); `total<=0` never yields `0/0` or `NaN%`.
  * Accept: `total=0` → dash/scoring path, `pct=null`, no `NaN`; `correct=0,total=27` → `✓ 0/27 · 0%`.
* `RULE-4` Pretest excluded from every sum (unchanged).
* `RULE-5` Totals and correctness cover the **same scoped module set** (`pct≤100%`), including flexible M1-only rooms once defined (see SPEC-1).
* `ERR-1` Results join failure → keep last values + dim (`isStale`), never flash zero (unchanged).
* `ERR-2` Corrupt counts (`answered>total`) → defined `Scoring…` badge + repair signal, never negative `left`.
* `SCOPE`: F1 pagination loop, F2 status mapping, F3 label anchoring, F4 corrupt/degenerate badges, F5 View-link predicate convergence, F6 stale-age truthfulness. Excludes: new API, new tables, E2E seeding.
* `INV-01` No key material in proctor path (owner: BE `buildScoreProjections` + FE `resolveRoomScore` comment).
* `INV-02` NULL≠0 (owner: FE `finiteCount` + BE nil-correct discipline).
* `INV-03` Invalidated/unscored terminal (owner: BE outcomes + FE `invalidated` set — must match after F2).
* `INV-05` Join key `attemptId` (owner: `useRoomScores`; `session.id` IS `attemptId`).
* `INV-06` No silent omission by room size (owner: `useRoomScores` pagination; currently VIOLATED → F1).
* `INV-07` Same-scope sums (owner: BE `counted()` + FE fallback rule; SPEC-1 resolves M1-only).

---

## 3. Entities, ownership & relationships

| Unit | Responsibility | State (auth vs derived) | Lifecycle |
|---|---|---|---|
| `results` service (BE, existing) | Owns correctness + `outcome_status` | `assessment_results` (auth) | `pending → scored | invalidated_* | unscored` terminal |
| `proctor` score roll-up (BE) | Owns live projection counts only | Derived read: module seal + `raw_correct` + `COUNT(DISTINCT answered)` + outcomes (read-only txn) | Never transitions attempts; `unstarted→answering→scoring→scored | not_scored` |
| `useRoomScores` (FE) | Owns join + view-model, never grades | Derived memoized `Map<attemptId,RoomScore>` | `dash→answering→scoring→scored | not_scored` (mirrors BE; `invalidated` forces `not_scored`) |
| `SatRoomStudentRow` (FE) | Renders `RoomScore` only | Props only | Pure |
| `monitoringSchemas` + `StudentSession` | Contract (additive optional) | Wire → type | Backward compatible |

Transition table (projection):

| Current | Event/guard | Next | Owner | Side effect |
|---|---|---|---|---|
| answering | all counted sealed+scored | scored | BE `buildScoreProjections` | `correct=sum`, modules filled |
| answering/scoring | outcome invalidated_*/unscored | not_scored | BE + FE (must agree post-F2) | `correct=nil`, modules `Correct=nil` |
| any | load error | keep last (FE dim) | FE `isStale` | no flash |
| scored | duplicate poll same facts | scored (same identity) | FE `isSameRoomScore` | no re-render |

---

## 4. Exact function-level design

### F1. Paginate the results join (fixes BUG-001, INV-06)

```text
Location: src/products/sat/ui/useRoomScores.ts :: useRoomScores (Verified :232-281) + src/features/results/api/satResultsQueries.ts :: useSatAttemptsQuery (Verified :164-178)
Owns: completeness of rowsByAttempt for the visible schedule
Reads: examId, scheduleId; existing page shape {items, total, offset, limit, hasMore}
Writes: none (query cache only); returns same {byAttempt, isStale, isLoading, updatedAt}
Signature: no public signature change. Internal: fetch all pages (offset loop) OR single bounded fetch with explicit limit+total guard.
Preconditions: scheduleId non-empty; examId may be null (then BE-only + dash fallback preserved)
Postconditions: byAttempt contains every attemptId in schedule (or explicit truncated flag + UI note if server caps)
Error contract: page failure → existing isStale dim path (keep last); partial pages → keep accumulated + stale (never partial-zero)
Invariant enforcement: join still by attemptId; first-wins dedup kept, but overlapping pages prefer severity-wins like BE (scored > pending) OR last-wins documented — pick one, test it
Callers: SatSessionRoomRoute unchanged (same hook return; add optional truncated flag only if server caps)
```

Design choice (do not reopen without contradiction): sequential offset loop in the hook (`offset += limit` until `!hasMore` or `items.length < limit`), `staleTime` inherited, `enabled` same. Alternative — new BE bulk field — rejected: larger change, same freshness. Cap: stop after N pages (e.g. 10 × 50 = 500) with `truncated=true` + roster footnote rather than unbounded fetch (real rooms are tens, not thousands).

### F2. Map `unscored` → `not_scored` on the wire (fixes BUG-02, INV-03)

```text
Location: backend/go/internal/proctor/sessions.go :: buildScoreProjections case at :1552-1554 (Verified) + scoreOutcomeSeverity at :1426-1437 (Verified)
Owns: terminal-outcome mapping
Reads: outcomes[id] (already fenced on terminal_generation)
Writes: proj.status, proj.correct=nil, modules Correct=nil (existing pattern)
Signature: no signature change
Preconditions: outcome string from assessment_results.outcome_status
Postconditions: outcomes invalidated_proctor|invalidated_timeout|unscored → status not_scored, correct nil, per-module Correct nil, total preserved
Error contract: unknown outcome → existing default (answering/scoring path), never not_scored by accident
Invariant enforcement: severity already ranks invalidated highest; add unscored to the not_scored case (severity 3 group or explicit case)
Callers: GetSessionDetail unchanged; FE invalidated set already includes unscored (useRoomScores.ts:91-93) — now matches
```

### F3. Anchor module-split labels (cosmetic correctness)

```text
Location: src/products/sat/ui/useRoomScores.ts :: shortModuleLabel (Verified :58-63)
Owns: display abbreviation only (never routing)
Reads: moduleKey string
Writes: none
Signature: shortModuleLabel(moduleKey: string) -> string (unchanged)
Preconditions: any string (custom keys possible)
Postconditions: 'M1' only for /(^|[-_])m1$/i or m1-higher/lower variants already in repo vocabulary; 'M2' only for /(^|[-_])m2([-_]|$)/i incl. -lower/-higher; else raw moduleKey (truncated by caller)
Error contract: never throws on empty/odd keys
Callers: label + srLabel paths unchanged
```

Drop the two `includes('m1'/'m2')` fallbacks; keep explicit branch-label logic consistent with `SatQuestionResponseTable.tsx branchLabel` (`-m1 → Base`, `-m2-higher → Higher`, `-m2-lower → Lower`).

### F4. Corrupt/degenerate counts → defined badges

```text
Location: src/products/sat/ui/useRoomScores.ts :: resolveRoomScore (Verified :70-191)
Owns: badge kind selection (no grading)
Reads: beAnswered/beTotal/beCorrect/beStatus + rowCorrect/rowTotal/outcomeStatus/attemptStatus + satStartState
Writes: RoomScore {kind,label,srLabel,...} (same shape)
Signature: unchanged
Preconditions: counts are finiteCount-filtered (>=0) or null
Postconditions:
 - answered>total → kind scoring (or answering if never submitted), leftPart suppressed (existing), plus returned modules unchanged; caller (row) may surface repair note — minimal: keep badge, add telemetry/log hook TODO if no telemetry in FE (do not invent pipeline)
 - total==0 (or null after >0 guard) → never scored; dash if unstarted else scoring
 - ended without submit (attemptStatus ended, no answered/total, no outcome) → answering "Answering…" (not dash) — requires SPEC decision below; implement behind named const so rule change is one line
Error contract: never NaN pct (existing total>0 guard kept)
```

### F5. Converge View-answers predicate (cross-feature consistency)

```text
Location: src/products/sat/ui/SatSessionRoomStudents.tsx :: StudentScoreSummary link block (Verified ~:505-516: resultId ? 'View answers' : 'View saved answers') vs src/products/sat/routes/SatExamGroupSection.tsx:237 (outcomeStatus==scored ? ... )
Owns: link labeling
Reads: score.resultId, score.hasSavedAnswers + row outcomeStatus (already in RoomScore? has resultId + kind; add outcomeStatus to RoomScore or pass through — smallest: derive from kind: scored→'View answers' else 'View saved answers' when hasSavedAnswers)
Writes: link label/href only
Signature: no route change; href pattern ?from=room&scheduleId&studentId kept
Preconditions: link renders only when resultId||hasSavedAnswers (existing)
Postconditions: pending + resultId (or saved answers, unscored) → 'View saved answers'; scored → 'View answers' — both routes agree
```

### F6. Truthful stale age without ticker storm

```text
Location: src/products/sat/ui/SatSessionRoomRoster.tsx :: scoresAgeLabel (Verified :68-74) + scoresUpdatedAt plumbing
Owns: age text
Reads: updatedAt (dataUpdatedAt)
Writes: text only
Signature: unchanged
Preconditions: updatedAt may be 0/NaN → null (existing)
Postconditions: age buckets coarsened (just now / Xs ago / Xm ago — existing) + 30s interval refresh of ONLY the age line (not the list), or document render-time staleness as accepted (polish agent noted suggestion). Pick ticker-scoped-to-footer to avoid list re-render (do not put Date.now() in sort memo deps).
```

---

## 5. Algorithm / control flow

### Happy path (51 scored attempts)

```text
1. Room mounts → useRoomScores(schedule, exam, sessions[51]).
2. Loop offset 0,50,... until !hasMore (F1): pages merged by attemptId (severity-wins on dup).
3. For each session: resolveRoomScore(BE ?? row) → scored ✓ c/t·pct·M1/M2·left.
4. sortRoster(score_desc) ranks by correct, ties byName; holdOrder prevents jump.
5. Inspector link: kind==scored → 'View answers'; else hasSavedAnswers → 'View saved answers'; else hidden.
Final: 51/51 badges, INV-06 holds, INV-02/03/07 hold.
```

### Failure branches

* Page 2 fails → keep pages 0..1 + `isStale=true` + dim + `Updated Xs ago`; badges never zero. Enforcement: accumulated map + error flag (not throw).
* BE `unscored` (post-F2) → `not_scored`, correct nil. FE `unscored` → same. Agreement test asserts both.
* `answered(30)>total(27)` → `scoring` (or `answering`), `leftPart=null`, no negative; room keeps badge; follow-up repair job reads server counts (out of scope, flagged).
* `total=0` → `total=null` → dash/scoring, `pct=null`.
* `ended` + no counts + no outcome → `answering…` (SPEC-3 decision encoded as const `ENDED_WITHOUT_SUBMIT_KIND='answering'`).

---

## 6. Concrete implementation sequence (disjoint, sub-agent-ready)

**Agent A — FE join + labels (F1, F3, F4-part, F5, F6):**

1. `src/features/results/api/satResultsQueries.ts` — confirm `limit/hasMore` contract (read; no change unless cap needed).
2. `src/products/sat/ui/useRoomScores.ts` — add page loop + `truncated` (optional) + anchored `shortModuleLabel` + `answered>total`/`total==0`/`ended` branches (one const per rule).
3. `src/products/sat/ui/SatSessionRoomRoster.tsx` — footer ticker scope (age line only) if chosen; else no change.
4. `src/products/sat/ui/SatSessionRoomStudents.tsx` — View-link predicate from `kind` (F5).
5. Tests first (TDD): `useRoomScores.test.tsx` (+51-page join, +unscored-via-row, +label anchors, +corrupt/degenerate table), `SatSessionRoomRoster` sort/stale tests extend.

**Agent B — BE status mapping (F2) + contract proof:**

1. `backend/go/internal/proctor/sessions.go` — extend `:1552` case with `"unscored"` (keep severity or bump to 3-group; one-line + comment).
2. `backend/go/internal/proctor/session_projection_score_test.go` — extend `TestBuildScoreProjectionsInvalidatedIsNotScored` with `"unscored"` (+ wire-apply test asserting `ScoreStatus/Min` nil-correct).
3. Run: `GOCACHE=/tmp/gocache-proctor go test ./internal/proctor/ -run 'Score|AttemptRowToSession' -v` + full package + `go vet`.

**Dependencies:** A and B independent (FE `invalidated` set already covers `unscored`, so UI is correct before/after B; B only fixes wire consumers). Contract meeting point: `ScoreStatus=="not_scored" ⟺ outcome in {invalidated_proctor, invalidated_timeout, unscored}`.

---

## 7. Worked trace

```text
Initial: schedule S (RW-only, plan total 27), attempts A1..A51 scored 18/27 (M1 9/13 M2 9/14, answered 25), A52 ended-no-submit, A53 outcome unscored (sealed 9/13 present).
1. A: GET attempts offset0 limit50 → 50 rows hasMore=true; offset50 → 1 row hasMore=false; merged 51 (F1). A52/A53 have no result rows.
2. B: outcomes {A53: unscored} → not_scored correct nil (F2); A52 no outcome → BE answering (answered 0?).
3. FE: A1..A51 scored ✓ 18/27·67%·M1 9/13 M2 9/14·2 left; A52 answering… (SPEC-3); A53 Not scored (both layers agree).
4. Adversarial: page offset50 fails → keep 50 + stale dim; A51 shows last-known (not dash-zero); next poll heals. answered(30)>total(27) injection → scoring, left suppressed, no negative.
Final: INV-01/02/03/05/06/07 hold; no key bytes (R1 grep).
```

---

## 8. Verification

```bash
# FE
bun run typecheck
bunx eslint src/products/sat/ui/useRoomScores.ts src/products/sat/ui/SatSessionRoomRoster.tsx src/products/sat/ui/SatSessionRoomStudents.tsx
bunx vitest run src/products/sat/ui/__tests__/useRoomScores.test.tsx src/products/sat/ui/__tests__/SatSessionRoomStudents.test.tsx src/products/sat/ui/__tests__/satSessionRoomCss.test.ts src/products/sat/routes/__tests__/SatSessionRoomRoute.test.tsx src/features/proctor
# BE (GOCACHE required in sandbox)
GOCACHE=/tmp/gocache-proctor go vet ./internal/proctor/
GOCACHE=/tmp/gocache-proctor go test ./internal/proctor/ -run 'TestAttemptRowToSession|TestStudentSessionColumns|Score' -v
GOCACHE=/tmp/gocache-proctor go test ./internal/proctor/ ./cmd/api/ -run 'TestSatRooms|TestSATClassroom' -v # unit parts; MySQL variants SKIP without TEST_MYSQL_DSN
# Contract (R1 re-run)
rg -n 'correctAnswer|isCorrect' backend/go/internal/proctor || true   # expect only NeverEmitsKeyMaterial asserts
rg -n 'hideKeyAndResult' src/products/sat | head
```

| Test class | Evidence |
|---|---|
| Unit | F1 51-page join; F2 three-outcome not_scored; F3 anchor table (`exam-m10`≠M1); F4 corrupt/zero/ended table; pct bounds |
| Integration | BE MySQL `TestScoreProjectionMySQL` extend with `unscored` row (gated on DB, like existing) |
| Contract | `monitoringSchemas` still loose; `StudentSession` additive; View-label parity room vs group-section |
| Concurrency | Existing revision-fence + severity last-wins; no new threads (read-only + poll merge deterministic) |
| Regression | Full `SatSessionRoom*` + `src/features/proctor` + `satResults*` suites; pre-existing catalog/legacy failures remain out-of-scope (do not fix here) |
| E2E | Not in this plan (no seeded backend); hook-level matrix above is the gate |

---

## 9. Extensibility & remaining risks

* **Extension probe (Math section):** `RoomScore.modules[]` already per-module; M1-only vs full-SAT changes only `counted()` scope + `shortModuleLabel` anchors. Callers, wire shape, and sort stay untouched — add `sectionKey` to `ScoreModuleProjection` only if RW/Math split badges diverge.
* **SPEC-1 (M1-only total):** BE sums taken modules; FE `rawTotal` is classroom total. One Rank-4-Mock-1 row dump (`ScoreTotal == SatAttemptRow.rawTotal`?) decides the denominator owner. Until then F1 uses `beTotal ?? rowTotal` (documented first-wins).
* **SPEC-2 (answered>total):** badge defined, root-cause repair (regrade/backfill) out of scope; add counter/log hook if FE gains telemetry.
* **SPEC-3 (ended-without-submit):** implemented as `answering…` const; product can flip to `Not scored` in one line pending teacher-research.
* **Rollout:** FE-first safe (dashes/skeletons where capped); BE one-line mapping safe rolling (FE already masks); no migration to roll back.
* **Unknowns:** `unscored` persistence shape (assumed `outcome_status` string like others — one dump confirms); server page cap policy (assume 50/offset stable — one live `hasMore` walk confirms).

---

## Self-review (skill gate)

* Inspected owning functions + callers/writers (useRoomScores, sortRoster, buildScoreProjections, loadScoreOutcomes, View-link both sites) — yes, with line refs.
* Preserved contracts (additive wire, loose zod, same hook return + optional truncated) — yes.
* State+behavior co-owned (projection owns counts, hook owns join, row owns render) — yes, no new owners.
* Rules server-side where authoritative (terminal mapping BE, join fallback FE) — yes.
* Pre/post/errors/terminal precise per function — yes (§4).
* Duplicate/stale/partial covered (page-fail stale, severity-wins, best-effort nil, identity-reuse) — yes.
* No new class/abstraction/cache/queue/lock — yes (loop + case + regex anchors only).
* Tests exercise enforcement, not mocks — yes (§8 table).
* Verified vs assumed labeled — yes (SPEC-1/2/3, unscored dump, page-cap walk).
