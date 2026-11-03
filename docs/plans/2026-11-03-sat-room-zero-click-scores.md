# SAT Room Zero-Click Scores — Implementation Plan

**Date:** 2026-11-03
**Status:** Approved design (Q1–Q12 locked), plan-only — no source edits yet
**Modes used:** low-level-implementation-engineer (plan) + e2edd (E2E-first) + first-principles-systems-engineer (reframe) + instacart-rappi-commerce-interaction-engineering (Phase-3 polish, after FE lands)
**Screenshot:** `Screenshot 2569-11-03 at 21.53.47.png` — Rank 4 Mock 1, 16 Joined, all `0:00 · Finished/Terminated`

---

## 1. Change boundary & repository evidence

### Current behavior (Verified)

* Room route `src/products/sat/routes/SatSessionRoomRoute.tsx` (693 lines) renders:
  `SatSessionRoomRoster` (left) + context column (stage/start-code/needs-attention) + `SatSessionRoomInspector` → `StudentDetail` (right). Shell `src/products/sat/ui/room/SatRoomWorkspace.tsx`.
* Row `SatRoomStudentRow` in `src/products/sat/ui/SatSessionRoomStudents.tsx:31-148` shows only: dot tone, `name + studentId + ⚠`, meta `reading · Finished`, right clock `0:00` (`useAuthoritativeDeadlineClock`), `›`. **No score fields.**
* Live poll: `src/features/proctor/api/proctorQueries.ts:17-23` (`staleTime 15s`, summary 10s floor, detail 15s/8s degraded) → `useProctorRouteController` → `useProctorMonitoring.ts`. Contract `src/features/proctor/contracts/monitoringSchemas.ts:43-59` (`studentSessionSchema` loose) + backend `backend/go/internal/proctor/sessions.go:200-301` (`StudentSessionSummary`). **Verified: no `rawCorrect/rawTotal/answeredCount/classroomRaw` on the wire.** Additive fields pass zod (`looseObject`), so backend can extend without breaking old clients.
* Scores only post-submit (Verified by prior subagent + code read):
  `src/features/results/api/satResultsQueries.ts:31-47,164-178` — `GET /v1/results/sat/attempts?examId=&scheduleId=` returns `SatAttemptRow { resultId, attemptId, rawCorrect?, rawTotal?, estimatedTotal? }`; `GET /v1/results/sat/:resultId` returns `{ summary, scorePayload.classroomRaw, sections[], questions[] }` with `isCorrect: boolean|null` (null = pretest/unanswered/keyless/pending — never render as incorrect, `SatQuestionResponseTable.tsx:128`).
  `SatResultDetailRoute.tsx:149-150` builds view via `classroomRawReport()` + `buildStudentScoreReportView()` — pure function of server payload, never computes score client-side.
* Integrity lock (Verified): `hideKeyAndResult` display-only prop, forced in `SatAttemptAnswersRoute.tsx`, server-enforced null-verdict rule. Keyless answers read `GET .../attempts/:id/answers` (`savedAnswerCount`, 15s poll) deliberately ships no key/verdict.

### Desired behavior (Q1–Q12 locked)

* Zero-click per-student `✓ 18/27 · 67% · M1 9/13 M2 9/14 · 2 left` as second line + right-side `18/27` bold above dimmed clock. Neutral ink, tabular-nums, stacks at 390px/zoom200, SR text `Open {name}, score 18 of 27, 67 percent, reading finished`.
* Live counts yes, live key no. Full Q-table stays in Results via `View answers ›` in inspector (same-tab, return-state preserved).
* Empty states: `—` (never_started/waiting_for_code), `Scoring…` (submitted but pending), `Not scored` (invalidated_proctor/timeout/unscored), `0/27` only when truly 0 correct scored.
* Sort adds `Score: low→high / high→low`. Low score never creates `Needs attention`.
* Phased: **Phase-1 `answered/total` (no grading, shippable)** → **Phase-2 `correct/total` (fenced projection)** in same slot, no layout shift.

### Non-goals

* No scaled 400–1600 in roster (only if converter active — stays in Results detail).
* No per-question key/verdict in room while `Running/Overrun`.
* No new permission model — same staff teacher role that can already open room.
* No change to student delivery, grading, conversion, or `classroomRawScoreTx` writer.

---

## 2. First-principles reframe (why not just “add score column”)

**Real problem:** Teacher with 16 finished `0:00` rows cannot triage without 16 clicks to Responses/Results. Goal is *one-glance triage*, not full audit in room.

**What makes it expensive:** Scores live in results domain (post-submit, per-attempt detail), room lives in proctor domain (live clocks, per-schedule detail). Joining them per-row naively = N+1 reads + key-leak risk + poll amplification (`rate × students × fanout`).

**Hidden assumptions challenged:**

1. Must it be exact correct on every poll? No — `answered/total` (cheap count) already unblocks 80% of triage; `correct/total` can be bounded-stale (15–30s, same as room poll).
2. Must it cover all questions live? No — scored-module `rawCorrect` + open-module `answeredCount` suffices; pretest excluded.
3. Must key ship to grade live? No — grade server-side, ship only counts + verdict-free status. Representation change: **counts, not keys**.
4. Must room poll carry it? Phase-1 no — reuse existing `attempts` list API joined client-side by `attemptId`. Phase-2 yes — single fenced field on detail payload, not a new per-student endpoint.

**Options considered:**

| Class | Idea | Trade-off |
|---|---|---|
| Minimal (chosen P1) | Frontend joins `proctor detail` + `sat attempts` list by `attemptId`; no backend change | 2 queries per room, 30s stale OK, zero integrity risk, works for Finished today; Running shows `answered` only if we add count |
| Structural (chosen P2) | Add `scoreProjection { answered, total, rawCorrect?, rawTotal?, status, modules[] }` to `StudentSessionSummary` | One poll, exact, needs grading-on-read guard + tests; small backend slice |
| Workload change (rejected) | Live per-question verdicts in room | Leaks key via screen-share, violates `hideKeyAndResult` posture, heavy |

---

## 3. Requirements & invariants (E2EDD acceptance)

### E2E scenarios (write first, run with Playwright — `e2e/sat-staff-room-ux.spec.ts` + new `e2e/sat-room-scores.spec.ts`)

```gherkin
Given teacher opens /sat/rooms/:scheduleId with 16 Finished attempts (Rank 4 Mock 1 fixture)
When room loads
Then each row shows "<correct>/<total> · <pct>%” without click
And sort "Score: high→low” reorders rows
And screen reader announces "score 18 of 27"

Given running exam, student A working, student B finished-scored
When teacher views roster
Then B shows "✓ 18/27 · 67%”, A shows "9/27 answered · Scoring…" and no key text appears in DOM

Given invalidated attempt
When roster renders
Then row shows "Not scored" (never "0/27")

Given teacher clicks inspector "View answers ›" on scored student
When detail opens and teacher presses Back
Then room restores same selectedStudentId + search + sort + scroll

Given room poll degrades / results API 500
When scores unavailable
Then rows keep last value + "Updated Xs ago" dims, no zero flash, no key shown
```

### IDs

* `FR-1` Teacher sees per-student `rawCorrect/rawTotal + pct + M1/M2 split + unanswered` zero-click in roster.
* `FR-2` Teacher sorts by score; search/filter preserved; `holdOrder` prevents jump while pointer/focus inside.
* `FR-3` Inspector links scored/saved answers to existing Results detail with return state.
* `RULE-1` Key/correct-choice text never renders while room `Running/Overrun`; per-student key link only when that student `Finished/Terminated + scored`.
* `RULE-2` `— / Scoring… / Not scored` distinct from `0/total`.
* `ERR-1` Missing score → dash + stale guard, not error banner; malformed payload → existing `validateData` error path, room still renders clocks.
* `SCOPE` Phase-1 frontend-only join (Finished scores today). Phase-2 backend projection (live correct). No student, grading, conversion changes.
* `INV-1` One owner per score fact: results domain owns correctness; room only projects. Client never computes score.
* `INV-2` No key/verdict in proctor payloads; `isCorrect:null` never rendered as Incorrect.
* `INV-3` `attemptId` is join key; `attemptRevision + moduleAttemptRevision` remain identity fence (do not join on `studentId`).

---

## 4. Entities, ownership & relationships

| Unit | Responsibility | State (authoritative vs derived) | Lifecycle |
|---|---|---|---|
| `results` service (BE) | Owns correctness: `classroomRaw`, `rawCorrect/rawTotal`, `outcomeStatus` | `student_results.score_payload`, `assessment_module_attempts`, `submitted_at` (auth) | `pending → scored / invalidated_* / unscored` terminal |
| `proctor` service (BE, P2) | Owns live projection only: counts + already-scored correct | Derived read: `COUNT(saved answers)`, `operationalTotal` from plan, `rawCorrect` for sealed modules only | Never transitions attempt; read-only |
| `useRoomScores` (FE new) | Joins room + results, maps to `RoomScore` view-model | Derived, memoized, `staleTime 30s` | `— → Scoring… → scored / Not scored` |
| `SatRoomStudentRow` (FE) | Renders `RoomScore`, nothing more | Props only | Pure |
| `monitoringSchemas` + `StudentSession` | Contract: additive optional score fields | Wire (BE) → type (FE) | Backward compatible |

State transition (roster badge):

| Current | Event/guard | Next | Owner | Side effect |
|---|---|---|---|---|
| `—` | attempt starts, answers saved | `N/total answered` | useRoomScores | badge appears, no alert |
| `answered` | modules sealed + scored | `✓ C/T · pct%` | results | badge upgrades, same slot |
| `answered` | invalidated | `Not scored` | results | grey, no sort penalty |
| any | poll fails | stale (keep last + dim) | FE | no flash to zero |

---

## 5. Exact function-level design

### BACKEND TRACK (sub-agent B) — Phase-2 only; Phase-1 needs no BE change

**B1. `backend/go/internal/proctor/sessions.go:200-301` — extend `StudentSessionSummary` (Verified exists)**

```text
Location: backend/go/internal/proctor/sessions.go :: StudentSessionSummary
Owns: live projection shape only (not correctness)
Reads: student_attempts + assessment_module_attempts + assessment_answers COUNT + exam plan operationalTotal
Writes: none (read model); JSON only, omitempty
Signature: struct add:
  ScoreAnswered *int `json:"scoreAnswered,omitempty"`
  ScoreTotal *int `json:"scoreTotal,omitempty"`
  ScoreCorrect *int `json:"scoreCorrect,omitempty"`   // sealed modules only, null otherwise
  ScoreStatus *string `json:"scoreStatus,omitempty"`  // "unstarted"|"answering"|"scoring"|"scored"|"not_scored"
  ScoreModules []ScoreModuleProjection `json:"scoreModules,omitempty"` // {moduleKey, answered, correct?, total}
Pre: actor is staff (requireSessionReader — reuse, Verified :415)
Post: old clients ignore new keys (loose zod passes); new FE renders counts, never key
Error: on count failure → omit fields (null), never fail whole detail; log + metric
Invariant: ScoreCorrect set ONLY when every counted module is sealed+scored; open module → null + status answering/scoring. Never emit correctAnswer text.
Callers: GetSessionDetail, ListSessions page path (rosterpage.go:30) — keep compatible
```

**B2. `attemptRowToSession(row studentSessionRow, runtime SessionRuntime) StudentSessionSummary` (`sessions.go:1367`, Verified)**

```text
Owns: row→wire mapping + identity fence (do not break)
Reads: + new score columns from loadStudentSessions join
Writes: fills B1 fields
Pre: runtime identity fields present (attemptRevision etc.)
Post: ScoreTotal = operationalTotal from scoped plan (filterSessionPlanScope, :1047); ScoreAnswered = COUNT non-empty responses; ScoreCorrect = SUM sealed rawCorrect else null
Error: plan missing → ScoreTotal nil → FE shows "—"; grading error → ScoreCorrect nil + status scoring
Invariant enforcement: SQL is single read txn (RepeatableRead); no write; revision guard unchanged
```

**B3. `loadStudentSessions(ctx,q,scheduleID)` (`sessions.go:1263`, Verified) — add LEFT JOIN counts**

* Pseudocode (happy path):
  1. Load attempts + active module (existing).
  2. `SELECT attempt_id, COUNT(*) FILTER (WHERE response IS NOT NULL AND response <> '') , SUM(CASE WHEN module_sealed AND scored THEN raw_correct END)` grouped by attempt — single query, indexed on `schedule_id`.
  3. Map by `attemptId`; pretest questions excluded via `is_pretest=false` (match `SatQuestionResult.isPretest` semantics).
* Edge: 100-student room → one grouped query, not N+1. Param: `LIMIT` reuse rosterpage limit. Cost: `O(students)` rows, bytes ~ `students × ~40B` — negligible vs existing detail payload.
* Concurrency: read-only; duplicate polls idempotent; stale module revision → omit that module (FE shows answering), never guess.

**B4. Tests (BE):** extend `session_projection_test.go`, `session_projection_runtime_identity_test.go`, new `session_projection_score_test.go`:
unit (sealed→correct set, open→null, pretest excluded, invalidated→not_scored), integration (MySQL: `sat_rooms_mysql_test.go` pattern + `sat_classroom_mysql_test.go:445` rawCorrect shape), concurrency (two polls same revision → identical; revision bump → new wins).

### FRONTEND TRACK (sub-agent F) — Phase-1 shippable without B

**F1. Types + contract (additive, no break)**

```text
src/types.ts :: StudentSession — add optional (Verified interface :795):
  scoreAnswered?: number|null; scoreTotal?: number|null;
  scoreCorrect?: number|null; scoreStatus?: "unstarted"|"answering"|"scoring"|"scored"|"not_scored"|null;
  scoreModules?: Array<{moduleKey:string; answered:number; correct:number|null; total:number}>|null;
src/features/proctor/api/proctorQueries.ts :: ProctorSessionDetailPayload.sessions[] — mirror same 5 keys (Verified :60-111).
src/features/proctor/contracts/monitoringSchemas.ts :: studentSessionSchema — looseObject already passes additives; add explicit nullish keys for docs (no validation tightening).
src/features/proctor/hooks/useProctorMonitoring.ts — map new keys through (check file; keep fallback null).
```

**F2. New `src/products/sat/ui/useRoomScores.ts` (Proposed; verify path — follow `sessionRunSheet.ts` pattern)**

```text
Owns: join + view-model, never grading
Reads: proctor detail sessions (live) + useSatAttemptsQuery(examId,scheduleId) page (results, staleTime 30s)
Writes: none; returns Map<attemptId, RoomScore>
Signature: useRoomScores(scheduleId:string, examId:string|null, sessions:StudentSession[]) -> { byAttempt: Map<string,RoomScore>, isStale:boolean, updatedAt:number }
RoomScore = { kind:"dash"|"answering"|"scoring"|"scored"|"not_scored"; answered:number|null; correct:number|null; total:number|null; pct:number|null; modules:…; label:string; srLabel:string }
Pre: scheduleId non-empty; examId may be null → then only BE projection (P2) or dash
Post: Finished+scored attempt with SatAttemptRow.rawCorrect!=null → scored even before BE ships (Phase-1 today)
Error: results query error → fall back to BE fields or dash; never throw; isStale=true dims badge
Invariant: join on attemptId only; prefer BE ScoreCorrect when present (fresher), else results row; never compute correct from answers client-side.
Callers: SatSessionRoomRoute passes byAttempt to Roster + Inspector.
```

**F3. `SatSessionRoomRoster.tsx:30-38,40-228` (Verified) — sort + passthrough**

* Extend `SatRosterSort` with `'score_asc'|'score_desc'`; `SORT_OPTIONS` adds `Score: low→high / high→low`; `sortRoster()` ties to `byAttempt.get(id)?.correct ?? -1` (dash/not_scored sort last, stable by name). Reuse `holdOrder` anti-jitter — no change.
* Props add `scores: Map<string,RoomScore>`; pass to `SatRoomStudentRow`.

**F4. `SatSessionRoomStudents.tsx:31-148` (Verified) — zero-click render**

```text
SatRoomStudentRow props += score: RoomScore|null
Render: keep grid cols [minmax(0,1fr)_auto]; left second line:
  scored → "✓ 18/27 · 67% · M1 9/13 M2 9/14 · 2 left" (truncate, tabular-nums)
  answering → "9/27 answered"
  scoring → "Scoring… 9/27 answered"
  not_scored → "Not scored"
  dash → existing meta only (no badge)
Right: scored → <span 15px semibold tabular>18/27</span> above dimmed clock; else clock only (unchanged).
a11y: aria-label += srLabel; color: neutral var(--sat-staff-text-*), no red/green; focus ring unchanged.
Micro: no new animation; number change is text swap only (motion-reduce safe).
```

**F5. `StudentDetail` (`:150-398`, Verified) + `SatSessionRoomRoute.tsx:419` — inspector**

* Add `Score summary` block reusing `RoomScore` + existing `SatAttemptDetailHeader` copy pattern; `View answers ›` `<Link to={/sat/results/:resultId or /sat/attempts/:attemptId/answers}?from=room&scheduleId=&studentId=>` only when `resultId` or saved answers exist; else hide (never disabled key teaser).
* Return-state: `useSatListReturn` + `rememberRoom` pattern — stash `{selectedStudentId, search, rosterSort, attentionFilter}` in `location.state`; on back, restore + focus `[data-sat-room-student-heading]`.

**F6. Tests (FE):** `src/products/sat/ui/__tests__/SatSessionRoomStudents.test.tsx` (extend — Verified exists) + new `useRoomScores.test.tsx`: scored/answering/scoring/not_scored/dash, sort order, aria, 390px wrap (existing css harness), holdOrder no-jump. E2E `e2e/sat-room-scores.spec.ts` per §3 (Playwright, no mocks — seed Rank 4 Mock 1 fixture via `sat_classroom` helpers).

---

## 6. Concrete implementation sequence (for sub-agent split)

**Agent F (frontend, no BE dependency):**

1. F1 types/contract (additive) + `tsc --noEmit`.
2. F2 `useRoomScores` + unit tests (vitest).
3. F3–F4 roster row + sort + css (`sat-session-room.css` — check `@md` inline rule `:120` before unhiding `studentId` on wide).
4. F5 inspector link + return-state.
5. E2E scenarios §3 against seeded data (Finished scores via results API; Running shows answering/dash).

**Agent B (backend, parallel, Phase-2):**

1. B3 query + B1 struct + B2 mapping (behind no flag — null-safe).
2. BE unit + MySQL integration (copy `satRoomsHarness` pattern in `sat_rooms_mysql_test.go:21-32`).
3. Deploy note: old FE ignores new keys; new FE prefers BE when present — safe rolling.

**Dependencies:** F never blocks on B (falls back to results join). B never changes grading/conversion. Contract meeting point: `attemptId → {answered,total,correct?,status,modules[]}` JSON keys exactly as F1.

---

## 7. Worked trace (happy + adversarial)

```text
Initial: schedule S (classroom, RW-only, 27 operational, 0 pretest counted), attempt A finished-scored (raw 18/27, M1 9/13 M2 9/14), attempt B working (9 saved), attempt C invalidated_proctor.
1. Teacher GET detail → sessions [A,B,C] (no scores yet in P1 BE) + GET attempts?scheduleId=S → rows [A:18/27 scored, C:not_scored].
2. useRoomScores joins: A→scored "✓ 18/27 · 67% · M1 9/13 M2 9/14 · 2 left"? wait 18+? unanswered = 27-answered; if answered 25 → "· 2 left" (derived, not stored). B→answering "9/27 answered" (total from plan 27). C→"Not scored".
3. Sort high→low → [A(18), B(answered, -1 tie → name), C(last)].
4. Adversarial: B submits between polls, results stale 30s → row keeps "9/27 answered" + dimmed, never flashes "0/27"; next poll upgrades to scored in same slot. Concurrent poll with bumped attemptRevision → newer projection wins (fence unchanged).
Final: INV-1/2/3 hold; no key bytes in proctor responses (verify via e2e request log — existing `sat-room-requests.txt` pattern).
```

---

## 8. Verification — final gate loop (sub-agent R, independent)

**Gate R1 — contract recheck (no code):** R re-reads diff vs this plan: every P0 maps to a method, no public method for speculation, no key in proctor payload (grep `correctAnswer|isCorrect` in `internal/proctor`), zod loose unchanged, `StudentSession` additive only.

**Gate R2 — tests (must run, not mocked):**

```bash
bun run typecheck          # tsc --noEmit
bun run lint
bunx vitest run src/products/sat/ui/__tests__/SatSessionRoomStudents.test.tsx src/features/results/api/__tests__
bunx vitest run src/features/proctor
bun run test:run           # full vitest
# BE (needs Go + MySQL per AGENTS.md)
go test ./internal/proctor/ -run 'TestAttemptRowToSession|TestStudentSessionColumns|Score' -v
go test ./cmd/api/ -run 'TestSatRooms|TestSatClassroom' -v
bunx playwright test e2e/sat-room-scores.spec.ts e2e/sat-staff-room-ux.spec.ts
```

**Gate R3 — E2E evidence:** screenshots 1440/768/390 + zoom200 (existing `e2e/__screenshots__/staff-ui-parity/sat-room-*` pattern), request log asserts no `/answers` key fetch during Running, a11y check (keyboard ↑/↓, focus ring, SR label), perf: 100-row roster no layout shift (`holdOrder`).

**Definition of done (e2edd):** all §3 scenarios pass + existing E2E suite passes + logs meaningful + docs updated (this file linked from `docs/plans/`). Flaky → root-cause, never bump timeout without evidence.

---

## 9. Extensibility & remaining risks

* **One probe:** Math section later → `RoomScore` already per-section (`sectionKey` in modules); roster line becomes `RW 18/27 · Math —` without new owner — only `useRoomScores` grouping changes.
* **Unknowns (labelled):** `operationalTotal` for flexible M1-only rooms (`sat_flexible_count`, `sat_classroom_plan`) — confirm `filterSessionPlanScope` total matches `SatAttemptRow.rawTotal`; smallest check: one MySQL row dump for Rank 4 Mock 1. Estimated 400–1600 in roster explicitly out of scope until converter UX decided.
* **Rollout:** FE-first safe (dashes where no data); BE second additive; rollback = revert BE (FE falls back) — no migration to roll back.
* **Best-practice code notes for agents:** follow repo idioms (Bun not npm, `bunx` not `npx`, Node 20+ on PATH); narrow diffs, no incidental renames; `tell-don't-ask` (rules next to state in `attemptRowToSession`, not in UI); typed errors (`MonitoringIdentityError` pattern); deterministic tests, no sleep-based concurrency proof.

---

## 10. Phase-3 polish — Instacart/Rappi interaction pass (after FE lands, before R gate)

*Scope: same FE files only, narrow diff on top of functional scores. No new data, no BE change.*
*State before motion: each RoomScore kind gets rest/loading/stale/error visuals; stale-while-revalidate (dim + Updated Xs ago); shape-preserving skeleton on first load; inline persistent correction on error (never toast-only for scores).*
*Motion intent only: badge update = 120–180ms fade (feedback.value), sort = list diff with scroll+focus preserved, back from View answers = restore roster scroll + focus to invoking row. `reducedMotion="user"` — instant/opacity swap, state cue preserved.*
*Consistency (cart analogy): roster row + inspector + Results detail read same `byAttempt` Map; server authoritative, no optimistic correct.*
*A11y/perf: 44–48px sort/filter targets, polite live for upgrades, per-row subscription (no whole-grid rerender), transform/opacity only, 390px/zoom200 stacking verified.*

**Next:** Agent F + Agent B in parallel per §6, then Phase-3 polish agent per §10, then Agent R gate per §8. Do not edit source until agents start from this plan.
