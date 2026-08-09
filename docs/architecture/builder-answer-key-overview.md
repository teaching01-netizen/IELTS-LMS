# Builder Answer Key Overview

## Purpose

Provide a dedicated Builder surface for reviewing and editing **Reading + Listening** answer keys at:

- `/builder/:examId/answer-key`

This page is intended to make it fast to validate answer-key completeness and consistency across an exam without clicking into each block individually.

## Invariants

1. **Never change answer key identifiers.**
   - Do not modify question ids, block ids, slot ids, or any `answerKey` mapping fields.
2. Only edit **correct-answer fields** in the draft exam content:
   - `correctAnswer`
   - `acceptedAnswers` (and its derived `correctAnswer` primary)
   - MCQ option correctness (`option.isCorrect`)
3. Keep edits inside the Builder draft content.
   - Published versions and student-delivery snapshots remain immutable.
   - Submitted answers remain immutable.
   - After a draft save, existing Reading + Listening objective-grading projections automatically recalculate from the latest draft; no manual grading refresh is required.
4. For `MULTI_MCQ`, marked options are authoritative.
   - At least one option must remain marked `isCorrect`.
   - The student selection limit and question-slot count derive from marked options.
   - `requiredSelections` is retained only as a synchronized compatibility projection for saved legacy content; it is not independently editable.

## Sub-answer Tree Notes

Sub-answer tree questions are represented as leaf ids in the form:

- `${blockId}::tree::${rootNodeId}::${nodeId}`

The overview updates `answerTree` leaf nodes by id (never by positional index) to keep edits stable across reorderings.

## Automatic grading update

The backend draft-save route owns the answer-key-to-grading transition. After saving an immutable draft version, it regrades every schedule for that exam from the latest draft and records the draft as the schedule's objective-grading source. Manual regrade remains available as a recovery action, but it is not part of the normal Builder workflow.

The admin objective overview resolves that active schedule source instead of always reading the published delivery snapshot. The Builder save flow emits a same-tab and cross-tab notification after the backend operation completes, so open grading views reload their persisted submissions and key without a page refresh.
