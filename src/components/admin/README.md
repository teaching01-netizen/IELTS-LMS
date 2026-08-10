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
- It groups rows by the exact raw student answer across the selected exam session, so casing and whitespace variants such as `Garden Hall`, `garden hall`, and `Garden hall` remain separate groups while every matching student/question occurrence is retained.
- It keeps only rows where the raw student answer differs from an accepted key by capitalization and/or whitespace, while the normalized values match.
- Punctuation changes, exact raw matches, genuinely incorrect answers, and choice answers are excluded.
- The default `Incorrect` filter shows answer groups currently scored incorrect; `All` and `Correct` switch the view at group level without reloading the session.
- Group summaries show the exact student answer text, current key, affected student/question counts, and correctness status. Student/question evidence is collapsed by default and remains available through the accessible details disclosure; the evidence table repeats the raw answer and uses human question labels such as `q-17`.
- When no exact-casing accepted variant exists, only the case-different characters in the raw student answer are highlighted in yellow against the closest accepted answer; the student answer uses the system sans font, the card explains the capitalization/spacing mismatch in plain language, and additional accepted variants stay behind an accessible disclosure.
- Exam-wide decisions require confirmation showing the exact student/question impact, then report the persisted key update and regrade outcome in an inline live status message.
- A group-level decision applies to the whole selected exam session through the schedule-scoped objective override endpoint; there are no per-row result buttons.
- `Accept this answer and add to key` adds the selected exact answer text to the question's accepted answer key and regrades every submission in the session.
- `Incorrect for whole exam` records the grouped answer as excluded for the affected question and regrades every submission in the session.
- Student names remain drillable into the individual review screen, but the answer decision is never limited to that one student.
