# UX Invariants

Purpose: keep student-facing interaction rules explicit so future UI changes do not accidentally weaken exam usability or integrity.

## Student Text Selection And Highlighting

### Owning Module
Student highlight and reading/question text selection behavior is owned by the student UI module:

- `src/components/student/highlightSelection.ts`
- `src/components/student/highlightV2Engine.ts`
- `src/components/student/highlightSelectionPort.tsx`
- `src/components/student/highlightPersistence.tsx`
- `src/components/student/highlightV2Persistence.tsx`
- Student reading/question renderers that set `data-student-highlightable="true"`

### Invariant
Text selection and highlighting are fail-closed.

Selection endpoints must remain inside the owning highlightable surface. The system must reject, not clip or expand, selections whose endpoints leave that surface.

Cross-block selections must be rejected instead of split or auto-expanded across paragraphs, list items, table cells, headings, or other block boundaries.

Answer controls must stay outside highlightable selection boundaries. Students may select displayed reading/question text, but inputs, textareas, selects, contenteditable regions, and answer-control elements must not become highlight targets.

Floating highlight toolbar actions must not clear, replace, or steal focus from the text selection they are acting on before apply/remove consumes the captured selection.

### Must Not Break
- Native drag selection must work for reading passage title/body and visible question display text in exam mode.
- Highlight apply/remove must act on the latest valid captured selection for the active highlight surface only.
- Highlighting must not create nested highlight marks when recoloring or reapplying over already-highlighted text.
- Persisted highlights must be tied to the rendered surface text and must reset when that text changes.

### Regression Protection
- `src/components/student/__tests__/highlightSelection.test.ts`
- `src/components/student/__tests__/highlightPersistence.test.tsx`
- `src/components/student/__tests__/highlightSelectionPort.test.tsx`
- `src/components/student/__tests__/highlightV2Engine.test.ts`
- `src/components/student/__tests__/StudentReadingReadabilityControls.test.tsx`
- `src/components/student/__tests__/StudentQuestionExperience.test.tsx`

### Related Memory
- `docs/failure-cases.md`
