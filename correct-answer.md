I wrote this plan before implementing; the working tree now contains the implementation. It was written on a copy without Go 1.26.3 available, so the Go tests were expected to run in the owner's environment or CI.

## Goal

For every question, the server, the review page and the PDF must give the same answer. Three rules get there:
- **One answer-cleaning rule.** Typed answers are tidied up (case, spaces, punctuation, invisible characters) in exactly the same way on the server and the website.
- **One mapping of where each question type stores its key**, used by both sides.
- **One source for the score.** The server's saved result is the official score. The website and PDF display it and only re-check it to warn when they disagree.

## Phase 0: Measure the damage first (read-only)

Write a script that replays every unreleased **and** released IELTS submission. Grade it once the current server way and once the website way, then list every question where they differ (submission, question, saved score, website score). This tells you how many students are affected, including released ones, and it becomes the before/after check for the fix.

## Phase 1: One answer-cleaning rule

1. **Write the rule down once**, as a shared test file (for example `testdata/objective-grading-parity.json`) that the Go and TypeScript tests both read. It contains pairs of student answer, key and expected result.
2. **Steps, in order:**
   - Normalize Unicode (NFKC), so full-width letters become normal ones.
   - Remove invisible characters: U+200B–U+200D, U+2060, U+FEFF, U+00AD.
   - Turn curly quotes and the various dash characters into plain ones.
   - Strip the punctuation set the website already removes.
   - Collapse runs of spaces and trim the ends.
   - Require exact case by default (decided: `urwin` ≠ `Urwin`). Opt-out only with explicit `caseSensitive: false`.
   - `|` separates accepted variants on both stacks; a literal pipe cannot be represented in keys or answers.
3. **Decided: grading requires exact case.** Saved scores will drop on regrade for case-only variants (baseline 10→8, full-coverage 27→25). Use regrade preview. Teachers' "exclude this answer" overrides keep comparing case exactly. The submit-time `GradeObjective` path honours the same opt-out from the sealed `answer_definition`, so listening/reading/science grading cannot silently stay case-insensitive.
   - Additional corrections applied on both stacks for parity: whitespace-only answers count as unanswered; an array answer to a single-value question fails closed instead of matching its first element; `SINGLE_MCQ` compares option IDs as raw identity (no cleaning or folding).
4. **Go side:** replace `projectionNormalize`, `projectionAnswerMatches` and the older `objectiveAnswerEqual` with one strict matcher (`answersMatch` → `answersMatchCaseExact`), one folded matcher used only by the explicit opt-out, and `projectionAnswerMatchesFull` for slots. NFKC uses `golang.org/x/text/unicode/norm`.
5. **TypeScript side:** `answersMatch` requires exact case (steps 1–5, no case fold); `normalizeAnswerForMatching` remains only for the explicit `caseSensitive: false` opt-out path. Leave the separate de-duplication function for displayed keys as it is, so key lists don't change on screen.
6. **Shared answer pool:** the "accept any key" pool is consumed one key per blank, in blank order. Consuming one case-distinct key must not consume its case-variant sibling, and both stacks must dedupe the pool under the same strictness rule (strict by default; fold only when the question or every blank opts out).

## Phase 2: Read each question type's key from the same place

Put this mapping in a table on each side, with a test for every row:

| Type | Fix |
|---|---|
| Matching headings | Server reads `correctHeading`, after `acceptedAnswers` and before any legacy `correctAnswer`; removing that fallback is a regression, not a fix. |
| Classification / matching features | Effective keys are the specific field (`correctCategory` / `correctMatch`) plus `acceptedAnswers`; a stale legacy `correctAnswer` never wins, and writing alternatives never drops the selected category. |
| TFNG / map | Same order on both sides (`correctAnswer`, then `acceptedAnswers`). A TFNG key stored only in `acceptedAnswers` must still publish and grade. |
| Diagram labels / flow chart | The website must split `a \| b` into separate accepted answers like the server does. Effective keys are additive: the `correctAnswer` variants come first, then `acceptedAnswers`, so an alternatives list can never shadow the primary answer. |
| Sentence completion with "accept any key" | Check the server supports the shared answer pool the website uses. |
| Note completion | Same grouped-slot and shared-pool rules as sentence completion; the website must collapse grouped note blanks exactly like the server (already server-side, so the website wiring is required parity, not scope creep). |
| Grouped table cells / sentence + note blanks / sub-answer trees | Check that both sides count the same "required correct" number and identify each slot the same way. |
| Multiple choice (choose 2–3) | **Decision needed:** partial credit (the website now, and real IELTS) or all-or-nothing (the server now). This changes the maximum score. Option IDs are identity: compared raw, never cleaned. |

Also add an exam-publish check: refuse to publish if any objective question has a key the server can't read.

## Phase 3: One source for the score in the website and PDF

- **Review page:** show the server's saved result. Still re-check it on the website, and if the two differ, show a warning ("Saved score is out of date — regrade") instead of silently showing a different answer.
  - **Owner follow-up (2026-11-04):** the saved result stays the official score, but the **displayed verdict must follow the current exact-case rule**. When the saved result disagrees with the re-check and the question has no per-student/schedule override, the review page, grading exports and per-student PDF/CSV show the re-checked verdict and score, with totals and band derived from them; the regrade warning stays until the session is regraded.
- **PDF and CSV export:** take each row, the total, the band and grouped (2-for-1) questions from those same results, so the Yes rows always add up to the Total. Include teacher "Set result" changes.
- **`tableRows.ts` fallback:** when a score is missing, compare the student answer against each accepted answer separately, not against the whole joined string. Merged group rows use a display separator that cannot be mistaken for the `|` accepted-variant separator.

## Phase 4: Fix the saved scores

- Add a **preview mode** to regrade that lists what would change without saving.
- Deploy, preview, then regrade each schedule.
- **Decision needed: released results.** Regrading skips them on purpose. Either add an audited "regrade released" action, or produce a list for teachers to correct manually.
- Tell teachers beforehand that some scores will change (mostly upward from partial credit and answer cleaning, some downward from the exact-case decision).

## Phase 5: Tests that cover every case

1. **Shared answer-cleaning tests:** both test suites read the same file, including dots, commas, quotes, invisible characters, full-width letters, Thai text, accented letters, dashes, line breaks, empty answers and mixed case. `student-input-vectors.json` extends the same contract to every input class (case/whitespace/punctuation/invisible/full-width/accent/empty/dates/numbers/phrases) under strict + opt-out.
2. **Full-coverage exam:** one test exam containing every question type in every form (blanks, grouped slots, sub-answer trees, overrides, exclusions). The Go grader and the website grader each produce per-question results, and those must match one saved expected file.
3. **Regression tests for the three real cases:**
   - Ravisara: an invisible character after "waiter".
   - An out-of-date saved score showing in the export.
   - A matching-headings key the server can't see.
4. **Go fuzz test:** cleaning an already-cleaned answer changes nothing, and matching gives the same result whether an answer has extra spaces. Different letter case matches only when the slot explicitly opted out (`caseSensitive: false`).
5. **Export test:** in every generated PDF, the number of Yes rows equals the Correct count.
6. **Vertical-slice logic tests:** `e2e/ielts-case-sensitive-note.spec.ts`, `e2e/ielts-question-type-matrices.spec.ts` and `e2e/ielts-student-to-pdf-flow.spec.ts` exercise the real website functions end to end (student → scorer → traceback → overview → export → PDF) without a server; they run with `bun run e2e:ielts-case` and share their fixture scaffolding through `e2e/helpers`.

## Phase 6: Prevent it coming back

- When a review page loads, log any disagreement between the saved score and the website's re-check with a new issue code (for example `client_server_mismatch`).
- Add a CI rule: any change to grading code must pass the shared tests on both Go and TypeScript.

**Suggested order:** Phase 0 → 1 → 2 → 5 (tests alongside) → 3 → deploy → 4 → 6.

**Three decisions only you can make:**
- ~~Should grading ignore upper/lower case?~~ Decided: exact case by default, opt-out via `caseSensitive: false`.
- Partial credit or all-or-nothing for multiple choice?
- How should released results be handled?

If you want to share this with your team, I can turn it into a document.