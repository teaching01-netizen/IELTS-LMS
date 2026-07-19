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
3. Keep edits inside the Builder draft content. Published versions and student submissions are unaffected.
4. For `MULTI_MCQ`, marked options are authoritative.
   - At least one option must remain marked `isCorrect`.
   - The student selection limit and question-slot count derive from marked options.
   - `requiredSelections` is retained only as a synchronized compatibility projection for saved legacy content; it is not independently editable.

## Sub-answer Tree Notes

Sub-answer tree questions are represented as leaf ids in the form:

- `${blockId}::tree::${rootNodeId}::${nodeId}`

The overview updates `answerTree` leaf nodes by id (never by positional index) to keep edits stable across reorderings.
