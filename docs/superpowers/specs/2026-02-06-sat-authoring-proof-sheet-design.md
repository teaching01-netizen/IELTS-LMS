# SAT Authoring Workspace — Proof Sheet Completion Design

## Scope

Implement only P2a–P2d from the handoff:

- P2a: editor-as-artifact / proof-sheet renderer parity
- P2b: autosave commit-and-advance hardening and default metadata carry-over
- P2c: authoring typography hierarchy
- P2d: authoring translucency/color lint

Optional momentum extras (A–D rail, carry-over diff, queue-depth dot, undo-last-commit, rhythm readout) are out of scope.

## Architecture

Create a shared, strictly read-only SAT question-body renderer containing the delivery-visible stimulus, prompt, and answer presentation. It must not own candidate response state, selection state, review state, elimination state, or editing state.

`SatQuestionRenderer` will continue to own student-session composition and controls, but will compose the shared body. Authoring will add `QuestionPaper`, which adapts `QuestionRevision` to the shared body and presents it inside the proof-sheet paper material. This keeps one rendering tree for exam-visible content while keeping delivery and authoring interaction concerns separate.

The first authoring proof-sheet slice will render the complete read-only paper and retain the current Tiptap/FastQuestionComposer editors as position-swapped sibling blocks. The editor must never mount `contentEditable` inside the read-only renderer DOM. The stem/prompt is the first block to receive the hot editing treatment; the remaining fields continue through the existing editor controls until parity is proven.

## P2a behavior

- `QuestionPaper` accepts a `QuestionRevision` and renders the same SAT-visible content path used by student delivery.
- Paper width follows the exam reading measure, not the full editor canvas.
- Supporting material, prompt, multiple-choice options, and SPR presentation remain read-only in the paper.
- Authoring controls and keyboard focus remain outside the paper renderer and preserve artifact order: stem → choices → rationale.
- Existing quick preview remains functional and is not replaced until the shared body is proven.
- Add a focused parity test for the same question projection used by preview/student delivery. Where browser screenshot infrastructure supports it, capture the paper and preview at the same viewport and compare stable rendered landmarks; avoid asserting transient animation pixels.

## P2b behavior

- Extend `useQuestionAutosave` with `commitAndAdvance(revision)`, which awaits the same durable latest flush used by `flushNow` and returns `{ ok, isLatest }`.
- `AuthoringWorkspace` uses this method in Save & Next / Cmd/Ctrl+Enter before selecting the next question or creating a new one.
- Failed or stale commits stop navigation and preserve the current draft.
- Metadata carry-over defaults to enabled for new work.
- The existing opt-out remains available through a compact “Carry metadata” control; metadata is copied into the newly created question before it becomes the active draft.
- Existing durable-draft recovery and stale-revision behavior remain unchanged.

## P2c behavior

Use four deliberate authoring roles:

- paper body: 17px
- list row/title content: 15px
- chrome/base controls: 13px
- sheet headings: 22px

10–11px remains only for genuinely secondary captions, status labels, keycaps, and compact metadata. Replace ad-hoc micro-type in the authoring feature deliberately, without changing status semantics or primary action styling.

## P2d behavior

Add a local ESLint rule/configuration for `src/features/exam-authoring` that rejects authoring TS/TSX usage of:

- raw `rgba(...)`/translucent color literals
- bare hex fill/color literals where semantic tokens should be used
- `backdrop-blur`/`backdrop-filter` outside approved HUD/material classes

`src/index.css` remains the authoritative token/material layer and is exempt. The rule must allow semantic status classes and static action tokens, but must prevent new raw color/translucency slop in authoring components. Existing violations will be migrated only where required for the lint gate; unrelated files are not swept.

## Error and accessibility contract

- Save failure keeps the current question selected and exposes the existing actionable error surface.
- A stale/latest mismatch must not advance the editor.
- Read-only paper content is not focusable as an editor; the hot editor owns editing semantics.
- Existing visible focus, keyboard navigation, reduced motion, and reduced transparency behavior remain intact.
- Paper and editor remain usable at the existing minimum workspace width and narrow viewport overflow behavior.

## Verification

Before implementation, establish a baseline for the affected authoring tests and static checks. During implementation use red-green cycles for new autosave, adapter, and parity contracts. Re-parse modified TS/TSX with AST tooling, rerun symbol/import checks, then run:

- `npm run typecheck`
- `npm run build`
- `npx vitest run src/features/exam-authoring`
- focused ESLint checks plus the new lint rule test
- relevant student-delivery preview/renderer tests

The final diff must contain only P2a–P2d files and intentional tests/config/docs; unrelated pre-existing SAT/backend/student-delivery work remains untouched.
