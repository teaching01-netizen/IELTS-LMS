# SAT staff result panel: fix blank Performance/questions + result UX

## Context
In Responses → room → "View answers", the side sheet shows "Raw results available",
"Estimated total unavailable", then an **empty Performance** section and
**"Question-level responses (54)" with no table**. The list also says "Score pending"
for the same completed+scored attempt.

Root cause (verified in code):
- `results.GetSATResult` (`backend/go/internal/results/service.go:812`) builds
  `sections` from `assessment_section_results`, but **no production code ever inserts
  into that table** (only DELETE/SELECT). Classroom submissions store scores only in
  `assessment_results.score_payload.classroomRaw` (`terminalization/service.go:1016`).
  So `sections` is always `[]`.
- `SatResultDetailRoute.tsx` renders both Performance (`sections.map`) and the question
  tables (`sections.map` → `questionsBySection`) by iterating `sections`, so 54 loaded
  questions are silently dropped.
- List label (`SatExamGroupSection.tsx:108`) keys on `totalScore`, which is `NULL` for
  every classroom result → "Score pending" even when `outcomeStatus === 'scored'`.
  Same cause makes `scoreFilter=available` (`service.go:750`, `total_score IS NOT NULL`)
  match nothing.
- Answers/keys are raw option ids (`correctOptionId`), unreadable for staff; questions are
  labeled `"<uuid> · <moduleKey>"`.

"Estimated total unavailable" is likely correct behaviour (single subject, or module
counts/section keys don't match a `sat-global-v2` table) but the UI never says why.

## Backend (Go)

1. **Sections from modules** — `internal/results/service.go`
   - Add `satSectionsFromModules(modules []SATModule, sectionKeys []string) []SATSection`:
     group by section key in module order, sum `RawCorrect`/`Operational`, set `Route`
     to `higher`/`lower` from the branch module's `AdaptiveRole`, nest modules.
   - In `GetSATResult` scored branch: if `satSections` returned no rows, use the
     synthesized sections (keep table rows when they exist). Drop the now-redundant
     `attachSATModules` call in that path only.
2. **Readable answers** — `internal/assessscore/score.go` + `satQuestionsQ`
   - Add `SATChoiceLabels(answerJSON) map[string]string` (option id → "A","B",… by
     `options` order; empty for SPR).
   - Extend `SATQuestion` with `Kind string`, `ResponseLabel string`,
     `CorrectLabel string` (`omitempty`). Fill from the already-loaded `answerDef`.
     SPR: labels = raw text. No key leak: endpoint is already staff-only and already
     returns `correctAnswer`.
3. **List score** — `ListSATAttempts`
   - Select `JSON_EXTRACT(ar.score_payload,'$.classroomRaw')`; call
     `satscoring.ActiveRevision` **once per page**, `ApplyRevision` per row.
   - Add `RawCorrect *int`, `RawTotal *int`, `EstimatedTotal *{low,high}` to `SATAttemptRow`.
   - `scoreFilter=available/unavailable`: treat `outcome_status='scored' AND
     (total_score IS NOT NULL OR JSON_EXTRACT(...classroomRaw) IS NOT NULL)` as available.
4. Tests: `service_test`-style unit tests for `satSectionsFromModules` (RW+Math, single
   subject, adaptive route) and `SATChoiceLabels`; extend existing results/list tests for
   the new row fields and filter.

## Frontend

5. **Types** — `src/features/results/api/satResultsQueries.ts`: add `kind`,
   `responseLabel`, `correctLabel` to `SatQuestionResult`; `rawCorrect`, `rawTotal`,
   `estimatedTotal` to `SatAttemptRow`.
6. **Result detail** — `src/products/sat/routes/SatResultDetailRoute.tsx`
   - Build the score view with the existing pure
     `buildStudentScoreReportView(classroomRaw)` from
     `features/student-delivery/ui/transitions/score-report/scoreReportViewModel.ts`
     (handles full / single-subject / partial / raw-only; never invents scores). Replace
     the local `estimatedScores` parser with it.
   - **Score header card** (replaces "Raw results available"): big estimated total (or
     single-subject estimate, or raw "X of Y correct"), scale 400–1600 / 200–800,
     converter version + "not an official SAT score", and when unavailable a concrete
     reason derived from payload: unrecognized section key / module route, or "No
     conversion table for M1 n + M2 m questions in <converter>" + link to Score Conversion.
     Keep the PDF download button.
   - **Answer summary strip**: Correct · Incorrect · Unanswered · Marked · Pretest counts
     from `questions`.
   - **Performance**: one staff-styled card per subject — estimated section score, raw
     `x / y` with accuracy bar, adaptive route, modules ("Module 1 · Base",
     "Module 2 · Higher/Lower" via `fallbackModuleLabel`), and domain accuracy rows from
     the view's `domains` (classroomRaw.domains).
   - **Questions**: group by `question.sectionKey` directly (order: R&W, Math, then
     others) so rows can never disappear again.
7. **SAT question table** — new `src/products/sat/ui/SatQuestionResponseTable.tsx`
   (don't change shared `components/results/QuestionRawTable.tsx`, which IELTS
   `AdminResults` uses). Staff tokens; columns `Q# · Module | Student answer | Key |
   Result`; letters with option id in `title`; filter chips All / Incorrect /
   Unanswered / Marked; search; "Not scored" for null verdicts (never "Incorrect");
   pretest badge. Reuse it in `SatAttemptAnswersRoute.tsx` with the key/result columns
   hidden.
8. **List** — `SatExamGroupSection.tsx` `totalScoreLabel`: estimated total range →
   else `raw x/y` when `outcomeStatus==='scored'` → existing fallbacks. "Score pending"
   only when actually pending.
9. Tests: update `SatResultsRoutes.test.tsx` fixtures to the real shape (classroomRaw +
   empty `sections` table rows) and assert Performance cards, grouped question rows,
   letters, unavailable-reason text; list label test for scored-without-totalScore.

## Verification
- `cd backend/go && go test ./internal/results/... ./internal/assessscore/... ./internal/satscoring/...`
- `bun run typecheck && bunx vitest run src/products/sat src/features/results src/components/results`
- `bun run lint`
- Browser: `bun run dev`, open Responses → test → pee → Warwick Institute: confirm score
  card, Performance cards with modules/domains, 54 rows grouped by section with A–D
  letters, filter chips; list row shows score instead of "Score pending". Screenshot.
