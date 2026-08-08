# Grading Export Invariants

Objective grading exports must use the same exam version that produced the stored grading result.

- Normally, that source is the session's immutable published version.
- After an administrator regrades from the latest draft, the persisted schedule objective-grading source takes precedence.
- When a stored question result has an explicit override, its recorded `correctAnswer` takes precedence for that exported row.
- CSV/Excel, per-student PDF, and the review workspace must resolve that source consistently.
- For typed answer keys, including each `TABLE_COMPLETION` cell, every accepted variant is displayed
  with ` | ` separators; `correctAnswer` is only the primary fallback when no variants are present.
- A stored score must never be combined with an answer key reconstructed from a different exam version.

This keeps the exported student answer, right answer, correctness, and score mutually consistent without mutating submitted answers.

Manual objective correctness overrides are submission-scoped, not schedule-scoped:

- A grader may mark an individual Reading/Listening answer `Correct` or `Incorrect` from the traceback row.
- The submitted answer and exam answer key remain immutable; only the persisted grading result changes.
- The override recalculates that section's total and percentage and is retained when objective grading is re-synchronised.
- Every manual decision is recorded as a `score_override` review event with actor, question, section, and reason.

The session-level `Overall answer check` is an exam/cohort exception list, not a replacement
for the individual review screen:

- It loads every submitted student's Reading/Listening objective rows for the selected grading session.
- It keeps only typed-answer question blocks, excluding choice blocks using the session's immutable exam version.
- It keeps only rows where the raw student answer differs from an accepted key by capitalization and/or whitespace, while the normalized values match.
- Punctuation changes, exact raw matches, genuinely incorrect answers, and choice answers are excluded.
- The `Result` filter narrows the visible exception rows to all, correct, or incorrect without reloading the session.
- A row-level decision uses the same submission-scoped override endpoint and remains drillable into that student's review.
