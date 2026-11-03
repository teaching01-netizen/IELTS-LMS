# 06: Key-source tables agree on every row

**What to build:** The server and website key-source tables describe the same question types with the same field precedence. Sub-answer-tree and single-choice rows are explicit on both sides instead of being handled by an untracked fallback. A shared manifest test fails when either side adds, removes or reorders a row, so a new question type cannot ship with one side guessing.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] Both tables list the same row set, including sub-answer-tree and single-choice.
- [ ] Field precedence matches for every row, including matching headings, classification, matching features and the TFNG/map order.
- [ ] A shared manifest test fails if either side's row set or precedence diverges.
- [ ] An unknown question type has an explicit tested behaviour rather than a silent fallback.

## Implementation note

Both tables now include sub-answer-tree and single-choice rows and the shared default. `testdata/objective-grading-parity/key-source-table.json` is asserted by Go and TypeScript tests.
