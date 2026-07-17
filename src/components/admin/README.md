# Grading Export Invariants

Objective grading exports must use the same exam version that produced the stored grading result.

- Normally, that source is the session's immutable published version.
- After an administrator regrades from the latest draft, the persisted schedule objective-grading source takes precedence.
- When a stored question result has an explicit override, its recorded `correctAnswer` takes precedence for that exported row.
- CSV/Excel, per-student PDF, and the review workspace must resolve that source consistently.
- A stored score must never be combined with an answer key reconstructed from a different exam version.

This keeps the exported student answer, right answer, correctness, and score mutually consistent without mutating submitted answers.
