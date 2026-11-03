# SAT Room Scores Round-2 — Implementation Plan (FE/BE split, E2E-first)

**Date:** 2026-11-04
**Modes:** low-level-implementation-engineer (plan only — no source edits) + e2edd (E2E-first, vertical slices)
**Inputs (normative):** `docs/plans/2026-11-03-sat-room-score-audit-round2.md` (audit §§1–11 + LLI §§LLI-1–9); prior `docs/plans/2026-11-03-sat-room-score-edge-case-fixes.md`
**Outcome:** fix the 6 CONFIRMED + 4 HIGH items; SPEC items parked unless a safe default is stated.

---

## 1. Change boundary & repository evidence

### Current behavior (Verified)

* FE join `src/products/sat/ui/useRoomScores.ts:277-307` — `useQuery(['sat-results','attempts-all',…])`, `queryFn` loops `offset 0,50,…` to `!hasMore` (cap 10×50=500, `truncated` flag), sequential `resultsGateway.get<SatAttemptPage>` per page with shared `signal`. **Mount-only: no `refetchInterval`, no focus/reconnect override** — `staleTime 30_000`, `gcTime 5*60_000`. Any page throw rejects the whole query → `data===undefined` → empty join.
* View-model `resolveRoomScore` (`:77-209`): `finiteCount` guard, `correct = beCorrect ?? rowCorrect`, `total = (beTotal ?? rowTotal) if >0`, `invalidated = proctor|timeout|unscored`, branches `not_scored → scored → scoring → answering (running|paused|ended|answered&&total) → dash`. `answered>total` degrades answering→scoring; `ended` without facts → answering (SPEC-3 const, pinned by test).
* Dedup severity-wins both layers: FE `attemptOutcomeRank` (invalidated 3 > scored 2 > pending 1); BE `scoreOutcomeSeverity` same ranking + `terminal_generation` fence (`backend/go/internal/proctor/sessions.go:1392-1424`).
* BE builder `buildScoreProjections` (`:1451-1590`): `answered` summed **before** `counted()` gate (unscoped inflation risk), `total` plain sum (zero-total yields `&0` + `scored`), terminal case covers `invalidated_proctor|timeout|unscored` (already landed).
* Roster `src/products/sat/ui/SatSessionRoomRoster.tsx:33-186,239-259`: `sortRoster`, `holdOrder`, footer `scoresAgeLabel` + 30s ticker in parent (whole-list re-render), single `role=status` announcer (scored-only), `scoresTruncated` footnote.
* Results contract `backend/go/internal/results/service.go:756-762,802,862` (Verified via audit): `limit∈(0,100] else 50`, `offset<0→0`, order `test-start DESC, submitted DESC, id DESC`, `HasMore = offset+len < total`. FE `limit=50` always valid.
* Auth: BE detail via `requireSessionReader` (Verified); room-role vs results-list `resultsRead` composition **Unknown** (one-line `table_staff.go` check).

### Desired behavior

Every visible attempt resolves fresh-or-explicitly-stale; terminal states read terminal everywhere; same-scope sums by construction; ticker footer-scoped; no silent omission.

### Non-goals (hard)

No new endpoints, no migrations, no grading/conversion changes, no key/verdict in proctor payloads, no auth-model change, additive wire only, loose zod preserved, same hook shape + optional flags only. No E2E seeding infra in this plan.

---

## 2. Requirements & invariants (E2E-first)

### E2E scenarios (write first, run last — Playwright style, mocked gateway at boundary)

```gherkin
E2E-01 fresh submit upgrades in-session:
  Given room open (16 Finished + 1 working), join fetched
  When working student submits (new scored row + resultId) and 15-30s elapse
  Then badge upgrades to ✓ correct/total, inspector offers View answers, one polite announcement

E2E-02 partial page failure keeps progress:
  Given 51-attempt room, page offset=0 ok (50 rows), page offset=50 fails
  When hook settles
  Then 50 badges render + stale dim + age line (never 0 badges)

E2E-03 traversal gap heals:
  Given submit interleaves between page 1 and page 2 (52nd row appears)
  When loop ends short of total
  Then partial/stale signal set; next 15s poll heals to 52/52

E2E-04 terminal reads terminal:
  Given attempt terminated/locked, no outcome, no counts
  When roster renders
  Then Not scored (never dash); with open answered facts → Not scored (never answering-forever)

E2E-05 same-scope sums:
  Given BE correct=9/total=nil + row 18/27
  When resolved
  Then scoring (never mixed 9/27 scored)
```

### IDs

| ID | Requirement | Acceptance |
|---|---|---|
| FR-A | Join refreshes on room cadence (BUG-001) | T-02: second fetch ≤30s; new row upgrades |
| FR-B | Page failure keeps fetched pages (BUG-002) | T-03: 50/51 + stale dim |
| FR-C | Traversal gaps detected, never silent (BUG-003) | T-04: `all.length < total` ⇒ partial + footnote; heals next poll |
| RULE-D | terminated/locked + no outcome/correct ⇒ not_scored (BUG-004) | T-05 ×2; real outcome/correct wins (regrade-safe) |
| RULE-E | `ended` has a Status reading (BUG-005 mechanical) | T-06; Score canonical parked (SPEC-04, no change) |
| RULE-G | correct+total same-sourced (H-01) | T-07; mixed ⇒ scoring |
| RULE-H | answered counted-scoped (H-02) | T-08; modules list unchanged |
| RULE-I | total≤0 never pairs with scored (H-03) | T-09 |
| PERF-F | Ticker footer-only + stale-only (BUG-006) | T-10 render-count |
| INV-06/09 | Fresh-or-explicitly-stale everywhere | FR-A+B+C |
| INV-03b | Terminal reads terminal | RULE-D |
| INV-07 | Same-scope sums | RULE-G+H |

---

## 3. Entities, ownership & relationships

| Unit | Responsibility (owners unchanged) | Change in this plan |
|---|---|---|
| `useRoomScores` (FE) | Join + view-model | +interval (F-A), +partial keep (F-B), +gap signal (F-C), +terminal branch (F-D), +same-source rule (F-G) |
| `buildScoreProjections` (BE) | Counted sums | +counted answered (F-H), +zero-total guard (F-I) |
| `SatSessionRoomRoster` (FE) | Sort/hold/age/announce | Extract `ScoresAgeLine` (F-F), invalidation announce |
| `attemptOutcome` (group section) | Status label | +`ended → Ended` (F-E) |
| No new owners/tables/endpoints | — | — |

Transition additions: `terminated|locked ∧ ¬outcome ∧ ¬correct ⇒ not_scored` (FE, precedence below any real outcome/correct); `mixed-source ⇒ scoring`; `total≤0 ⇒ scoring + total nil`.

---

## 4. Exact function-level design

**F-A. `useRoomScores` query (`useRoomScores.ts:277-307`) — Verified location.**
Owns join freshness. Reads examId/scheduleId. Writes query cache only. Signature: same return + optional `partial: boolean` (additive). Pre: same `enabled`. Post: `refetchInterval: 15_000` (matches detail 15s/8s degraded; both legs differ by ≤1 cycle); abort-safe (existing per-page `signal`; unmount handled by react-query). Error: F-B extends. Invariant: INV-06/09. Callers: route maps `partial` into existing `scoresStale` (one line).

**F-B. Same `queryFn` — partial keep.**
Per-page try/catch; on page error after ≥1 success return `{items: all, truncated, partial: true}`; page-0 error throws (existing path). Post: `isStale = isError || partial`. Display contract otherwise unchanged.

**F-C. Same `queryFn` — gap signal.**
After loop, `gap = total!=null && all.length < total` ⇒ `partial: true` (reuses F-B channel + existing stale line; no new UI). Document offset-shift limitation in comment; no cursor API per constraints.

**F-D. `resolveRoomScore` (`:77-209`) — Verified.**
New branch after `invalidated`, before `scored`: `isTerminalDelivery = attemptStatus==='terminated'||attemptStatus==='locked'`; if terminal ∧ no scored-path outcome ∧ correct==null ⇒ `not_scored` (existing label/srLabel). Precedence: any non-null correct with valid total, or outcome scored/pending+submitted, wins (regrade-safe). `attemptStatus` already in `AttemptRowInput` (Verified). Callers unchanged.

**F-E. `attemptOutcome` (`SatExamGroupSection.tsx:85-101`) — Verified.**
Add `case 'ended': return {label:'Ended', tone: satOutcomeTone('invalidated_timeout')}` mirroring `locked`. One line + T-06. Palette stays closed.

**F-F. Roster ticker (`SatSessionRoomRoster.tsx:178-186`) — Verified.**
Extract memo `ScoresAgeLine({updatedAt, visible})` owning its own 30s interval, mounted only when the stale paragraph renders. Parent drops `setScoresAgeTick`. Render-count T-10.

**F-G. `resolveRoomScore` source rule (`:91-94`) — Verified.**
Replace independent `??` with same-source: `if (beCorrect!=null) {correct=beCorrect; total=beTotal>0?beTotal:null} else {correct=rowCorrect; total=rowTotal>0?rowTotal:null}`. Mixed ⇒ scoring via existing fallthrough. MissingPlan+row becomes scoring (safe).

**F-H. `buildScoreProjections` answered (`sessions.go:1525-1542`) — Verified.**
Move `proj.answered += m.Answered` inside the `counted(key)` gate; keep `proj.modules` append outside (factual listing preserved). T-08. Wire shape unchanged.

**F-I. `buildScoreProjections` zero total (`sessions.go:1543-1551`) — Verified.**
After sum: `if total<=0 {proj.total=nil; status=scoring unless unstarted/no-facts}`. T-09. Wire `&0`→omit is narrowing-toward-omit (FE already nils 0).

**Announce extension (roster `:156-176`) — Verified.** Include `not_scored` transitions ("{name} marked not scored"), collapsed like upgrades. T-11.

---

## 5. Algorithm / control flow

```text
Happy path (51 scored, one submits mid-view):
1. Mount: pages offset 0 (50, hasMore) / 50 (1, !hasMore) → 51 merged severity-wins.
2. Badges render; 15s refetch picks up new scored row + resultId → 1 row re-renders (isSameRoomScore keeps 50 identities), one collapsed announcement, inspector link appears.
3. Terminated mid-exam → F-D not_scored before/after facts; zero-total plan → F-I scoring; mixed sources → F-G scoring.

Failure branches: page-2 500 → F-B 50 + partial → stale dim, footer age ticks; traversal gap → F-C partial → same; txn-begin fails → existing fallback (+counter D-02); unknown outcome string → default path (SPEC-02 safe default: fail-closed toward non-terminal).
```

Txn/order: no write txns; read-only repeatable attempt retained; no ordering beyond poll cadence.

---

## 6. Concrete implementation sequence — FE/BE sub-agent split (disjoint)

**Agent FE-1 — join/freshness (F-A/B/C + T-02/03/04). Files: `src/products/sat/ui/useRoomScores.ts` only, then one-line `SatSessionRoomRoute.tsx` `partial→scoresStale` mapping.**
Tests first: multi-page mocked gateway, page-2-reject keeps 50, gap `all.length<total` sets partial.

**Agent FE-2 — rules (F-D/G + T-01/05/07). Files: `useRoomScores.ts` `resolveRoomScore` hunk only.**
Sequence after FE-1 (same file, different hunks) to avoid conflicts. Includes `terminated|locked`, same-source, `0/27` boundary T-01.

**Agent BE — sums (F-H/I + T-08/09). Files: `backend/go/internal/proctor/sessions.go` builder only + `session_projection_score_test.go`.**
Independent of FE-1/FE-2 (contract: `ScoreStatus/correct/total` nil-discipline unchanged). Workdir `backend/go`, `GOCACHE=/tmp/gocache-proctor`.

**Agent FE-3 — roster/group polish (F-E/F-F/announce + T-06/10/11). Files: `SatSessionRoomRoster.tsx`, `SatSessionRoomStudents.tsx` (announce), `SatExamGroupSection.tsx`.**
Independent of FE-1/FE-2/BE. Order: FE-1 + BE + FE-3 parallel → FE-2 tail → joint contract tests (T-07 mocked, no BE dependency).

Merge rule: each agent runs its own lanes' tests before handing off; no cross-agent file writes.

---

## 7. Worked trace (happy + adversarial)

```text
Initial: sched S (RW plan 27), A1..A50 scored 18/27, A51 working (9 saved), A52 terminated-no-outcome, A53 unscored-outcome.
1. Mount pages 0/50 → 51 merged; BE: A53 not_scored, A52 answering(open facts), rest scored.
2. FE: A1..A50 ✓ 18/27·67%; A51 9/27 answered; A52 Not scored (F-D, was dash); A53 Not scored.
3. T+15s: A51 submits; page traversal shifts → F-C partial + stale; T+30s heals → A51 scored, "A51 scored 18 of 27" once.
4. Page-2 500 at T+45s → F-B keeps 51 + stale; T+60s heals. answered=30/total=27 injection → scoring, left suppressed.
Final: INV-03b/06/07/09 hold; R1 grep clean (only NeverEmitsKeyMaterial asserts).
```

---

## 8. Verification (E2E-style: scenarios first, thinnest slice that proves them)

```bash
# FE (repo root)
bun run typecheck
bunx eslint src/products/sat/ui/useRoomScores.ts src/products/sat/ui/SatSessionRoomRoster.tsx src/products/sat/ui/SatSessionRoomStudents.tsx src/products/sat/routes/SatExamGroupSection.tsx
bunx vitest run src/products/sat/ui/__tests__/useRoomScores.test.tsx src/products/sat/ui/__tests__/SatSessionRoomStudents.test.tsx src/products/sat/ui/__tests__/satSessionRoomCss.test.ts src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx src/features/proctor
# BE (workdir backend/go)
GOCACHE=/tmp/gocache-proctor go vet ./internal/proctor/
GOCACHE=/tmp/gocache-proctor go test ./internal/proctor/ -run 'TestBuildScoreProjections|TestLoadScore|TestScoreProjection|TestAttemptRowToSession' -v
GOCACHE=/tmp/gocache-proctor go test ./internal/proctor/ ./cmd/api/ -run 'TestSatRooms|TestSatClassroom' -v
# Contract
rg -n 'correctAnswer|isCorrect' backend/go/internal/proctor || true
```

| Layer | Proves |
|---|---|
| Unit (FE/BE) | T-01/05/06/07/08/09 + existing suites |
| Hook/integration | T-02/03/04 (fake timers, mocked gateway multi-page) |
| Component | T-10 render-count, T-11 announce, stale/skeleton/sort |
| Contract | zod loose unchanged; wire additive (`partial` FE-only; BE `&0`→omit matches FE nil) |
| Property | T-12: ∀ 0≤correct≤total>0, pct==round()*100, no `-`/NaN |
| Regression | Full `SatSessionRoom*`, `satResults*`, `src/features/proctor` |

E2E-01..05 map 1:1 to T-02/03/04/05/07; hook matrix is the gate (no seeded backend required).

---

## 9. Extensibility, unknowns, rollout

**Probe (Math):** `RoomScore.modules[]` per-module; F-H keeps factual listing so Math needs only `counted()` scope + label anchors. F-G transfers unchanged. Callers/wire/sort untouched.

**Unknowns (smallest checks):** BE-plan-nil frequency (prod log/dump); terminated-gradability (grading-domain answer gates BE half of H-04); scope-edit mid-session (access-link policy); room-role `resultsRead` (`table_staff.go:254`); zod unknown-enum (unit feed); `SatResultDetailRoute` unscored lines (`:111-130`).

**Rollout:** FE-first safe (interval+partial additive; F-D/G move only toward terminal/scoring, never toward scored). BE second (F-H affects out-of-scope only; F-I `&0`→omit). No migration; revert = single-hunk reverts.

---

## Sub-agent handoff

* **FE-1 prompt:** implement F-A/B/C in `useRoomScores.ts` + one-line route mapping; TDD T-02/03/04; run `bunx vitest run src/products/sat/ui/__tests__/useRoomScores.test.tsx` + `typecheck`.
* **FE-2 prompt:** implement F-D/G in `resolveRoomScore` only (after FE-1 lands); TDD T-01/05/07.
* **BE prompt (workdir `backend/go`):** implement F-H/I in `sessions.go` builder only + extend `session_projection_score_test.go` (T-08/09); run `GOCACHE=/tmp/gocache-proctor go test ./internal/proctor/ -run 'TestBuildScoreProjections|TestScoreProjection' -v`.
* **FE-3 prompt:** implement F-E (`SatExamGroupSection.tsx` one line + T-06), F-F (`ScoresAgeLine` extract + T-10), announce extension (T-11).
