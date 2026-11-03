I haven't changed any code. I only created an empty local branch (`fix/objective-grading-parity`) in my copy, and nothing was pushed. One thing to know before implementing: the backend needs Go 1.26.3, and that download is blocked in my workspace. The Go tests will need to run on your machine or in CI.

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
   - Ignore upper/lower case.
3. **Decision needed: should grading ignore upper/lower case?** I recommend yes. The server already does, so saved scores won't drop. Teachers' case-specific "exclude this answer" overrides should keep comparing case exactly.
4. **Go side:** replace `projectionNormalize`, `projectionAnswerMatches`, `projectionAnswerExcluded` and the older `objectiveAnswerEqual` with one function. NFKC needs `golang.org/x/text/unicode/norm`; check whether `go.mod` already includes it.
5. **TypeScript side:** make `normalizeAnswerForMatching` ignore case and strip invisible characters. Leave the separate de-duplication function for displayed keys as it is, so key lists don't change on screen.

## Phase 2: Read each question type's key from the same place

Put this mapping in a table on each side, with a test for every row:

| Type | Fix |
|---|---|
| Matching headings | Server must read `correctHeading`. Today it can't see that key at all. |
| Classification / matching features | Both sides prefer `correctCategory` / `correctMatch`, so an old `correctAnswer` can't win. |
| TFNG / map | Same order on both sides (`correctAnswer`, then `acceptedAnswers`). |
| Diagram labels / flow chart | The website must split `a \| b` into separate accepted answers like the server does. Today it compares the whole string. |
| Sentence completion with "accept any key" | Check the server supports the shared answer pool the website uses. |
| Grouped table cells / sub-answer trees | Check that both sides count the same "required correct" number and identify each slot the same way. |
| Multiple choice (choose 2–3) | **Decision needed:** partial credit (the website now, and real IELTS) or all-or-nothing (the server now). This changes the maximum score. |

Also add an exam-publish check: refuse to publish if any objective question has a key the server can't read.

## Phase 3: One source for the score in the website and PDF

- **Review page:** show the server's saved result. Still re-check it on the website, and if the two differ, show a warning ("Saved score is out of date — regrade") instead of silently showing a different answer.
- **PDF and CSV export:** take each row, the total, the band and grouped (2-for-1) questions from those same results, so the Yes rows always add up to the Total. Include teacher "Set result" changes.
- **`tableRows.ts` fallback:** when a score is missing, compare the student answer against each accepted answer separately, not against the whole joined string.

## Phase 4: Fix the saved scores

- Add a **preview mode** to regrade that lists what would change without saving.
- Deploy, preview, then regrade each schedule.
- **Decision needed: released results.** Regrading skips them on purpose. Either add an audited "regrade released" action, or produce a list for teachers to correct manually.
- Tell teachers beforehand that some scores will change, mostly upward.

## Phase 5: Tests that cover every case

1. **Shared answer-cleaning tests:** both test suites read the same file, including dots, commas, quotes, invisible characters, full-width letters, Thai text, accented letters, dashes, line breaks, empty answers and mixed case.
2. **Full-coverage exam:** one test exam containing every question type in every form (blanks, grouped slots, sub-answer trees, overrides, exclusions). The Go grader and the website grader each produce per-question results, and those must match one saved expected file.
3. **Regression tests for the three real cases:**
   - Ravisara: an invisible character after "waiter".
   - An out-of-date saved score showing in the export.
   - A matching-headings key the server can't see.
4. **Go fuzz test:** cleaning an already-cleaned answer changes nothing, and matching gives the same result whether an answer has extra spaces or different case.
5. **Export test:** in every generated PDF, the number of Yes rows equals the Correct count.

## Phase 6: Prevent it coming back

- When a review page loads, log any disagreement between the saved score and the website's re-check with a new issue code (for example `client_server_mismatch`).
- Add a CI rule: any change to grading code must pass the shared tests on both Go and TypeScript.

**Suggested order:** Phase 0 → 1 → 2 → 5 (tests alongside) → 3 → deploy → 4 → 6.

**Three decisions only you can make:**
- Should grading ignore upper/lower case?
- Partial credit or all-or-nothing for multiple choice?
- How should released results be handled?

If you want to share this with your team, I can turn it into a document.