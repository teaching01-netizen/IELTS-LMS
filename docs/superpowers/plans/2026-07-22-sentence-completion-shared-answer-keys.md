# Sentence Completion Shared Answer Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-sentence shared answer-key mode for sentence completion without changing student answer payloads, while keeping frontend review and backend auto-grading consistent and preventing duplicate-key scoring.

**Architecture:** Keep the existing `SentenceCompletionQuestion.blanks[]` slot model and add optional question-level shared-key fields. A TypeScript utility and an equivalent Rust resolver define effective keys, while a sentence-level one-to-one consumption rule is applied by both review grading and backend objective auto-grading. The builder uses the same pool utility for reversible authoring, word-rule upgrades, and warnings; the student renderer and autosave contracts remain unchanged.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Rust 2021, serde_json, Cargo workspace.

---

## File map and ownership

- Modify `src/types.ts` — add optional question-level shared-answer fields.
- Create `src/utils/sentenceCompletionAnswerPool.ts` — TypeScript pool resolution, normalized pool counting, and deterministic one-to-one slot matching.
- Create `src/utils/__tests__/sentenceCompletionAnswerPool.test.ts` — pure utility regression tests.
- Modify `src/components/blocks/SentenceCompletionBlock.tsx` — per-sentence toggle, reversible pool seeding, shared editor, and inline warning.
- Create `src/components/blocks/__tests__/SentenceCompletionBlock.sharedAnswerKeys.test.tsx` — builder interaction tests.
- Modify `src/utils/validationUtils.ts` — keep the legacy block-validator path aligned with shared-mode answer presence.
- Modify `src/utils/examUtils.ts` — local publish validation warning and shared-mode answer presence rules.
- Modify `src/utils/__tests__/validationUtils.test.ts` — shared-mode validation and warning coverage.
- Modify `src/utils/__tests__/examUtils.questionCounting.test.ts` — typed warning and `canPublish` coverage.
- Modify `src/components/admin/gradingAnswerUtils.ts` — shared-pool display and sentence-level review correctness.
- Modify `src/components/admin/gradingReviewUtils.ts` — apply shared-mode correctness to non-grouped traceback slots without changing existing grouped scoring.
- Modify `src/components/admin/__tests__/gradingAnswerUtils.test.ts` — review-grading regressions.
- Create `src/components/admin/__tests__/gradingReviewUtils.sharedAnswerKeys.test.ts` — traceback-level duplicate-key regression.
- Modify `backend/crates/application/src/validation.rs` — server-authoritative shared-mode validation and non-blocking warnings.
- Modify `backend/crates/application/src/grading/mod.rs` — server-authoritative shared-pool resolution and one-to-one objective scoring.
- Modify `backend/tests/contracts/builder_contract.rs` — draft/version round-trip coverage for the optional fields.
- Modify `backend/tests/contracts/grading_contract.rs` — backend auto-grading contract coverage for permutations and duplicate answers.
- Modify `backend/tests/contracts/student_contract.rs` — delivery contract coverage proving answer arrays remain unchanged.
- Modify `src/components/blocks/README.md` — document shared sentence answer-key invariants and the submission compatibility rule.

## Task 1: Add the TypeScript answer-pool domain utility

**Files:**
- Modify: `src/types.ts`
- Create: `src/utils/sentenceCompletionAnswerPool.ts`
- Test: `src/utils/__tests__/sentenceCompletionAnswerPool.test.ts`

- [ ] **Step 1: Write failing pure-function tests.**

Add tests for these exact cases:

```ts
it('keeps legacy questions in per-blank mode', () => {
  const question = buildQuestion({
    blanks: [
      { correctAnswer: 'alpha', acceptedAnswers: ['alpha', 'a'] },
      { correctAnswer: 'beta', acceptedAnswers: ['beta', 'b'] },
    ],
  });

  expect(getEffectiveSentenceAcceptedAnswers(question, 0)).toEqual(['alpha', 'a']);
  expect(getEffectiveSentenceAcceptedAnswers(question, 1)).toEqual(['beta', 'b']);
});

it('derives the shared pool from all blank keys when the optional pool is absent', () => {
  const question = buildQuestion({
    acceptAnyAnswerKey: true,
    blanks: [
      { correctAnswer: 'alpha', acceptedAnswers: ['alpha'] },
      { correctAnswer: 'beta', acceptedAnswers: ['beta'] },
    ],
  });

  expect(getSharedSentenceAnswerPool(question)).toEqual(['alpha', 'beta']);
  expect(getEffectiveSentenceAcceptedAnswers(question, 0)).toEqual(['alpha', 'beta']);
  expect(getEffectiveSentenceAcceptedAnswers(question, 1)).toEqual(['alpha', 'beta']);
});

it('treats an explicitly empty shared pool as authoritative', () => {
  const question = buildQuestion({
    acceptAnyAnswerKey: true,
    sharedAcceptedAnswers: [],
    blanks: [{ correctAnswer: 'alpha', acceptedAnswers: ['alpha'] }],
  });

  expect(getSharedSentenceAnswerPool(question)).toEqual([]);
});

it('counts case-insensitive normalized keys once', () => {
  const question = buildQuestion({
    acceptAnyAnswerKey: true,
    sharedAcceptedAnswers: ['Physical Chemistry', 'physical-chemistry', 'THERMODYNAMICS'],
    blanks: [{ correctAnswer: '', acceptedAnswers: [] }, { correctAnswer: '', acceptedAnswers: [] }],
  });

  expect(countUniqueSharedSentenceKeys(question)).toBe(2);
});

it('allows permutations but consumes one matching key only once', () => {
  expect(matchSharedSentenceAnswers(['beta', 'alpha'], ['alpha', 'beta'])).toEqual([true, true]);
  expect(matchSharedSentenceAnswers(['alpha', 'alpha'], ['alpha', 'beta'])).toEqual([true, false]);
  expect(matchSharedSentenceAnswers(['unknown', 'alpha'], ['alpha', 'beta'])).toEqual([false, true]);
});
```

Use a small `buildQuestion` test helper that creates the required `id`, `sentence`, `blanks`, and `answerRule` fields. Do not alter production behavior in this step.

- [ ] **Step 2: Run the focused test and verify it fails.**

Run:

```bash
npx vitest run src/utils/__tests__/sentenceCompletionAnswerPool.test.ts
```

Expected: FAIL because the new fields and utility exports do not exist.

- [ ] **Step 3: Add the optional model fields and minimal utility implementation.**

Extend `SentenceCompletionQuestion` with:

```ts
acceptAnyAnswerKey?: boolean;
sharedAcceptedAnswers?: string[];
```

Implement these exported functions in `src/utils/sentenceCompletionAnswerPool.ts`:

```ts
export function getSharedSentenceAnswerPool(question: SentenceCompletionQuestion): string[];
export function getEffectiveSentenceAcceptedAnswers(
  question: SentenceCompletionQuestion,
  blankIndex: number,
): string[];
export function countUniqueSharedSentenceKeys(question: SentenceCompletionQuestion): number;
export function mergeSharedSentenceAnswerPool(question: SentenceCompletionQuestion): string[];
export function matchSharedSentenceAnswers(
  studentAnswers: readonly unknown[],
  acceptedAnswers: readonly string[],
): boolean[];
```

Rules for the implementation:

1. `acceptAnyAnswerKey !== true` always returns the selected blank’s existing `resolveAcceptedAnswers(blank)` values.
2. An explicitly present `sharedAcceptedAnswers` array, including `[]`, is authoritative.
3. If shared mode is enabled and the field is absent, derive the pool from each blank's primary `correctAnswer` followed by its accepted variants. Deduplicate pool membership using accepted-key normalization (case preserved, formatting normalized), while retaining the first display spelling for each authoring key.
4. When re-enabling shared mode, merge a saved non-empty pool with the current derived blank-key pool in saved-key order, preserving manual additions. An explicitly empty saved pool remains empty.
5. `matchSharedSentenceAnswers` normalizes each non-empty student value with `normalizeAnswerForMatching`, accepts it only if it is in the normalized pool, and consumes that normalized key after the first match. Preserve answer-slot order in the returned boolean array.

- [ ] **Step 4: Run the focused test and verify it passes.**

Run:

```bash
npx vitest run src/utils/__tests__/sentenceCompletionAnswerPool.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the domain utility.**

```bash
git add src/types.ts src/utils/sentenceCompletionAnswerPool.ts src/utils/__tests__/sentenceCompletionAnswerPool.test.ts
git commit -m "feat: add sentence shared answer pool utility"
```

## Task 2: Implement the reversible builder UI

**Files:**
- Modify: `src/components/blocks/SentenceCompletionBlock.tsx`
- Create: `src/components/blocks/__tests__/SentenceCompletionBlock.sharedAnswerKeys.test.tsx`

- [ ] **Step 1: Write failing builder interaction tests.**

Use the existing `Harness` pattern from `src/components/blocks/__tests__/AcceptedAnswersBlocks.test.tsx` and add five concrete tests: render a two-blank sentence and assert the accessible checkbox is unchecked with both `Blank 1:` and `Blank 2:` visible; toggle on and assert the shared chips contain the ordered union while a deep copy of `latestBlock.questions[0].blanks` is unchanged; toggle on, add `gamma`, toggle off, and toggle on again to assert the per-blank editors return and `gamma` remains in the shared pool; add `gamma` through the shared editor and assert only `sharedAcceptedAnswers` changes; and render two blanks with `sharedAcceptedAnswers: ['alpha', 'ALPHA']` to assert the exact non-blocking warning text is visible.

- [ ] **Step 2: Run the focused component test and verify it fails.**

Run:

```bash
npx vitest run src/components/blocks/__tests__/SentenceCompletionBlock.sharedAnswerKeys.test.tsx
```

Expected: FAIL because the toggle and shared editor are not rendered.

- [ ] **Step 3: Add the toggle and reversible state transitions.**

In `SentenceCompletionBlock.tsx`:

1. Add a sentence-level toggle in the existing sentence header beside the scoring and answer-rule selects.
2. Give it an accessible label containing `Accept any answer key in this sentence` and bind `checked` to `question.acceptAnyAnswerKey === true`.
3. On enable, set `acceptAnyAnswerKey: true` and set `sharedAcceptedAnswers` to the existing array when present; otherwise seed it from `getSharedSentenceAnswerPool(question)`.
4. On disable, set only `acceptAnyAnswerKey: false`; do not delete `sharedAcceptedAnswers` or mutate blanks.
5. When enabled, render one `AcceptedAnswersEditor` with `getSharedSentenceAnswerPool(question)`. Its `onChange` must update only `sharedAcceptedAnswers` and keep `correctAnswer` absent at the question level.
6. When disabled, render the current per-blank editor path unchanged.
7. Reuse `maxVariantWordCountFromAcceptedAnswers` so adding a longer shared variant still upgrades `answerRule` and never downgrades it.

- [ ] **Step 4: Add the inline warning and verify the component tests.**

Compute `uniqueKeyCount = countUniqueSharedSentenceKeys(question)` only in shared mode. When `uniqueKeyCount < question.blanks.length`, render an amber, non-blocking message:

```text
This sentence has fewer unique answer keys than blanks. Students may not be able to receive full credit.
```

Run:

```bash
npx vitest run src/components/blocks/__tests__/SentenceCompletionBlock.sharedAnswerKeys.test.tsx src/components/blocks/__tests__/AcceptedAnswersBlocks.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the builder UI.**

```bash
git add src/components/blocks/SentenceCompletionBlock.tsx src/components/blocks/__tests__/SentenceCompletionBlock.sharedAnswerKeys.test.tsx
git commit -m "feat: add sentence shared answer key toggle"
```

## Task 3: Align frontend validation and publish-readiness warnings

**Files:**
- Modify: `src/utils/examUtils.ts`
- Modify: `src/utils/__tests__/validationUtils.test.ts`

- [ ] **Step 1: Add failing validation tests.**

Add tests proving shared mode accepts a non-empty sentence pool even when
preserved blank answers are empty, emits a `type === 'warning'` rather than an
error when two blanks have one unique shared key, and keeps the legacy
per-blank missing-answer error when the toggle is off. Put the typed warning
assertions in `src/utils/__tests__/examUtils.questionCounting.test.ts` and the
legacy validator assertions in `src/utils/__tests__/validationUtils.test.ts`.

- [ ] **Step 2: Run the focused validation tests and verify they fail.**

Run:

```bash
npx vitest run src/utils/__tests__/validationUtils.test.ts
```

Expected: FAIL because shared-mode validation is not recognized.

- [ ] **Step 3: Implement shared-mode validation.**

Update both `validateSentenceCompletion` in `src/utils/validationUtils.ts` and
`validateSentenceCompletionBlock` in `src/utils/examUtils.ts` so that:

1. Sentence text, placeholder alignment, and blank count validation remain errors exactly as before.
2. With shared mode off, validate every blank through `resolveAcceptedAnswers(blank)` exactly as before.
3. With shared mode on, validate the effective shared pool instead of requiring every preserved blank to contain its own answer. The legacy validator suppresses false per-blank errors, while the typed `examUtils` validator and builder warning surface an empty or undersized pool as a warning, not an error, per the approved product decision.
4. Use `countUniqueSharedSentenceKeys` so case/punctuation-equivalent values do not inflate the warning count.

- [ ] **Step 4: Run validation and type checks.**

Run:

```bash
npx vitest run src/utils/__tests__/validationUtils.test.ts src/utils/__tests__/examUtils.questionCounting.test.ts src/utils/__tests__/sentenceCompletionAnswerPool.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit frontend validation.**

```bash
git add src/utils/validationUtils.ts src/utils/examUtils.ts src/utils/__tests__/validationUtils.test.ts src/utils/__tests__/examUtils.questionCounting.test.ts
git commit -m "feat: warn on undersized sentence answer pools"
```

## Task 4: Make frontend grading/review consume the shared pool once per sentence

**Files:**
- Modify: `src/components/admin/gradingAnswerUtils.ts`
- Modify: `src/components/admin/gradingReviewUtils.ts`
- Modify: `src/components/admin/__tests__/gradingAnswerUtils.test.ts`
- Create: `src/components/admin/__tests__/gradingReviewUtils.sharedAnswerKeys.test.ts`

- [ ] **Step 1: Add failing grading tests.**

Cover these cases in `gradingAnswerUtils.test.ts`: a permutation such as
`['beta', 'alpha']` is correct for shared pool `['alpha', 'beta']`; repeated
`['alpha', 'alpha']` produces one true and one false result; and a key valid for
blank 2 remains invalid for blank 1 when shared mode is disabled. In
`gradingReviewUtils.sharedAnswerKeys.test.ts`, build a minimal `ExamState` and
`SectionSubmission`, call `buildQuestionTracebackGroups`, and assert the
traceback items show one correct and one incorrect slot for a repeated shared
answer while retaining the existing slot IDs and student-answer strings.

- [ ] **Step 2: Run the focused grading tests and verify they fail.**

Run:

```bash
npx vitest run src/components/admin/__tests__/gradingAnswerUtils.test.ts src/components/admin/__tests__/gradingReviewUtils.sharedAnswerKeys.test.ts
```

Expected: FAIL because current grading checks each descriptor independently.

- [ ] **Step 3: Add a batch correctness resolver for shared sentence questions.**

In `gradingAnswerUtils.ts`, add an exported helper with this contract:

```ts
export function resolveSentenceCompletionCorrectness(
  descriptors: readonly StudentQuestionDescriptor[],
  answerMap: Record<string, StudentAnswerValue | undefined>,
): Map<string, boolean | null>;
```

The helper must:

1. Return normal per-descriptor results for non-sentence descriptors and legacy sentence questions.
2. Group shared-mode descriptors by `question.id`.
3. Read the array-backed answer values through `getQuestionAnswer`.
4. Use `getSharedSentenceAnswerPool` and `matchSharedSentenceAnswers` once per sentence, preserving descriptor/blank order.
5. Keep `null` for malformed or ungradable descriptors, and keep the current behavior for empty answers.

Update `isStudentAnswerCorrect` only as a single-descriptor fallback; do not make it pretend it can enforce sentence-wide uniqueness without sibling descriptors.

Update `getAcceptedAnswersForDescriptor` so shared sentence traceback rows
display the effective shared pool rather than the hidden per-blank key list.
Leave `getCorrectAnswerValue` and the existing legacy display behavior intact.

- [ ] **Step 4: Thread batch results through traceback construction.**

In `buildQuestionTracebackGroups`, compute the shared correctness map once from all descriptors and the answer map. Pass the map into `buildTracebackItem` and `buildGroupedTracebackItem`. For a shared sentence descriptor, prefer the batch map before falling back to `isStudentAnswerCorrect`. Keep backend `questionResults` authoritative when a persisted result exists.

- [ ] **Step 5: Run the frontend grading tests and verify they pass.**

Run:

```bash
npx vitest run src/components/admin/__tests__/gradingAnswerUtils.test.ts src/components/admin/__tests__/gradingReviewUtils.sharedAnswerKeys.test.ts src/components/admin/__tests__/gradingReviewUtils.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit frontend grading.**

```bash
git add src/components/admin/gradingAnswerUtils.ts src/components/admin/gradingReviewUtils.ts src/components/admin/__tests__/gradingAnswerUtils.test.ts src/components/admin/__tests__/gradingReviewUtils.sharedAnswerKeys.test.ts
git commit -m "feat: grade shared sentence keys one-to-one in review"
```

## Task 5: Add server-side validation and publish warnings

**Files:**
- Modify: `backend/crates/application/src/validation.rs`
- Add tests in: `backend/crates/application/src/validation.rs` test module

- [ ] **Step 1: Add failing Rust validation tests.**

Add unit tests to `backend/crates/application/src/validation.rs` that call `validate_exam_content` with a sentence question containing:

1. `acceptAnyAnswerKey: true`, empty preserved blank answers, and a non-empty `sharedAcceptedAnswers` array; assert no blank-answer errors.
2. Two blanks and one case-insensitive unique shared key; assert `warnings` contains a sentence-question field and `errors` is empty.
3. A legacy sentence without the toggle and an empty blank answer; assert the existing blank-answer error remains.

- [ ] **Step 2: Run the focused Rust tests and verify they fail.**

Run:

```bash
cargo test -p ielts-backend-application validation::tests -- --nocapture
```

Expected: FAIL because server validation currently requires every blank’s `correctAnswer`.

- [ ] **Step 3: Implement authoritative Rust shared-pool validation.**

In `validate_sentence_completion`:

1. Read `acceptAnyAnswerKey` as a strict boolean.
2. In shared mode, resolve `sharedAcceptedAnswers` when the property exists, otherwise derive the ordered union from each blank’s `acceptedAnswers`/`correctAnswer` using the same variant splitting rules used by grading.
3. Do not add per-blank missing-answer errors in shared mode.
4. Add a warning when the normalized shared pool size is less than the blank count. Keep `ValidationResult::is_valid()` true for this condition.
5. Leave legacy validation untouched when the toggle is false or absent.

Use the existing `ValidationResult::add_warning` path so `BuilderService::validate_exam` exposes the warning without changing `can_publish` semantics.

- [ ] **Step 4: Run focused backend validation tests.**

Run:

```bash
cargo test -p ielts-backend-application validation::tests -- --nocapture
```

Expected: PASS.

- [ ] **Step 5: Commit server validation.**

```bash
git add backend/crates/application/src/validation.rs
git commit -m "feat: validate shared sentence answer pools"
```

## Task 6: Implement backend objective auto-grading with one-to-one consumption

**Files:**
- Modify: `backend/crates/application/src/grading/mod.rs`
- Modify: `backend/tests/contracts/grading_contract.rs`

- [ ] **Step 1: Add failing backend grading tests.**

Add unit tests in the `#[cfg(test)]` module of
`backend/crates/application/src/grading/mod.rs` using the existing
`compute_objective_auto_grading_results` fixtures. Assert that two blanks with
`sharedAcceptedAnswers: ["alpha", "beta"]` score 2/2 for submitted
`["beta", "alpha"]`, score 1/2 with exactly one true slot for submitted
`["alpha", "alpha"]`, and keep legacy per-blank behavior for submitted
`["beta", "beta"]` when the toggle is absent. Add one API-level assertion in
`backend/tests/contracts/grading_contract.rs` using the existing schedule and
submission flow so persisted `questionResults` expose the same score and slot
IDs. Cover both the alias answer shape (`question_id: [answer0, answer1]`) and
the materialized `question_id:blank_id` shape in the unit tests.

- [ ] **Step 2: Run the focused backend grading tests and verify they fail.**

Run:

```bash
cargo test -p ielts-backend-application grading::tests::shared_sentence -- --nocapture
```

Expected: FAIL because each blank currently receives an independent `TextAnyOf` spec.

- [ ] **Step 3: Extend objective scoring specs with shared-sentence metadata.**

Add this optional shared-group identifier to `ObjectiveAnswerSpec`:

```rust
shared_answer_group: Option<String>,
```

In `index_objective_block_scoring_specs` for `SENTENCE_COMPLETION`:

1. Keep the existing per-blank path when `acceptAnyAnswerKey` is absent or false.
2. In shared mode, resolve the explicit `sharedAcceptedAnswers` array when present; otherwise derive the pool from all blank keys.
3. Create one spec per blank so existing question IDs, score totals, result rows, aliases, and grouped scoring metadata remain stable.
4. Give every spec in that sentence the same stable group key, such as `sentence:{question_id}:shared`.
5. Preserve answer-rule data and existing objective override metadata on each spec.

- [ ] **Step 4: Consume shared normalized keys once during result computation.**

In `compute_objective_auto_grading_results`, keep a `HashMap<String, HashSet<String>>` of consumed normalized answers by shared group. For a shared spec:

1. Read the first strict text value from the student answer.
2. Normalize it with a shared-mode comparator that lowercases Unicode text and collapses whitespace, matching the TypeScript shared comparator.
3. Return false for empty, unknown, or already-consumed keys.
4. Insert a matched key into the group’s consumed set and return true.

Leave legacy `TextAnyOf` matching unchanged so existing strict-grading behavior is not silently altered. When an objective override replaces a shared slot’s allowed answers, use the overridden set for that slot while retaining the shared group’s one-use consumption rule.

- [ ] **Step 5: Run the backend grading tests and the existing grading suite.**

Run:

```bash
cargo test -p ielts-backend-application grading::tests::shared_sentence -- --nocapture
cargo test -p ielts-backend-application grading::tests -- --nocapture
```

Expected: PASS, including all pre-existing strict-match tests.

- [ ] **Step 6: Commit backend grading.**

```bash
git add backend/crates/application/src/grading/mod.rs backend/tests/contracts/grading_contract.rs
git commit -m "feat: auto-grade shared sentence keys once"
```

## Task 7: Verify content round-trip, delivery, and documentation memory

**Files:**
- Modify: `backend/tests/contracts/builder_contract.rs`
- Modify: `backend/tests/contracts/student_contract.rs`
- Modify: `src/utils/__tests__/cloneExamContent.test.ts`
- Modify: `src/components/blocks/README.md`

- [ ] **Step 1: Add round-trip and delivery contract tests.**

Extend the existing builder draft fixture with:

```json
{
  "acceptAnyAnswerKey": true,
  "sharedAcceptedAnswers": ["alpha", "beta"]
}
```

Save and reload the draft/version, then assert both fields survive unchanged. Add a student delivery assertion that the question still exposes an array constraint with the original blank count and that no new student answer key is introduced.
Add a TypeScript clone regression in
`src/utils/__tests__/cloneExamContent.test.ts` that clones a shared-mode
sentence and asserts both optional fields survive while the block, sentence,
and blank IDs are regenerated.

- [ ] **Step 2: Run the contract tests.**

Run:

```bash
cargo test -p ielts-backend-application --test builder_contract -- --nocapture
cargo test -p ielts-backend-application --test student_contract -- --nocapture
```

Expected: PASS.

- [ ] **Step 3: Add the memory artifact.**

Update `src/components/blocks/README.md` with these invariants:

- Shared mode is question-level and defaults off when absent.
- Per-blank answer keys are preserved when shared mode is toggled.
- Student submissions remain one answer per blank.
- Shared grading consumes a normalized answer key at most once per sentence.
- An undersized shared pool is a warning, not a publish blocker.

- [ ] **Step 4: Commit contracts and documentation.**

```bash
git add backend/tests/contracts/builder_contract.rs backend/tests/contracts/student_contract.rs src/components/blocks/README.md
git commit -m "docs: record shared sentence answer invariants"
```

## Task 8: Run the complete verification set

- [ ] **Step 1: Run focused frontend tests.**

```bash
npx vitest run \
  src/utils/__tests__/sentenceCompletionAnswerPool.test.ts \
  src/utils/__tests__/validationUtils.test.ts \
  src/components/blocks/__tests__/SentenceCompletionBlock.sharedAnswerKeys.test.tsx \
  src/components/blocks/__tests__/AcceptedAnswersBlocks.test.tsx \
  src/components/admin/__tests__/gradingAnswerUtils.test.ts \
  src/components/admin/__tests__/gradingReviewUtils.sharedAnswerKeys.test.ts \
  src/utils/__tests__/cloneExamContent.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run frontend static checks.**

```bash
npm run typecheck
npm run lint
```

Expected: PASS with no new warnings.

- [ ] **Step 3: Run the complete backend application and contract suites.**

```bash
cargo test -p ielts-backend-application
```

Expected: PASS.

- [ ] **Step 4: Run the relevant end-to-end builder cycle.**

```bash
npx playwright test e2e/exam-builder-full-cycle.spec.ts
```

Expected: PASS, including draft save/reload and publish-readiness behavior.

- [ ] **Step 5: Inspect the final diff and verify repository memory.**

```bash
git diff --check
git status --short
```

Confirm the diff contains no changes to submitted-answer schemas, autosave mutation paths, timers, or immutable published-attempt data. Confirm the design spec, implementation plan, regression tests, and `src/components/blocks/README.md` all describe the same default-off and one-to-one rules.
