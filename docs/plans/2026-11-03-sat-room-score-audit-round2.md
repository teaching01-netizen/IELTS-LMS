# SAT Room Zero-Click Scores — Audit Round 2 (Business-Logic Edge Cases + LLI Plan)

**Date:** 2026-11-03
**Mode:** auditor + planner. No source edits in this round; report only.
**Scope files (all read before judging — Verified):**

- `src/products/sat/ui/useRoomScores.ts` (352 lines — join, `resolveRoomScore`, `shortModuleLabel`, pagination loop, severity-wins dedup, `isSameRoomScore` identity reuse)
- `src/products/sat/ui/SatSessionRoomRoster.tsx` (334 lines — `sortRoster`, `holdOrder`, stale age ticker, truncated footnote, announcements)
- `src/products/sat/ui/SatSessionRoomStudents.tsx` (591 lines — row badge, `StudentScoreSummary` kind-based link predicate)
- `src/products/sat/routes/SatSessionRoomRoute.tsx` (790 lines — wiring, `truncated`, return-state)
- `src/features/results/api/satResultsQueries.ts` (237 lines — attempts pagination contract)
- `backend/go/internal/proctor/sessions.go` (2610 lines — `scoreOutcomeSeverity`, `buildScoreProjections`, `scoreReadQuerier`, `loadScoreProjections`, `applyScoreProjection`, `requireSessionReader`, `loadScoreOutcomes`, `loadScoreModuleFacts`)
- `backend/go/internal/proctor/session_projection_score_test.go` (671 lines) + `src/products/sat/ui/__tests__/useRoomScores.test.tsx` (349 lines)
- Normative priors: `docs/plans/2026-11-03-sat-room-score-edge-case-fixes.md`, `docs/plans/2026-11-03-sat-room-zero-click-scores.md`
- Cross-feature witnesses (Verified): `src/products/sat/routes/SatExamGroupSection.tsx:85-122,237`, `backend/go/internal/results/service.go:755-863`, `src/features/proctor/hooks/useProctorMonitoring.ts:574,650`, `src/features/proctor/contracts/monitoringSchemas.ts:59-71`, `src/types.ts:877-882`

**Fact-label convention:** every significant claim is tagged **(Verified)** = read in code, **(Inferred)** = reasoned from code without direct observation, **(Unknown)** = needs a stated check.

---

## AUDIT

### §1. Executive Assessment

**Overall business-logic confidence: MEDIUM-HIGH on correctness math, LOW on freshness/completeness.**

The score *math* (NULL≠0, pretest exclusion, invalidation terminality, same-scope sums for the standard plan, no key leak) is well-built and well-tested **(Verified)**. The score *delivery* (getting every row's facts to the screen, fresh, under failure and concurrency) has three confirmed holes that the test suite does not see because every test resolves the join with a single mocked page on mount.

| Finding class | Count |
|---|---|
| CONFIRMED bugs (proof format, §5) | 6 |
| HIGH-PROBABILITY risks (one missing fact each, §5) | 4 |
| SPECIFICATION GAPs (competing interpretations, §5) | 4 |
| DEFENSIVE improvements (no violation, §6) | 4 |

**Most dangerous invariant: INV-06 (no silent omission by room size / no frozen scores presented as fresh).** Status: PARTIALLY PROTECTED. BUG-001 (join never polls) + BUG-002 (page failure discards fetched pages) + BUG-003 (offset-shift skip) all break it in the same direction — *the teacher sees a confident-looking roster that is quietly incomplete or stale, and triages on it.* Detection difficulty is high: no error banner appears in any of the three cases (BUG-002 shows the stale dim only if a previous success exists; on first load it shows BE-only/dash as if that were the whole truth).

**Most fragile workflow: the FE results-join pagination loop** (`useRoomScores.ts:279-302`). It is the only writer of `rowsByAttempt`, it runs once per mount, it uses offset pagination over a live-mutating table, and it throws away partial progress on any page failure. Four of ten findings touch it.

Prior round-1 fixes verified as actually landed **(Verified)**: pagination loop with 10×50 cap + `truncated` footnote, severity-wins dedup, `unscored`→`not_scored` on both layers, anchored `shortModuleLabel` (`exam-m10`/`team1-x` tests pass in-file), `answered>total`→scoring guard, ended-without-submit→answering const, footer-scoped 30s ticker, kind-based View-answers predicate. The audit below faults what remains, not what was fixed.

---

### §2. Domain Model

**Entities (reconstructed from code, not assumed):**

```text
StudentAttempt (delivery authority: student_attempts row)
 ├── id (= StudentSession.id = SatAttemptRow.attemptId — THE join key, INV-05)
 ├── delivery/attemptStatus: running | paused | submitted | ended | terminated | locked (witnessed in SatExamGroupSection.tsx:93-99) (Verified)
 ├── satStartState: waiting_for_code | started | never_started (code-start rooms only)
 └── terminal_generation (fences stale results; sessions.go:1396-1401) (Verified)

ModuleAttempt (assessment_module_attempts row)
 ├── state: locked | submitted = sealed (scoreModuleSealed, sessions.go:1333-1335) (Verified); active/review/... = open
 ├── raw_correct (sealed counts only), operational_question_count
 └── belongs to Module → Section; each (attempt, module-attempt) yields one scoreModuleFacts row (GROUP BY ma.id) (Verified)

Question (assessment_exam_questions + answers)
 ├── is_pretest = TRUE rows excluded from EVERY count (facts query eq.is_pretest=FALSE, sessions.go:1366) (Verified)
 ├── answered ⇔ V2-canonical-wins predicate (scoreAnsweredPredicate, sessions.go:1344-1350) (Verified)
 └── verdict (isCorrect) lives ONLY in results detail; never enters proctor payload (TestScoreProjectionNeverEmitsKeyMaterial) (Verified)

Result outcome (assessment_results.outcome_status, fenced on terminal_generation)
 └── scored | pending | invalidated_proctor | invalidated_timeout | unscored (terminal); NULL/empty = no result yet (Verified)

ScoreProjection (BE derived read-model, sessions.go:1443-1449)
 ├── answered (ALL taken modules, scoped or not — see H-02), total (counted/scoped only, nil when plan nil)
 ├── correct (summed sealed raw_correct, nil unless every COUNTED module sealed+scored)
 ├── status: unstarted | answering | scoring | scored | not_scored
 └── read-only txn (repeatable-read attempt, best-effort fallback), never transitions attempts (Verified)

RoomScore (FE derived view-model, useRoomScores.ts:17-28)
 ├── kind: dash | answering | scoring | scored | not_scored; correct/total/pct/modules/label/srLabel/resultId/hasSavedAnswers
 └── join: BE projection wins when it carries correctness, else results row; never computed from answers (Verified)
```

**Relationship map (tested edges):**

```text
Schedule ──< StudentAttempt (1:N; room lists by schedule_id)
StudentAttempt ──< ModuleAttempt (1:N; GROUP BY ma.id, merged per moduleKey defensively)
StudentAttempt ──? Result (0:1 live; fenced by terminal_generation; duplicates resolved severity-wins)
StudentAttempt ──? SatAttemptRow (0:N across pages; dedup severity-wins, later-page-wins on ties)
ScoreProjection ──> StudentSessionSummary (additive omitempty keys; nil projection omits all keys)
RoomScore ──> SatRoomStudentRow badge + StudentDetail Score summary (same Map object, identity-reused per row)
```

Missing/deleted-archive edges: soft-delete/retake semantics for attempts were not found in the read surface **(Unknown)** — the join keys on `attemptId`, so a second attempt for one student is a second row, not a collision **(Inferred)**; `expectedStudents` dedups by `attemptId` **(Verified, SatSessionRoomRoster.tsx:192)**.

---

### §3. Critical Invariants

| ID | Invariant | Enforcement | Status |
|---|---|---|---|
| INV-01 | No key/verdict material in proctor payloads or roster DOM | BE counts-only builder + wire tests; FE never derives correctness from answers | **PROTECTED** (Verified) |
| INV-02 | NULL (unknown/ungraded) ≠ 0 (graded zero); never `0/0`, never `NaN%` | `finiteCount` (useRoomScores.ts:41-43) + total `>0` guard (:92-94) + BE nil-correct discipline | **PROTECTED** (Verified; but 0-correct path has no regression test — §10 T-01) |
| INV-03a | Outcome-terminal `invalidated_*`/`unscored` ⇒ `not_scored`, correct nil, never `0/total` | BE case :1553-1558 + severity 3-group :1428 + FE `invalidated` set :98-100; unit-tested both layers | **PROTECTED** (Verified) |
| INV-03b | Attempt-terminal (`terminated`/`locked` delivery state, no scoring outcome) never reads as live (`answering`) or empty (`dash`) | **Nothing**: FE branches cover only running/paused/ended (:116-122); BE takes no attempt-status input | **VIOLATED** → BUG-004 (Verified) |
| INV-04 | Pretest excluded from every sum | `eq.is_pretest=FALSE` fence (:1366) + MySQL integration test | **PROTECTED** (Verified) |
| INV-05 | Join key is `attemptId` (`session.id`); never `studentId` | Hook + join test | **PROTECTED** (Verified) |
| INV-06 | No silent omission by room size; every visible attempt resolves (or explicit `truncated`/stale) | Pagination loop + 51-row test + 500-cap footnote | **PARTIALLY PROTECTED** → BUG-001/002/003 (Verified) |
| INV-07 | Totals and correctness cover the same scoped module set (`pct ≤ 100%`) | BE `counted()` gate (:1522-1542) + scope-exclusion test | **PARTIALLY PROTECTED** → H-01 (mixed BE/row sources), H-02 (unscoped answered) (Verified mechanism) |
| INV-08 | No negative `left`, no `NaN` pct | `left` suppression (:162) + `total>0` pct guard (:146-148) + corrupt→scoring (:142-144) | **PROTECTED** (Verified; scored-kind corrupt counts noted in §6) |
| INV-09 | Stale/failure never flashes zero; last values kept + dimmed | BE best-effort nil (loadScoreProjections :1616-1631) + FE `isStale` dim + skeleton | **PARTIALLY PROTECTED** → BUG-001 (frozen presented as fresh), BUG-002 (first-load page loss) (Verified) |
| INV-10 | Same read gate, no new endpoint | `requireSessionReader` on `GetSessionDetail` (:2391,:2478; NOT_FOUND mapping :447-455) | **PROTECTED** for BE detail (Verified); results-list gate as seen by the room role = **UNKNOWN** (needs 1-line `table_staff.go` read — `resultsRead` composition) |
| INV-11 | View-answers predicate single-sourced (room ≡ group section) | Room kind-based (:519) vs group outcome-based (SatExamGroupSection.tsx:237) — traced all 4 combos, agree | **PROTECTED** (Verified — F5 converged correctly) |
| INV-12 | Sort stable, anti-jitter; low score never creates attention | `sortRoster` + `holdOrder` + announcement collapse; tests | **PROTECTED** (Verified) |

---

### §4. State-Machine Findings

**Projection lifecycle (BE `buildScoreProjections` + FE `resolveRoomScore`, merged view):**

```text
unstarted ── answers saved ──▶ answering ── all counted sealed, grading pending ──▶ scoring
                                                                  │ sealed+scored
                                                                  ▼
                                                                scored
any ── outcome ∈ {invalidated_proctor, invalidated_timeout, unscored} ──▶ not_scored (terminal)
any ── load error ──▶ keep last (FE dim) — not a state, a presentation overlay
```

**Transition matrix (audited, not just implemented):**

| From | Event | To | Verdict |
|---|---|---|---|
| answering/scoring | outcome invalidated/unscored arrives | not_scored | Allowed, tested both layers (Verified) |
| scored | same facts re-polled | scored (same object identity) | Allowed, tested (Verified) |
| scored | duplicate outcome `pending` (stale generation) | stays scored | Allowed — terminal_generation fence (:1396-1401) + severity last-wins (Verified) |
| not_scored | late `scored` outcome (regrade after invalidation) | stays not_scored | **Current behavior** (severity 3 > 2 both layers). Domain-correct? If regrade-after-invalidation is impossible, fine; if possible, the score is censored. → SPEC S-02 (Unknown: can a terminal outcome be superseded?) |
| answering | `terminated`/`locked`, no outcome | dash / answering-forever | **Forbidden transition that occurs** → BUG-004 |
| scored (BE, total=&0, degenerate plan) | FE join | scoring (BE says scored) | Cross-layer status divergence → H-03 |
| any | page-2 fetch fails (first load) | empty join (BE-only/dash) | Forbidden silent loss → BUG-002 |
| unstarted (no facts, no plan) | plan nil + row present | scored via mixed sources | Same-scope violation window → H-01 |

**Impossible states reachable in code:**

1. `status=scored ∧ total=&0` (BE, zero-question counted module) → H-03 (Verified constructible).
2. `status=scored ∧ answered>total` (unscoped extras, H-02; or duplicate module-attempt sums) — FE renders scored badge with suppressed `left` but raw corrupt `answered` hidden only because scored labels don't print it; modules print `correct/total` per module (consistent) — contained, noted §6.
3. `outcome=scored ∧ resultId=null` (FE-scored via BE with no row, e.g. >500 truncation): room shows scored + `hasSavedAnswers` from BE-answered; View-link falls to saved-answers path — safe direction (never key teaser) (Verified §5 BUG-001 discussion).
4. `ScoreStatus` on the wire outside the 5-value enum: zod `scoreStatus` enum (:64) would drop/throw? `studentSessionSchema` — need `validateData` behavior on unknown enum: zod enum mismatch = parse error → whole session invalid? **(Unknown)** — flag as check item; likely fail-closed per `validateData` error path. Listed DEFENSIVE D-04.

---

### §5. Confirmed Bugs (proof format, severity-ordered) + HIGH + SPEC

#### BUG-001 — Results join never re-polls; in-session submissions/outcomes freeze until remount [S2, 100%]

**Business invariant:** INV-06/INV-09 — every visible attempt resolves from facts no older than the room's freshness contract (15s detail / 30s results, per prior plans).

**Preconditions / Starting state:** Room open with 16 Finished + 1 working student. `useRoomScores` mount fetch succeeds. Working student submits at T+60s (new result row + `resultId` appears server-side).

**Execution:**
1. Mount: `queryFn` runs once (`useRoomScores.ts:278-307` — `queryKey`, `queryFn`, `enabled`, `staleTime: 30_000`, `gcTime`; **no `refetchInterval`, no `refetchOnWindowFocus` override** (Verified)).
2. Nothing in `src/` invalidates `['sat-results','attempts-all',…]` (Verified by grep: all `invalidateQueries` call sites target proctor/config/library keys; the only author of that key is the hook itself).
3. Proctor detail keeps polling every 15s/8s (`useProctorMonitoring.ts:574,650`) (Verified) — so BE-carried correctness still upgrades, masking the freeze.

**Expected:** Join refreshes on room cadence; new `scored` row + `resultId` appear; inspector offers View answers.
**Actual:** `byAttempt` frozen at mount values (+ focus/reconnect refetches only). New submissions never upgrade row-sourced badges; `resultId` never arrives so inspector never offers View answers for in-session submissions; `isStale` stays false and `scoresUpdatedAt` frozen — **stale presented as fresh**. The entire announcement/`isSameRoomScore` machinery ("duplicate polls", "next poll heals" language in tests/comments) assumes polls that never come.

**Why:** `staleTime` without `refetchInterval` only marks data stale; nothing refetches. The Results-list hook (`useSatAttemptsQuery`) shares the no-interval shape — fine for a list page, wrong for a live room.

**Impact:** Teacher misses fresh scores and answer-links during the session; under BE outage the fallback is frozen too. S2 (recoverable by remount, but silent).

**Minimal regression test:** §10 T-02 (fake timers advance 15–30s → second `resultsGateway.get` call; new row renders).

**Fix direction:** §LLI F-A: `refetchInterval: 15_000` (match detail cadence), keep severity merge; abort-safe (existing `signal` already threaded per page).

---

#### BUG-002 — First-load page failure discards already-fetched pages [S2, 100%]

**Invariant:** INV-06/INV-09 — partial failure keeps accumulated pages + stale dim (prior plan F1 accepted this; implementation doesn't do it).

**Starting state:** 51-attempt room, no cached data. Page `offset=0` succeeds (50 rows), page `offset=50` fails (500/timeout).

**Execution:** `queryFn` pushes page 1 into local `all`, then `resultsGateway.get` throws → whole `queryFn` rejects → react-query stores error with `data === undefined` → `rowsByAttempt` = empty → every session resolves BE-only/dash with `isLoading=false, isStale=true`. The 50 arrived rows are lost.

**Expected:** 50 rows kept + stale dim; 51st BE-only/dash.
**Actual:** 0 rows kept; room reads as if the results service had no data at all.

**Affected code:** `src/products/sat/ui/useRoomScores.ts:279-302` (throw propagates; no catch-and-return-partial).
**Impact:** Large rooms on flaky networks lose all row scores on first paint — the exact case pagination was built for.
**Regression test:** §10 T-03. **Fix:** §LLI F-B (per-page try/catch → return `{items, partial:true}`; `isStale = isError || partial`).

---

#### BUG-003 — Offset-pagination insert-during-traversal silently skips an attempt [S3, 90%]

**Invariant:** INV-06.

**Starting state:** 51 attempts, stable order `test-start DESC, submitted DESC, id DESC` (`service.go:802`), `HasMore = offset+len < total` (:862) (Verified).

**Execution:** Page 1 (`offset=0`) returns rows 1–50. A 52nd attempt submits (newest test-start → position 1). Page 2 (`offset=50`) now returns old row 50 (shifted to 51) — old row 51 is never returned. `all.length (51) >= total (52)`? No: 51 < 52, loop already ended (`!hasMore` on page 2: 50+1 < 52 = true → hasMore true → offset=100 → page 3 returns [] → ends with 51 of 52, **no gap signal surfaced**). FE dedups but cannot detect the hole.

**Expected:** All 52 resolve, or an explicit incomplete signal.
**Actual:** One attempt silently dash/answering until next full refetch (which, per BUG-001, may never come).

**Confidence 90%** — mechanism deterministic from verified ORDER BY + OFFSET arithmetic; residual 10% is whether a submit can interleave mid-traversal in prod (yes, rooms are live during traversal — Inferred, high).
**Fix:** §LLI F-C (gap detection `all.length < total` → partial/stale + heal on next poll; document offset limitation; no new endpoint).

---

#### BUG-004 — `terminated`/`locked` attempts with no outcome read as dash (or answering-forever) [S3, 100%]

**Invariant:** INV-03b — terminal delivery states read terminal.

**Starting state:** Attempt proctor-terminated (or `locked`) mid-exam; no result row (outcome null); no module facts (or open facts with saved answers).

**Execution (FE):** `resolveRoomScore` branches (`useRoomScores.ts:107-133`) match `running|paused|ended` only. `terminated`/`locked` match nothing → falls to `satStartState`/default → **`dash`** (empty badge; row already says "Finished" via `studentState`, `SatSessionRoomStudents.tsx:130`). With saved answers but no outcome, BE says `answering` and FE agrees — a terminated attempt reads as still-working **forever** (BE takes no attempt-status input, `buildScoreProjections` signature :1456).

**Expected:** Terminal-without-score ⇒ `Not scored` (never dash, never answering).
**Actual:** Dash (no facts) or perpetual answering (with facts).

**Cross-check:** the group section *does* handle these (`terminated → Ended by proctor`, `locked → Ended`, SatExamGroupSection.tsx:97-98) (Verified) — the room is the outlier.
**Confidence note:** the FE dash path is 100% from verified branches. Whether a terminated attempt can *later* score (regrade) decides between `not_scored`-now vs pending — that sub-question is H-04, not this bug: even if re-scorable, dash/answering-forever is wrong today (should be `scoring` at minimum, keyed off submitted/sealed facts, not silence).
**Fix:** §LLI F-D (FE: `terminated|locked ∧ no outcome ∧ no scored-correct ⇒ not_scored`; precedence: real outcome/real correct always wins).

---

#### BUG-005 — Ended-unscored renders three different truths in two surfaces [S3, 100%]

**Invariant:** cross-feature consistency (INV-11 family).

**Starting state:** Attempt `attemptStatus='ended'`, outcome `unscored`, no counts.

**Execution — three code paths, three answers (all Verified):**
1. Room roster: `ended` ⇒ `answering` ("Answering…", `useRoomScores.ts:116-126` + const comment; test pins it, `useRoomScores.test.tsx:345`) — a deliberate SPEC-3 choice.
2. Results Score column: `totalScoreLabel` → falls through (`unscored` isn't `invalidated_*`, status isn't running/paused, outcome isn't pending) → **"Not scored"** (`SatExamGroupSection.tsx:114-121`).
3. Results Status column: `attemptOutcome` handles `running|paused|submitted|terminated|locked` — **`ended` unhandled** → **"Status unavailable"** (`SatExamGroupSection.tsx:85-101`).

**Expected:** One canonical reading across room + Results (+ Status column not "unavailable" for a first-class delivery state).
**Actual:** Answering… / Not scored / Status unavailable for the same attempt. A teacher cross-checking room vs Results sees contradiction.
**Fix:** §LLI F-E: mechanical — add `ended → Ended` to `attemptOutcome` (mirrors `locked`); escalate the Score-label canonical (`Not scored` vs `Answering…`) as SPEC S-04 with safe default = no change to either badge.

---

#### BUG-006 — Stale-age ticker re-renders the whole roster every 30s and runs when fresh [S4, 100%]

**Invariant:** prior-plan F6 (ticker scoped to footer only).

**Execution:** `setScoresAgeTick` lives in `SatSessionRoomRoster` (`SatSessionRoomRoster.tsx:181-186`); `SatRoomStudentRow` is **not memoized** (plain export, `SatSessionRoomStudents.tsx:69`); every tick re-renders all rows. Interval arms whenever `scoresUpdatedAt` is set — including fresh state where the age line isn't even rendered (`scoresAge` only used inside the `scoresStale` paragraph, :250-254).

**Expected:** Footer-only re-render, only while stale.
**Actual:** Whole-list re-render every 30s, always.
**Fix:** §LLI F-F (extract memo'd `ScoresAgeLine`; arm only when the stale paragraph renders).

---

#### HIGH-01 — Mixed-source correct/total can breach `pct ≤ 100%` [HIGH — missing: when is BE plan nil in prod while a row exists]

**Mechanism (Verified):** `correct = beCorrect ?? rowCorrect; total = (beTotal ?? rowTotal) if >0` (`useRoomScores.ts:91-94`). When BE carries correctness but no total (nil plan — `TestBuildScoreProjectionsMissingPlanWithholdsTotal` proves BE emits correct=9/total=nil), and a results row exists, the view-model pairs **BE-scoped correct with row-scoped total** — different denominators (SPEC-1 M1-only vs classroom total is exactly this shape). `pct` is then a cross-denominator fiction, possibly >100%.
**Missing fact:** whether `plan` can be nil/empty in production while rows exist (plan load failure path in `GetSessionDetail` — not traced to its error policy in this round).
**Fix:** §LLI F-G (same-source rule: correct+total both BE or both row; mixed ⇒ scoring).

#### HIGH-02 — `proj.answered` sums unscoped modules while `total` excludes them [HIGH — missing: can scope change after modules are taken]

**Mechanism (Verified):** `proj.answered += m.Answered` runs before the `counted()` skip (`sessions.go:1528-1542`), while `total` sums only counted keys (:1543-1551). An out-of-scope taken module inflates `answered` past scoped `total` → FE corrupt-guard fires → healthy attempt shows "Scoring… 23/13 answered".
**Missing fact:** whether publish/link scope can narrow after modules were administered (scope-edit mid-session). Delivery presumably prevents it (Inferred), hence HIGH not CONFIRMED.
**Fix:** §LLI F-H (sum `answered` over counted modules only; keep listing all taken modules factually).

#### HIGH-03 — BE can emit `scored ∧ total=&0`; FE then contradicts BE [HIGH — missing: can a counted module have zero operational questions]

**Mechanism (Verified):** `total` is a plain sum with no floor (`sessions.go:1544-1550`); a zero-question counted module yields `total=&0, correct=&0, status=scored`. FE nils `total` (`>0` guard) and, with `beStatus='scored'` but no numbers, renders **scoring** — BE says scored, room says Scoring…, forever (no plan change will fix it).
**Missing fact:** plan-authoring floor for module question counts.
**Fix:** §LLI F-I (BE: `total<=0 ⇒ total=nil, status=scoring` unless unstarted; one branch + test).

#### HIGH-04 — Terminated-with-open-facts stays `answering` in BE indefinitely [HIGH — missing: are terminated attempts still gradable]

Overlaps BUG-004 (FE side confirmed). BE side needs the domain answer: if termination ends grading, BE should map terminated+no-outcome ⇒ `not_scored` (requires threading delivery status into `loadScoreProjections` — a wider join, hence HIGH pending the product answer). If termination does NOT end grading, BE is correct and only FE's dash for the no-facts case stands (BUG-004 covers it).

---

#### SPEC-01 — M1-only / flexible-scope totals denominator (inherited, still open)

BE sums taken-scoped modules; row `rawTotal` is the classroom total. For M1-only rooms the two disagree by construction. Prior plan parked this (SPEC-1, one-row-dump check). **No safe default exists** (either choice mislabels one surface) — do not "fix" in code; run the data check (§LLI §9 unknowns).

#### SPEC-02 — Terminal-outcome vocabulary + regrade-after-terminal precedence

`loadScoreOutcomes` stores any non-empty outcome string (severity 0 for unknowns, `sessions.go:1407-1422`); BE+FE severity both rank invalidation(3) > scored(2), so a late `scored` after `invalidated_*` loses silently. If regrade-after-invalidation is impossible, current behavior is correct; if possible, scores are censored. Needs grading-domain answer. Safe default: keep (fail-closed toward not_scored).

#### SPEC-03 — Score-sort definition on ties (`correct` only, pct-blind)

`scoreValue` uses `correct ?? null` (`SatSessionRoomRoster.tsx:44-45`): 9/13 and 9/27 tie → name order under both directions; unscored sorts last in *both* directions (deliberate, commented). Defensible, but "Score: low→high" with pct-blind ties is a product choice, not a theorem. Safe default: keep; document.

#### SPEC-04 — Canonical label for ended-without-submit (room `Answering…` vs Results `Not scored`)

BUG-005's Score-column half. Room chose answering (SPEC-3 const, one-line flip available); Results chose Not scored. Both defensible (awaiting-teacher-action vs no-score-recorded). Needs teacher-research answer; code default = keep both, fix only the mechanical Status-column gap.

---

### §6. Edge Cases (grouped; only non-obvious, code-backed items)

**Boundary.**
- `correct=0,total=27,scored` ⇒ `✓ 0/27 · 0%` — traced: `pct=0` passes `!==null` guards (:146-148,:158) (Verified). No test pins it → T-01.
- `total=0` ⇒ total nils ⇒ dash/scoring, never `0/0`/`NaN%` (Verified :92-94). BE `&0` counterpart → H-03.
- Negative counts ⇒ `finiteCount` nulls (Verified :41-43); negative `rawCorrect` degrades to scoring, never negative display.
- 50/51 boundary: loop `items.length < limit → break` + `all.length >= total → break` + `hasMore` (Verified :297-299). Exactly-50-with-`hasMore=true` (server inconsistency) loops once more — benign.
- 500 cap: footnote rendered (Verified :255-259); return-state preserves sort/search but `truncated` needs no preservation (static per room size — Inferred).

**State.** BUG-004/005 + H-03/H-04. `beStatus='scored'` with numbers missing ⇒ scoring, never zero-flash (Verified :107-115, tested). `not_scored` nulls correct/modules-correct on both layers (Verified BE :1554-1558, FE :150-156).

**Concurrency.** Repeatable-read txn covers facts+outcomes but NOT `loadStudentSessions` (rows read at :2506, txn opened :2512): a join arriving mid-read gets nil projection ⇒ keys omitted (fail-safe direction — Verified). `scoreReadQuerier` txn-begin failure silently falls back to the shared handle with **no metric** (Verified :1597-1609) ⇒ silent freshness downgrade → DEFENSIVE D-02. Poll merge is deterministic (severity-wins, later-page-wins on ties, `isSameRoomScore` identity reuse) — no lost-update class (single-writer Map per poll) (Verified).

**Time.** 15s room / 30s results / render-time age contract holds structurally, but BUG-001 voids the results leg (mount-only). Age label coarsened + 30s tick (Verified :67-74) — truthful only when data actually refreshes.

**Retry.** Page-fail ⇒ whole-query error (BUG-002). Outcome-dedup severity `>=` last-wins with **no ORDER BY** (`loadScoreOutcomes` query :1396-1401) — equal-severity duplicates resolve nondeterministically (same values in practice) → D-01. FE cross-page ties: later page wins — deterministic given page order (Verified :316).

**Authorization.** INV-10: BE detail gate verified; room-role vs results-list `resultsRead` composition Unknown (one-line check, §LLI §9). Failure direction is fail-closed (403 ⇒ `isError` ⇒ stale dim + BE fallback) (Inferred from `enabled`/error path).

**Data integrity.** BE `merged` per-module sums `answered`/`correct` across duplicate facts with unanimity-required seal flags (Verified :1478-1516) — duplicate module-attempts could double-count `answered` past `total` (GROUP BY `ma.id` makes this rare — Inferred). Unscoped-answered inflation → H-02. Zero-total scored → H-03.

**Integration.** Results contract `limit∈(0,100]→else 50; offset<0→0` (`service.go:756-761`) — FE loop's `limit=50` always valid (Verified). Results `HasMore` recomputed server-side per request — consistent within a page, not across pages (BUG-003). Zod contract stays loose/additive (Verified :59-71); unknown `scoreStatus` enum member handling Unknown → D-04 check.

**Historical data.** Legacy outcomes outside the 5-value vocabulary → severity 0 → treated as non-terminal (SPEC-02). Legacy `attemptStatus` values fall to dash (BUG-004 family). Pretest semantics pinned to `IsPretest` on both paths (Verified).

---

### §7. Concurrency and Idempotency (explicit section)

- **Read-then-write:** none. All score paths are read-only projections + memoized view-models. No check-then-insert, no counters, no idempotency keys needed. **No race class found** (Verified by absence: no mutations in `buildScoreProjections`, `resolveRoomScore`, or the join loop).
- **Duplicate delivery:** duplicate outcome rows (BE severity-wins, tested `TestLoadScoreOutcomesFencesOnTerminalGeneration`); duplicate attempt rows across pages (FE severity-wins, tested); duplicate polls (identity reuse via `isSameRoomScore`, tested). All deterministic except equal-severity ORDER BY absence (D-01).
- **Concurrent mutation during traversal:** BUG-003 (offset shift). No barrier available client-side without a cursor API (rejected: no new endpoints per constraints) — mitigation is detect-and-heal (F-C).
- **Multi-instance:** BE stateless per-read; FE per-browser memo. No shared mutable state. Repeatable-read attempt is per-request; fallback path noted (§6).

---

### §8. Data Integrity Risks (DB-enforcement view)

| Rule | DB protection | App protection | Rating |
|---|---|---|---|
| One live result per attempt | None found (fence is a query predicate `terminal_generation =`) | Severity-wins dedup | RACE-TOLERANT (not atomic, but convergent) |
| Outcome vocabulary | None (free string) | Switch/severity defaults | NOT PROTECTED → SPEC-02 |
| Score storage | No score columns mutated by this feature (read-only) | — | N/A (nothing to corrupt) |
| Repeatable facts+outcomes | `REPEATABLE READ` txn attempt | Silent fallback | PARTIALLY (D-02) |
| Attempt list ↔ score map skew | None (separate reads) | Nil-projection omits keys (fail-safe) | Fail-safe by omission |

No corruption vector found: the feature writes nothing. Worst case in every finding is *wrong/stale display*, never wrong persisted state. This caps all severities below S1 — correctly reflected in §5.

---

### §9. Cross-Feature Inconsistencies

1. **Ended-unscored triple truth** (room Answering… / Results Not scored / Status "unavailable") → BUG-005 (Verified, three paths cited).
2. **Terminated handling** (group maps it; room ignores it) → BUG-004.
3. **Detail route invalidation check** (`SatResultDetailRoute.tsx:200` lists only two `invalidated_*`) vs room/BE three-valued terminal set — `unscored` detail may render "Unavailable" instead of "Not scored". **Not fully traced** (lines 111+ not read this round) — listed as check item, not a finding. **(Unknown)**
4. **`totalScoreLabel` vs room `pct`:** group prints `rawCorrect/rawTotal` only when `outcomeStatus==='scored'` + non-null; room prints when correct+total non-null from *either* source (H-01 window). Converged for the standard case (Verified).
5. **View-answers predicate:** converged (INV-11). No action.

---

### §10. Missing Regression Tests (Given/When/Then)

- **T-01 (INV-02 zero):** Given a scored row `rawCorrect=0, rawTotal=27`; When `resolveRoomScore` runs; Then kind=scored, label=`✓ 0/27 · 0%` (never dash/Not scored). *Unit.* (Proves NULL≠0 at the exact boundary; no test today — Verified by suite read.)
- **T-02 (BUG-001 poll):** Given mounted room + fake timers; When 15–30s elapse and a new scored row exists; Then `resultsGateway.get` called again and the badge upgrades. *Hook/integration.*
- **T-03 (BUG-002 partial):** Given page 1 resolves 50 rows and page 2 rejects; When the hook settles; Then 50 badges render + stale dim (never 0). *Hook.*
- **T-04 (BUG-003 gap):** Given two pages whose concatenation is short of `total`; When the loop ends; Then `partial/truncated` signal set + footnote/stale (never silent). *Hook.*
- **T-05 (BUG-004 terminal):** Given `attemptStatus='terminated'` (and `'locked'`), no outcome, no counts; When resolved; Then `not_scored` (never dash). Given terminated + open answered facts; Then `not_scored` (never answering). *Unit ×2.*
- **T-06 (BUG-005 status):** Given `attemptStatus='ended'`; When `attemptOutcome` runs; Then label≠"Status unavailable". *Unit (group section).*
- **T-07 (H-01 same-source):** Given BE correct=9/total=nil + row rawCorrect=18/rawTotal=27; When resolved; Then NOT scored with mixed 9/27 (scoring). *Unit.*
- **T-08 (H-02 counted answered):** Given out-of-scope taken module with answers; When `buildScoreProjections` runs; Then `answered` excludes it (total already does). *BE unit.*
- **T-09 (H-03 zero total):** Given counted module with 0 operational questions, sealed+scored; When built; Then total=nil and status≠scored-with-`&0`. *BE unit.*
- **T-10 (BUG-006 ticker):** Given fresh scores; When 30s elapse; Then zero row re-renders (and no interval when age line hidden). *Component/render-count.*
- **T-11 (announcements):** Given scored→not_scored transition; When poll lands; Then polite region announces it once (extends existing upgrade/collapse tests). *Component.*
- **T-12 (property):** For all generated `(correct,total)` with `0≤correct≤total, total>0`: `pct==round(correct/total*100)` and label contains neither `-` left nor `NaN`. *Property (vitest fc or Go quick).*

---

### §11. Recommended Fix Order

- **P0 — freshness/completeness (silent-wrong-triage class):** BUG-001 (poll), BUG-002 (partial keep). Both small, both multiply every other finding's blast radius (with polling, BUG-003 self-heals; without it, nothing heals).
- **P1 — core invariant repair:** BUG-004 (terminal states), H-01 (same-source sums), H-02 (counted answered), BUG-003 gap detection (rides on P0 poll).
- **P2 — correctness polish:** BUG-005 status-column half (mechanical), H-03 (zero-total), BUG-006 ticker scoping.
- **P3 — defensive + announce:** D-01 ORDER BY, D-02 txn-fallback metric, invalidation announcements (T-11), D-04 zod-enum check.
- **P4 — spec decisions (product input, no code until answered):** SPEC-01 (M1-only denominator), SPEC-02 (regrade-after-terminal), SPEC-03 (sort ties doc), SPEC-04 (ended canonical label).

---

## LLI PLAN (for every CONFIRMED + HIGH item; SPEC only with safe defaults)

### §LLI-1. Change boundary & repository evidence

**Current behavior (Verified):** FE join `useRoomScores.ts:272-307` (mount-only query, offset loop, severity dedup); view-model `resolveRoomScore` `:77-209`; sort/hold/ticker/announce `SatSessionRoomRoster.tsx:33-186`; row/inspector `SatSessionRoomStudents.tsx:44-67,490-536`; wiring `SatSessionRoomRoute.tsx:160-164,507-518`; results contract `limit/offset/hasMore` (`service.go:756-762,802,862`); BE builder/fences/best-effort (`sessions.go:1392-1648`); auth `requireSessionReader` (`:447-455`, enforced `:2391,:2478`).

**Desired behavior:** Every visible attempt resolves fresh-or-explicitly-stale; terminal states read terminal everywhere; same-scope sums by construction; ticker footer-scoped.

**Non-goals (hard):** no new endpoints, no migrations, no grading/conversion changes, no key/verdict in proctor payloads, no auth-model change, additive wire only, loose zod preserved, same hook shape + optional flags only.

**Assumptions (marked):** BE plan nil rarity (Unknown — check §LLI-9); terminated-not-gradable (Unknown — product answer gates H-04 BE half); scope immutability mid-session (Unknown — access-link edit policy).

### §LLI-2. Requirements & invariants with IDs + acceptance

| ID | Requirement | Acceptance |
|---|---|---|
| FR-A (BUG-001) | Results join refreshes on room cadence | Fake-timer test: second fetch ≤30s after mount; new scored row upgrades badge + View-link appears |
| FR-B (BUG-002) | Page failure keeps fetched pages | T-03: 50/51 badges + stale dim on page-2 failure |
| FR-C (BUG-003) | Traversal gaps detected, never silent | T-04: `all.length < total` ⇒ partial signal + footnote; heals on next poll |
| RULE-D (BUG-004) | `terminated`/`locked` + no outcome/correct ⇒ `not_scored` | T-05 ×2; real outcome/correct always takes precedence |
| RULE-E (BUG-005) | `ended` has a Status-column reading | T-06; Score-column canonical parked as SPEC-04 (no change) |
| RULE-G (H-01) | correct+total same-sourced | T-07; `pct` unclamped-removed (impossible by construction) |
| RULE-H (H-02) | answered counted-scoped | T-08; modules list unchanged (factual) |
| RULE-I (H-03) | total≤0 never pairs with scored | T-09 |
| PERF-F (BUG-006) | Ticker footer-only + stale-only | T-10 render-count |
| INV-06/09 | Fresh-or-explicitly-stale everywhere | FR-A+B+C acceptance |
| INV-03b | Terminal reads terminal | RULE-D + H-04 decision |
| INV-07 | Same-scope sums | RULE-G + RULE-H |

### §LLI-3. Entities/ownership + transition table

| Unit | Responsibility (unchanged owners) | Change |
|---|---|---|
| `useRoomScores` (FE) | Join + view-model | +interval (F-A), +partial keep (F-B), +gap signal (F-C), +terminal branch (F-D), +same-source rule (F-G) |
| `buildScoreProjections` (BE) | Counted sums | +counted answered (F-H), +zero-total guard (F-I) |
| `SatSessionRoomRoster` (FE) | Sort/hold/age/announce | Extract `ScoresAgeLine` (F-F), +`ended` status is group-section file (F-E), +invalidation announce |
| No new owners, no new tables, no new endpoints | — | — |

Transition additions: `terminated|locked ∧ ¬outcome ∧ ¬correct ⇒ not_scored` (FE, precedence below any real outcome/correct); `mixed-source ⇒ scoring`; `total≤0 ⇒ scoring + total nil` (BE).

### §LLI-4. Exact function-level design (per touched function)

**F-A. `useRoomScores` query (`useRoomScores.ts:278-307`)**
Location: Verified. Owns: join freshness. Reads: examId/scheduleId. Writes: query cache only. Signature: same return + optional `partial: boolean` (additive). Pre: same `enabled`. Post: refetch every 15s (matches detail 15s/8s degraded — 15s chosen so the two legs never differ by more than one cycle); abort-safe (existing per-page `signal` reused; interval unmount handled by react-query). Error: unchanged shape (F-B extends). Invariant: INV-06/09. Callers: `SatSessionRoomRoute` unchanged (ignores or forwards `partial` into existing `scoresStale`).

**F-B. Same `queryFn` — partial keep**
Reads/Writes: accumulate `all`; per-page try/catch; on page error after ≥1 success return `{items: all, truncated, partial: true}`; on page-0 error throw (existing path). Post: `isStale = isError || partial`. Callers: route maps `partial` into `scoresStale` (one line) — display contract unchanged otherwise.

**F-C. Same `queryFn` — gap signal**
Post: after loop, `gap = total!=null && all.length < total` ⇒ `partial: true` (reuses F-B channel; footnote already exists for `truncated` — reuse stale line, no new UI). Order note: document offset-shift limitation in code comment; no cursor API (constraint).

**F-D. `resolveRoomScore` (`:77-209`)**
New branch (after `invalidated`, before `scored`): `isTerminalDelivery = attemptStatus==='terminated'||attemptStatus==='locked'`; if terminal ∧ ¬invalidated-outcome-scored-path ∧ correct==null ⇒ `not_scored` (label/srLabel existing). Precedence: any non-null `correct` with valid `total`, or outcome `scored`/`pending`+submitted, wins over terminal (regrade-safe). Requires `attemptStatus` already in `AttemptRowInput` (Verified present :37). Callers unchanged.

**F-E. `attemptOutcome` (`SatExamGroupSection.tsx:85-101`)**
Add `case 'ended': return {label:'Ended', tone: satOutcomeTone('invalidated_timeout')}` mirroring `locked`. One line + T-06. Tone reuse keeps palette closed.

**F-F. Roster ticker (`SatSessionRoomRoster.tsx:178-186`)**
Extract `ScoresAgeLine({updatedAt, visible})` memo component owning its own 30s interval, mounted only when the stale paragraph renders. Parent drops `setScoresAgeTick`. Render-count test T-10.

**F-G. `resolveRoomScore` source rule (`:91-94`)**
Replace independent `??` fallbacks with: `if (beCorrect!=null) {correct=beCorrect; total=beTotal(>0 else null)} else {correct=rowCorrect; total=rowTotal(>0 else null)}`. Mixed ⇒ scoring via existing fallthrough. Callers unchanged; MissingPlan+row case becomes scoring (safe direction).

**F-H. `buildScoreProjections` answered (`sessions.go:1525-1542`)**
Move `proj.answered += m.Answered` inside the `counted(key)` gate (keep `proj.modules` append outside — factual listing preserved). T-08. Wire shape unchanged.

**F-I. `buildScoreProjections` zero total (`sessions.go:1543-1551`)**
After sum: `if total<=0 {proj.total=nil; status=scoring (unless unstarted/no-facts)}`. T-09. Wire: previously `&0` becomes omitted — additive-safe direction (FE already nils 0).

**Announce extension (roster :156-176):** include transitions into `not_scored` ("{name} marked not scored") collapsed like upgrades. T-11.

### §LLI-5. Algorithm + happy path + failure branches

Happy path (51 scored, one submits mid-view): mount loop offset 0/50 → 51 merged severity-wins → badges; 15s later refetch picks up new scored row + resultId → badge upgrades in place (`isSameRoomScore` keeps 50 identities; 1 re-renders; announcement collapses to one line); inspector link appears.

Failure branches: page-2 fails → F-B returns 50 + partial → stale dim, age line ticks (footer-only post F-F); traversal gap → F-C partial → same; txn-begin fails → existing fallback (D-02 adds counter); terminated mid-exam → F-D not_scored both before/after facts; zero-total plan → F-I scoring; mixed sources → F-G scoring.

Txn/order notes: no write txns; read-only repeatable attempt retained; no ordering guarantees needed beyond poll cadence.

### §LLI-6. File-by-file sequence with deps (disjoint, parallelizable)

**Agent 1 — FE join/freshness (F-A/B/C + tests T-02/03/04):** `src/products/sat/ui/useRoomScores.ts` only. Then `SatSessionRoomRoute.tsx` one-line `partial→scoresStale` mapping.
**Agent 2 — FE rules (F-D/G + T-01/05/07):** `useRoomScores.ts` `resolveRoomScore` only (merge-safe with Agent 1: different hunks — sequence Agent 2 after Agent 1 to avoid conflicts; or split by hunk).
**Agent 3 — BE sums (F-H/I + T-08/09):** `sessions.go` builder only + `session_projection_score_test.go`. Independent of Agents 1–2 (contract meeting point: `ScoreStatus/correct/total nil-discipline` unchanged).
**Agent 4 — Roster/group polish (F-E/F-F/announce + T-06/10/11):** `SatSessionRoomRoster.tsx`, `SatSessionRoomStudents.tsx` (announce lives in roster), `SatExamGroupSection.tsx`. Independent.
Order: Agents 1+3+4 parallel → Agent 2 (same-file tail) → joint contract tests (T-07 needs BE-nil-plan shape — mocked, no BE dependency).

### §LLI-7. Worked trace (happy + adversarial, tick-by-tick)

```text
Initial: sched S (RW plan 27), A1..A50 scored 18/27, A51 working (9 saved), A52 terminated-no-outcome, A53 unscored-outcome.
1. Mount: pages 0(50,hasMore)/50(1,!hasMore) → 51 merged; BE: A53 not_scored, A52 answering(open facts), rest scored.
2. FE: A1..A50 ✓ 18/27·67%; A51 9/27 answered; A52 Not scored (F-D, was dash); A53 Not scored.
3. Adversarial tick T+15s: A51 submits(scored) between page fetches; page2 shifts → gap (50+1 of 52 incl. newcomer?) → F-C partial + stale dim; T+30s poll heals → A51 scored, announcement "A51 scored 18 of 27".
4. Adversarial: page2 500 at T+45s → F-B keeps 51 + stale; T+60s heals.
5. Adversarial: answered=30/total=27 injection → scoring, left suppressed, no negative (existing).
Final: INV-03b/06/07/09 hold; no key bytes (R1 grep re-run).
```

### §LLI-8. Verification matrix + exact commands (all PROPOSED — not run this round)

```bash
bun run typecheck
bunx eslint src/products/sat/ui/useRoomScores.ts src/products/sat/ui/SatSessionRoomRoster.tsx src/products/sat/ui/SatSessionRoomStudents.tsx src/products/sat/routes/SatExamGroupSection.tsx
bunx vitest run src/products/sat/ui/__tests__/useRoomScores.test.tsx src/products/sat/ui/__tests__/SatSessionRoomStudents.test.tsx src/products/sat/ui/__tests__/satSessionRoomCss.test.ts src/products/sat/routes/__tests__/SatResultsRoutes.test.tsx src/features/proctor
GOCACHE=/tmp/gocache-proctor go vet ./internal/proctor/          # workdir: backend/go
GOCACHE=/tmp/gocache-proctor go test ./internal/proctor/ -run 'TestBuildScoreProjections|TestLoadScore|TestScoreProjection|TestAttemptRowToSession' -v
GOCACHE=/tmp/gocache-proctor go test ./internal/proctor/ ./cmd/api/ -run 'TestSatRooms|TestSatClassroom' -v  # MySQL parts SKIP without TEST_MYSQL_DSN
rg -n 'correctAnswer|isCorrect' backend/go/internal/proctor || true   # expect only NeverEmitsKeyMaterial asserts
```

| Test class | Evidence |
|---|---|
| Unit (FE/BE) | T-01/05/06/07/08/09 + existing suites green |
| Hook/integration | T-02/03/04 (fake timers, mocked gateway multi-page) |
| Component | T-10 render-count, T-11 announce, existing stale/skeleton/sort suites |
| Contract | zod loose unchanged; wire additive (`partial` FE-only; BE `&0`→omit is narrowing-toward-omit, FE already nils) |
| Concurrency | Deterministic merge tests (no sleeps); offset-gap healing via poll |
| Property | T-12 pct bounds |
| Regression | Full `SatSessionRoom*`, `satResults*`, `src/features/proctor` suites |

### §LLI-9. Extensibility probe + unknowns + rollout

**Probe (Math section):** `RoomScore.modules[]` already per-module; F-H keeps factual listing so a Math split needs only `counted()` scope + label anchors — callers, wire, sort untouched. F-G same-source rule transfers unchanged.

**Unknowns (smallest checks, owner-marked):**
1. BE-plan-nil frequency (gates H-01 blast radius): one prod-log/read-dump — does `loadScopedExamPlan` ever return nil plan with rows present? **(Unknown)**
2. Terminated-gradability (gates H-04 BE half): grading-domain answer. **(Unknown)**
3. Scope-edit mid-session (gates H-02 frequency): access-link edit policy. **(Unknown)**
4. Room-role `resultsRead` membership (INV-10 sub-fact): read `backend/go/internal/authz/table_staff.go:254` composition. **(Unknown)**
5. Zod unknown-enum behavior for future `scoreStatus` (D-04): feed unknown member through `validateData` in a unit test. **(Unknown)**
6. `SatResultDetailRoute` unscored rendering (noted §9.3): read `:111-130`. **(Unknown)**

**Rollout:** FE-first safe (interval + partial are additive; F-D/G move badges only toward terminal/scoring, never toward scored). BE second (F-H/I narrow sums; F-H changes `answered` for out-of-scope cases only; F-I changes `&0`→omit). No migration to roll back; revert = single-hunk reverts. No E2E seeding required; hook-level matrix (§LLI-8) is the gate.

---

## Self-review (skill gates)

- Inspected owning functions + all callers/writers (join, resolve, sort, builder, outcomes, both View-link sites, both outcome switches) — yes, with line refs.
- Preserved contracts (additive wire, loose zod, same hook shape + optional `partial`) — yes.
- State+behavior co-owned (projection owns counts, hook owns join, row owns render) — yes, no new owners.
- Rules server-side where authoritative (terminal mapping BE, join fallback FE) — yes; F-D FE-only explicitly justified (BE lacks status input; BE half gated on H-04 answer).
- Pre/post/errors/terminal precise per function — yes (§LLI-4).
- Duplicate/stale/partial covered (F-A/B/C, severity both layers, best-effort nil, identity reuse) — yes.
- No new class/abstraction/cache/queue/lock — yes (interval + branches + guards only).
- Tests exercise enforcement, not mocks (gateway mocked at boundary, assertions on badges/statuses) — yes.
- Verified vs assumed labeled — yes (SPEC-01/02 + six Unknowns).
