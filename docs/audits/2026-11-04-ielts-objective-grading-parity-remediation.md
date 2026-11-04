# IELTS objective-grading parity — remediation record

Date: 2026-11-04
Base: `main` @ `b6decea5` (uncommitted working tree, which implements `correct-answer.md`)

## Why

Three reviews of the working tree (Standards axis, Spec axis, business-logic
edge-case audit) found that the "the server's saved result is the official
score, and grading key handling is identical on Go and TypeScript" goal was not
fully met. This change set applies the P1–P3 remediation slices and the
documented export-version invariant. It is read-time only: no migration and no
database change.

## What changed

### P1 — saved result is the only score/display source

- `buildGroupedTracebackItem` reads the saved group representative's
  `awardedScore`/`maxScore`/`isCorrect` instead of hardcoding one mark. Group
  rows now show the saved 2/2 mark for `maxScore: 2` overrides and tree groups.
- `buildWideObjectiveExport` totals still derive from the same saved per-question
  results the rows display (kept derive-first so legacy submissions whose saved
  section totals disagree with their per-slot results keep the documented
  fallback), and the band follows the same total. With the traceback fix the
  derived total equals the saved total for consistent data.
- `scoreSectionForRecheck` is the one website-recheck implementation; the
  overview warning now consumes it (grouped/pooled/tree verdicts included) and
  no longer carries its own slot/pool recheck. The old
  `resolveWebsiteRecheck`/`computePoolVerdicts` duplicate was deleted.
- Displayed right answers are the effective grading keys: additive union for
  `DIAGRAM_LABELING`, `FLOW_CHART`, `CLASSIFICATION`, `MATCHING_FEATURES`;
  primary-wins for `MAP`; existing single-winner rows unchanged. The admin
  README rule was updated to match.

### P2 — one cleaning/pool rule on both stacks

- `foldCaseForMatching` (TS) mirrors Go's simple-lowercase fold by collapsing
  the two full-vs-simple divergences (`U+0130`, final sigma) before
  `toLowerCase`; `strings.ToLower` is named `foldAnswerCase` on the Go side.
- `cleanAnswer` now treats `U+0085` (NEXT LINE) as whitespace, matching
  `strings.Fields`.
- Shared-pool de-duplication now uses the grading cleaner plus the same fold,
  not the display-key cleaner. A pool with invisible-character or quote
  variants produces the same number of usable keys on both stacks.
- Shared-pool seeding (`mergeSharedSentenceAnswerPool`) keeps case-distinct
  authoring variants even when the question opts out (blocks README); grading
  still folds them for an opt-out pool.
- `NOTE_COMPLETION` gained the same `acceptAnyAnswerKey` / `sharedAcceptedAnswers`
  grading path as sentence completion (types, effective-key resolver, pool
  grouping, display resolver). Authoring UI is deliberately not included.
- New shared fixtures read by both test suites:
  `shared-pool-consumption.json` (pool size + one-shot consumption) and five
  new `student-input-vectors.json` vectors (Turkish İ, Greek sigma, ß,
  NEXT LINE).

### P3 — edge correctness / export version

- Per-student export coalescing accumulates every member verdict of a score
  group and evaluates the threshold once, fixing 3+ slot groups.
- `countAnsweredQuestions` uses the shared required-correct rule for note
  completion groups (third stale copy removed).
- Per-student export resolves each section's exam content from the version
  recorded on the saved result (`autoGradingResults.integrity.
  gradingSourceVersionId`), grouping submissions by version. Legacy callers
  without the new dependency keep the previous single-session-state path.
- `getGroupedScoringSlotKey` / `resolveGroupedScoringRequiredCorrect` now live
  in `src/utils/gradingGroups.ts`; the three copies were deleted.
- The shared key-source manifest now separates single-winner rows from
  `additiveRows`, so it no longer certifies a field grading never reads.

## Decisions

- **D3 (pool consumption order)** — locked: first matching unused key in blank
  order; case variants are distinct only in strict mode. Pinned by the shared
  fixture.
- **D6 (display rule)** — implemented as "display the effective grading key
  list"; admin README updated.
- **D7 (mixed grading versions)** — implemented per submission rather than
  failing the export; no UI surfacing added.

## Deliberately deferred / still open

- **D1 MCQ partial credit**: projection and website award per-selection marks;
  the submit-time `scoreObjective` path remains all-or-nothing. Owner decision
  still required.
- **D2 released results**: not regraded by default; the audited released-regrade
  path is unchanged.
- **D4 note-completion shared-pool authoring UI**: grading parity only; the
  builder toggle/merge UI is a separate product slice.
- **D5 sealed `answer_definition` producer**: `parseObjectiveKey` reads
  `caseSensitive`, but no current producer writes it — the submit-time opt-out
  is inert until that path is confirmed.
- **F12 pool overrides**: Go takes the pool key list from the first slot's
  overridden keys and ignores later-slot overrides for pool consumption;
  characterized only, no TS change made.
- **P4.3**: the test-only `answersMatch` alias remains; `htmlToPlainText` and
  other pre-existing lint warnings are untouched.

## Verification (this change set)

- `bunx tsc --noEmit` — pass.
- ESLint over changed files — 0 errors (pre-existing warnings only).
- Targeted grading/review/export tests — pass (including new regression tests
  for grouped saved marks, overview warning, display keys, pool parity, note
  pools, 3-slot coalescing, note answered-count, export version pinning).
- `go test ./internal/grading/...` — ok.
- `bun run e2e:ielts-case` — 34/34 pass.
- Full `vitest run`: 7,818 pass, 9 failures in 6 files. All nine are
  pre-existing and in files this change set does not touch: SAT calculator /
  floating tool / phase copy / selection breaker, the SAT `lateEvidence`
  architecture edge, and load-runner catalog classification gaps. Evidence:
  those files are unmodified; the SAT calculator failure reproduces in
  isolation; the catalog failures list SAT entries only.

## Follow-up code-review fix pass (same day)

An independent two-axis review (Standards + Spec) plus a regression sweep ran over
this working tree. It found two regressions, one documentation/display contract
gap, and CI/test gaps. All are fixed in the working tree; the deferred list above
is unchanged.

### Regressions fixed

- **Grouped NOTE_COMPLETION answered state** — `questionsForGroupedScoringSlot`
  had branches for sentence/table groups only, so the new grouped note roots were
  invisible to `isQuestionAnswered` / `isQuestionFullyAnswered`: a fully answered
  2-required note group reported "partial" forever and the footer summary counted
  answered and partial independently. Both completion types now share one
  `completionGroupMembers` helper (marker `sentence`/`note`), matching
  `buildCompletionSlotDescriptors`. Pinned by
  `src/services/__tests__/examAdapterService.studentQuestions.test.ts` and the
  grouped-note vertical-slice test in `e2e/ielts-case-sensitive-note.spec.ts`.
- **Sealed SINGLE_MCQ fallback** — when a legacy content snapshot has no readable
  option key, the pinned version's sealed `answer_definition` fills the spec. The
  fallback stored `normalizeAnswer(optionID)` while `ExactID` compares raw option
  ids, so `opt-1111` became `opt 1111` and could never match. The fallback now
  copies exact-ID kinds verbatim and only cleans free-text keys. Pinned by
  `backend/go/internal/grading/projection_sealed_fallback_test.go`.

### Display / documentation contract fixed

- `src/components/admin/README.md` now states the real single-winner precedence
  (`acceptedAnswers` first for MATCHING/CLOZE/SHORT_ANSWER/completion
  blanks/TABLE_COMPLETION; `correctAnswer` first for TFNG/MAP) and MATCHING's
  `correctHeading` fallback.
- `getCorrectAnswerDisplay` now renders the effective grading keys for MATCHING
  (heading text) and TFNG, so a key stored only in `acceptedAnswers` displays and
  grades the same way. The accepted-answer display path delegates to
  `getEffectiveAcceptedAnswersForGrading` instead of re-dispatching on block type,
  removing one duplicated key-source table. Pinned by
  `src/components/admin/__tests__/gradingAnswerDisplay.test.ts`.

### CI and test gates widened

`.github/workflows/grading-parity.yml` now runs the new shared contracts
(`studentInputVectors`, `sentenceCompletionAnswerPool`, `subAnswerTree`, the
student-adapter grouped-slot tests, the display-key tests and `e2e:ielts-case`),
and its path filters include `src/utils/gradingGroups.ts`, the IELTS e2e specs,
the shared e2e fixture helper and `playwright.ielts-case.config.ts`.

### Review-driven refactors (no behavior change)

- One `mapAcceptedAnswers` helper owns accepted-answer writes; the five block
  editors, the five `answerKeyOverview` branches and the builder's repeated
  Accepted-Answers JSX (`AcceptedAnswersField`) all use it.
- Per-student export carries one `ObjectiveRowContext` instead of two parallel
  maps, the `'unknown'` version sentinel is gone (the map is keyed by
  `string | undefined`), and the integrity walk is one
  `savedGradingSourceVersion` helper.

### Verification for this pass

- `bunx tsc --noEmit --incremental false`: no errors in any file this change set
  touches. It does surface pre-existing SAT type errors in
  `src/features/student-delivery/ui/tools/*` (committed earlier on `main`; the
  original incremental `tsc` run had been cache-masked — same files as the
  pre-existing SAT test failures, untouched here).
- `go test ./internal/grading ./internal/exams` — pass.
- Affected vitest suites (grading, admin, builder, adapter, pool, tree) — pass;
  remaining failures are the pre-existing SAT ones listed above.
- `bun run e2e:ielts-case` — pass (now also covers grouped-note answered state).
