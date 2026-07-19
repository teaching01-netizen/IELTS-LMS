# Multi-Select MCQ Derived Correct Count Design

## Goal

Remove the Builder's manual **Required Correct** control for `MULTI_MCQ` blocks. The number of options marked `isCorrect` becomes the authoritative selection count, with at least one correct option required.

## Ownership and invariants

- Builder question editing owns changes to option text and `isCorrect` in `src/components/blocks/MultiSelectMCQBlock.tsx`.
- Builder answer-key editing also changes `isCorrect` through `src/features/builder/utils/answerKeyOverview.ts`.
- Student delivery collects an array of selected option IDs under the block answer key. Submitted IDs must remain unchanged and must not be replaced by labels or derived values.
- Grading resolves the correct IDs from `option.isCorrect` and compares exact sets, independent of ordering.
- Grading PDF export consumes the same grading review row model and must show the real submitted option text and marked-correct option text.
- `requiredSelections` remains in persisted data for backward compatibility, but is a projection of the marked-correct count rather than an independently editable rule.

## Design

Introduce a focused Multi-Select MCQ utility that exposes the correct option IDs/count, the effective selection limit, and a safe correctness toggle. The utility guarantees a minimum effective count of one for malformed legacy data and refuses to clear the final marked-correct option.

Builder edit paths synchronize the compatibility field `requiredSelections` whenever correctness changes. The visible question editor removes the manual dropdown and reports the derived marked-correct count. Existing drafts with a mismatched compatibility field are normalized by the next correctness edit, while runtime consumers use the derived count immediately.

Student rendering uses the derived count to cap selections while continuing to persist the selected option-ID array. Numbering and export slot counts use the same derived count so a stale legacy `requiredSelections` value cannot override the answer key.

Grading continues exact set comparison using marked option IDs. Empty correct sets are treated as invalid configuration, not as an automatically correct unanswered question.

## Error handling and compatibility

- Authors may mark from one through all available options as correct.
- Attempting to clear the final correct option leaves it marked.
- A legacy block with no correct options remains publish-invalid and receives a safe runtime limit of one; the change does not invent a correct answer.
- No identifiers, submitted answers, published versions, or grading records are mutated by derivation or export.

## TDD verification

1. Domain tests prove derived counts, compatibility synchronization, and final-correct protection.
2. Builder component tests prove the dropdown is absent and correctness edits behave as specified.
3. Student component tests prove the selection cap comes from marked options and the emitted answer remains the real option-ID array.
4. Grading tests prove exact-set comparison uses marked options even when `requiredSelections` is stale.
5. Grading export tests prove student and correct answer text comes from the real submitted/correct IDs.
6. Export/counting tests prove stale `requiredSelections` does not control slots.

## Out of scope

- Removing `requiredSelections` from the serialized schema.
- Changing `SINGLE_MCQ` behavior.
- Changing submitted-answer storage or grading override formats.
