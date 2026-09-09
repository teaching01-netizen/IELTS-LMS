# SAT highlight eraser (Eraser mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Bluebook-like Eraser mode to the SAT Reading & Writing annotation surface so students can remove highlights and underlines (including notes attached to them) by selecting the marked text while the eraser is armed.

**Architecture:** No new store, no policy flag, no persistence migration. Add two pure removal helpers in `satResponses.ts`, widen the existing annotation-mode union (`off/highlight/underline/note` → plus `erase`) through the interaction machine → context → shell → top bar, and branch `SatAnnotatedContent` so a captured selection deletes intersecting marks instead of creating one. Removal flows through the existing `onAnnotationsChange → setAnnotations → outbox` path.

**Tech Stack:** React 19, TypeScript (`tsc --noEmit`), vitest + @testing-library/react + jsdom, eslint, lucide-react (no new icon — text button like Highlight/Underline).

---

## Decisions locked (from planning review)

1. **Interaction = dedicated Eraser mode button** in the top bar (exclusive toggle with Highlight/Underline/Notes, same as Bluebook). No click-highlight-to-delete, no per-span × buttons.
2. **Scope = highlights + underlines.** One eraser removes both kinds intersecting the selected range. Rationale: both are "marks"; separate erasers double the toolbar for zero benefit.
3. **Attached notes die with their decoration.** Erasing a mark that carries a `note` deletes the whole annotation. No orphan notes, no migration.
4. **No bulk "clear all marks" in this pass.** Deferred — the helpers built here make it a 30-minute follow-up.
5. **No new tool-policy flag.** Erase is a derived capability: allowed iff `highlight || underline || notes` (all three are R&W-only today, so erase is R&W-only automatically). Do NOT add `erase` to `SatExamToolPolicy`.
6. **No annotation-format change.** Removal only shrinks `annotations[]`. Stays v2, normalizer/outbox untouched.

## File map

**Modify (source, 6 files):**

- `src/features/student-delivery/domain/satResponses.ts` — add `removeSatAnnotationById` + `removeSatAnnotationsInRange`.
- `src/features/student-delivery/domain/satInteractionState.ts` — `SatAnnotationInteractionMode` += `'erase'`; `isAnnotationModeAllowed` gate; comment update.
- `src/features/student-delivery/domain/satInteractionIntents.ts` — `ANNOTATION_MODE_REQUESTED` mode union += `'erase'`.
- `src/features/student-delivery/hooks/useSatInteractionController.ts` — `toggleAnnotationMode` signature += `'erase'`.
- `src/features/student-delivery/ui/annotations/SatAnnotationModeContext.ts` — `SatAnnotationMode` += `'erase'`.
- `src/features/student-delivery/ui/shell/SatExamTopBar.tsx` — Eraser text button + prop type widen.
- `src/features/student-delivery/ui/SatExamShell.tsx` — map `erase` state → context value (3-line change).
- `src/features/student-delivery/ui/annotations/SatAnnotatedContent.tsx` — erase branch in `complete()` + root affordance attrs.
- `src/features/student-delivery/ui/question/SatQuestionRenderer.tsx` — stale `editingNoteId` cleanup effect (6 lines).

**Tests (append/extend, 5 files):**

- `src/features/student-delivery/domain/satAnnotationsV2.test.ts`
- `src/features/student-delivery/domain/__tests__/satInteractionReducer.test.ts` (self-contained ctx, no reliance on file-local helpers)
- `src/features/student-delivery/ui/annotations/SatAnnotatedContent.test.tsx`
- `src/features/student-delivery/ui/annotations/SatAnnotationFlow.test.tsx`
- `src/features/student-delivery/ui/SatExamShell.test.tsx`
- `src/features/student-delivery/application/__tests__/satAnnotationRoundTrip.test.ts` (erase round-trip assertion)

**Explicitly NOT touched:** `satToolPolicy.ts` (no new flag), `satInteractionGuards.ts` / `satInteractionSelectors.ts` / `satInteractionEscape.ts` (generic over mode — `DISABLE_ANNOTATION_MODE` already exits erase), `satTextSelection.ts` (capture reused as-is), `useSatResponsePersistence.ts` / outbox / durable payload (shape unchanged), `SatAnnotationNoteEditor.tsx` (unmounts automatically when its annotation disappears).

---

### Task 1: Pure removal helpers in the annotation domain

**Files:**

- Modify: `src/features/student-delivery/domain/satResponses.ts`
- Test: `src/features/student-delivery/domain/satAnnotationsV2.test.ts`

- [ ] **Step 1: Write the failing test**

Append this block at the end of `src/features/student-delivery/domain/satAnnotationsV2.test.ts` (add `removeSatAnnotationById` and `removeSatAnnotationsInRange` to the existing import from `./satResponses`):

```tsx
describe('sat annotation eraser helpers', () => {
  it('removes highlights and underlines intersecting the range, keeps the rest', () => {
    const base = emptySatAnnotationsV2();
    const keep = createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:p', startOffset: 0, endOffset: 4, exact: 'Several' });
    const hitHighlight = createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:p', startOffset: 10, endOffset: 17, exact: 'Several' });
    const hitUnderline = createSatTextAnnotation({ kind: 'underline', nodeId: 'stimulus:p', startOffset: 14, endOffset: 22, exact: 'chers ex' });
    const otherNode = createSatTextAnnotation({ kind: 'highlight', nodeId: 'prompt:q', startOffset: 10, endOffset: 17, exact: 'Several' });
    const seeded = { ...base, annotations: [keep, hitHighlight, hitUnderline, otherNode] };
    const next = removeSatAnnotationsInRange(seeded, 'stimulus:p', 12, 16);
    expect(next.annotations.map((a) => a.id).sort()).toEqual([keep.id, otherNode.id].sort());
    expect(seeded.annotations).toHaveLength(4);
  });

  it('treats range ends as exclusive and returns the same reference on no-op', () => {
    const base = emptySatAnnotationsV2();
    const mark = createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:p', startOffset: 2, endOffset: 6, exact: 'tree' });
    const seeded = { ...base, annotations: [mark] };
    expect(removeSatAnnotationsInRange(seeded, 'stimulus:p', 6, 9)).toBe(seeded);
    expect(removeSatAnnotationsInRange(seeded, 'other:p', 0, 9)).toBe(seeded);
  });

  it('removes a single annotation by id, including one that carries a note', () => {
    const base = emptySatAnnotationsV2();
    const noted = createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:p', startOffset: 0, endOffset: 7, exact: 'Several', note: 'Check the evidence' });
    const plain = createSatTextAnnotation({ kind: 'underline', nodeId: 'stimulus:p', startOffset: 8, endOffset: 12, exact: 'rese' });
    const seeded = { ...base, annotations: [noted, plain] };
    const next = removeSatAnnotationById(seeded, noted.id);
    expect(next.annotations.map((a) => a.id)).toEqual([plain.id]);
    expect(removeSatAnnotationById(seeded, 'missing-id')).toBe(seeded);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/student-delivery/domain/satAnnotationsV2.test.ts -t "eraser helpers"`

Expected: FAIL with `removeSatAnnotationsInRange is not defined` / `does not provide an export named 'removeSatAnnotationsInRange'`.

- [ ] **Step 3: Write minimal implementation**

Insert after the end of `createSatTextAnnotation` (after its closing `}`) and before `export interface SatTextSegment` in `src/features/student-delivery/domain/satResponses.ts`:

```ts
/** Remove one annotation by id. Returns the same reference when nothing matches. */
export function removeSatAnnotationById(
  annotations: SatQuestionAnnotations,
  annotationId: string,
): SatQuestionAnnotations {
  if (!annotations.annotations.some((annotation) => annotation.id === annotationId)) return annotations;
  return { ...annotations, annotations: annotations.annotations.filter((annotation) => annotation.id !== annotationId) };
}

/**
 * Remove every highlight/underline whose anchor overlaps `[startOffset, endOffset)`
 * in `nodeId`. Range ends are exclusive so touching-but-adjacent marks survive.
 * Attached notes die with their decoration. Returns the same reference on no-op
 * so callers can skip `onChange` churn.
 */
export function removeSatAnnotationsInRange(
  annotations: SatQuestionAnnotations,
  nodeId: string,
  startOffset: number,
  endOffset: number,
): SatQuestionAnnotations {
  const start = Math.max(0, Math.floor(startOffset));
  const end = Math.max(start + 1, Math.floor(endOffset));
  const next = annotations.annotations.filter(
    (annotation) => !(annotation.anchor.nodeId === nodeId && annotation.anchor.startOffset < end && start < annotation.anchor.endOffset),
  );
  if (next.length === annotations.annotations.length) return annotations;
  return { ...annotations, annotations: next };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/student-delivery/domain/satAnnotationsV2.test.ts`

Expected: PASS (all 11 existing + 3 new tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/student-delivery/domain/satResponses.ts src/features/student-delivery/domain/satAnnotationsV2.test.ts
git commit -m "feat(sat): add annotation eraser removal helpers"
```

---

### Task 2: Erase mode in the interaction state machine

**Files:**

- Modify: `src/features/student-delivery/domain/satInteractionState.ts`
- Modify: `src/features/student-delivery/domain/satInteractionIntents.ts`
- Modify: `src/features/student-delivery/hooks/useSatInteractionController.ts`
- Test: `src/features/student-delivery/domain/__tests__/satInteractionReducer.test.ts`

- [ ] **Step 1: Write the failing test**

Append at the end of `src/features/student-delivery/domain/__tests__/satInteractionReducer.test.ts`:

```tsx
describe('annotation eraser mode', () => {
  const baseCtx = (toolPolicy: Record<string, boolean>) => ({
    phase: 'module' as const,
    paused: false,
    terminated: false,
    isSubmitting: false,
    persistenceBlocked: false,
    toolPolicy: { ...emptySatExamToolPolicy(), ...toolPolicy },
    sectionKey: 'reading-writing' as const,
    moduleKey: 'm1',
    questionId: 'q1',
  });
  const rwCtx = () => baseCtx({ highlight: true, underline: true, notes: true });
  const mathCtx = () => ({ ...baseCtx({}), sectionKey: 'math' as const });

  it('arms erase in R&W, refuses it in Math, and toggles it exclusively', () => {
    expect(isAnnotationModeAllowed('erase', rwCtx().toolPolicy)).toBe(true);
    expect(isAnnotationModeAllowed('erase', mathCtx().toolPolicy)).toBe(false);
    let state = createSatInteractionState({ moduleKey: 'm1', questionId: 'q1' });
    state = satInteractionReducer(state, { type: 'ANNOTATION_MODE_CHANGED', mode: 'highlight' }, rwCtx());
    expect(state.annotation.mode).toBe('highlight');
    state = satInteractionReducer(state, { type: 'ANNOTATION_MODE_CHANGED', mode: 'erase' }, rwCtx());
    expect(state.annotation.mode).toBe('erase');
    const refused = satInteractionReducer(state, { type: 'ANNOTATION_MODE_CHANGED', mode: 'erase' }, mathCtx());
    expect(refused.annotation.mode).toBe('off');
  });

  it('resolves the erase intent, survives question change, and resets on module change', () => {
    const ctx = rwCtx();
    let state = createSatInteractionState({ moduleKey: 'm1', questionId: 'q1' });
    const event = resolveSatInteractionIntent(state, ctx, { type: 'ANNOTATION_MODE_REQUESTED', mode: 'erase' });
    expect(event).toEqual({ type: 'ANNOTATION_MODE_CHANGED', mode: 'erase' });
    state = satInteractionReducer(state, event!, ctx);
    state = satInteractionReducer(state, { type: 'QUESTION_CHANGED', moduleKey: 'm1', questionId: 'q2' }, { ...ctx, questionId: 'q2' });
    expect(state.annotation.mode).toBe('erase');
    state = satInteractionReducer(state, { type: 'MODULE_SCOPE_CHANGED', moduleKey: 'm2', questionId: 'q1' }, { ...ctx, moduleKey: 'm2' });
    expect(state.annotation.mode).toBe('off');
  });

  it('exits erase through the standard Escape arbitration', () => {
    const ctx = rwCtx();
    const armed = satInteractionReducer(createSatInteractionState(), { type: 'ANNOTATION_MODE_CHANGED', mode: 'erase' }, ctx);
    expect(resolveEscapeAction(armed, ctx)).toEqual({ type: 'DISABLE_ANNOTATION_MODE' });
  });
});
```

Add these imports at the top of that test file (merge with existing imports, do not duplicate): `isAnnotationModeAllowed, createSatInteractionState` from `../satInteractionState`, `resolveSatInteractionIntent` from `../satInteractionIntents`, `resolveEscapeAction` from `../satInteractionEscape`, `emptySatExamToolPolicy` from `../satToolPolicy`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/student-delivery/domain/__tests__/satInteractionReducer.test.ts -t "eraser mode"`

Expected: FAIL — `isAnnotationModeAllowed('erase', …)` returns false / `ANNOTATION_MODE_CHANGED` with `mode: 'erase'` is a type error or refused.

- [ ] **Step 3: Write minimal implementation**

(a) In `src/features/student-delivery/domain/satInteractionState.ts`, replace:

```ts
export type SatAnnotationInteractionMode = 'off' | 'highlight' | 'underline' | 'note';
```

with:

```ts
export type SatAnnotationInteractionMode = 'off' | 'highlight' | 'underline' | 'note' | 'erase';
```

and replace:

```ts
  if (mode === 'highlight') return toolPolicy.highlight;
  if (mode === 'underline') return toolPolicy.underline;
  return toolPolicy.notes;
```

with:

```ts
  if (mode === 'highlight') return toolPolicy.highlight;
  if (mode === 'underline') return toolPolicy.underline;
  if (mode === 'erase') return toolPolicy.highlight || toolPolicy.underline || toolPolicy.notes;
  return toolPolicy.notes;
```

and in the file header comment replace `persistent mode (off/highlight/underline/note)` with `persistent mode (off/highlight/underline/note/erase)`. No other logic changes — normalization, scope reset, `ANNOTATION_MODE_CHANGED`, and Escape arbitration are mode-generic.

(b) In `src/features/student-delivery/domain/satInteractionIntents.ts`, replace:

```ts
  | { type: 'ANNOTATION_MODE_REQUESTED'; mode: 'highlight' | 'underline' | 'note' | 'off' }
```

with:

```ts
  | { type: 'ANNOTATION_MODE_REQUESTED'; mode: 'highlight' | 'underline' | 'note' | 'erase' | 'off' }
```

(c) In `src/features/student-delivery/hooks/useSatInteractionController.ts`, replace both the interface line and the implementation signature:

```ts
  toggleAnnotationMode: (mode: 'highlight' | 'underline' | 'note') => void;
```

with:

```ts
  toggleAnnotationMode: (mode: 'highlight' | 'underline' | 'note' | 'erase') => void;
```

and:

```ts
  const toggleAnnotationMode = useCallback(
    (mode: 'highlight' | 'underline' | 'note') => {
```

with:

```ts
  const toggleAnnotationMode = useCallback(
    (mode: 'highlight' | 'underline' | 'note' | 'erase') => {
```

Body unchanged (exclusive toggle already generic).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/student-delivery/domain/__tests__/satInteractionReducer.test.ts src/features/student-delivery/domain/__tests__/satInteractionIntents.test.ts src/features/student-delivery/domain/__tests__/satInteractionEscape.test.ts src/features/student-delivery/domain/__tests__/satInteractionRaces.test.ts`

Expected: PASS all four files (no regressions in existing highlight/underline/note/escape coverage).

- [ ] **Step 5: Commit**

```bash
git add src/features/student-delivery/domain/satInteractionState.ts src/features/student-delivery/domain/satInteractionIntents.ts src/features/student-delivery/hooks/useSatInteractionController.ts src/features/student-delivery/domain/__tests__/satInteractionReducer.test.ts
git commit -m "feat(sat): add erase to annotation interaction mode machine"
```

---

### Task 3: Mode context type + shell mapping

**Files:**

- Modify: `src/features/student-delivery/ui/annotations/SatAnnotationModeContext.ts`
- Modify: `src/features/student-delivery/ui/SatExamShell.tsx`
- Test: `src/features/student-delivery/ui/SatExamShell.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to the `describe("SatExamShell")` block in `src/features/student-delivery/ui/SatExamShell.test.tsx`:

```tsx
  it("toggles Eraser exclusively with Highlight and exits on Escape", () => {
    const { rerender } = render(<SatExamShell {...props({ notesAvailable: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }));
    expect(screen.getByRole('button', { name: 'Eraser' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }));
    expect(screen.getByRole('button', { name: 'Eraser' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Eraser' })).toHaveAttribute('aria-pressed', 'false');
    rerender(<SatExamShell {...props({ notesAvailable: false })} />);
    expect(screen.queryByRole('button', { name: 'Eraser' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/student-delivery/ui/SatExamShell.test.tsx -t "Eraser"`

Expected: FAIL with `Unable to find an accessible element with the role "button" and name "Eraser"`.

- [ ] **Step 3: Write minimal implementation**

(a) In `src/features/student-delivery/ui/annotations/SatAnnotationModeContext.ts`, replace:

```ts
export type SatAnnotationMode = 'none' | 'highlight' | 'underline' | 'note';
```

with:

```ts
export type SatAnnotationMode = 'none' | 'highlight' | 'underline' | 'note' | 'erase';
```

(b) In `src/features/student-delivery/ui/SatExamShell.tsx`, replace:

```tsx
  const annotationMode: SatAnnotationMode =
    interaction.state.annotation.mode === 'highlight' ? 'highlight'
    : interaction.state.annotation.mode === 'underline' ? 'underline'
    : interaction.state.annotation.mode === 'note' ? 'note'
    : 'none';
```

with:

```tsx
  const annotationMode: SatAnnotationMode =
    interaction.state.annotation.mode === 'highlight' ? 'highlight'
    : interaction.state.annotation.mode === 'underline' ? 'underline'
    : interaction.state.annotation.mode === 'note' ? 'note'
    : interaction.state.annotation.mode === 'erase' ? 'erase'
    : 'none';
```

Nothing else in the shell changes: the existing `onToggleAnnotationMode={(mode) => { interaction.closeSurface(); interaction.toggleAnnotationMode(mode); }}` and the `SatAnnotationModeContext.Provider value={props.blocked || !notesAvailable ? 'none' : annotationMode}` pass `erase` through untouched.

- [ ] **Step 4: Run test to verify it passes** (Eraser button itself lands in Task 4 — this step is expected to still fail on the missing button; that is intentional)

Run: `npx vitest run src/features/student-delivery/ui/SatExamShell.test.tsx -t "Eraser"`

Expected: STILL FAIL (button missing) — proceed to Task 4, which makes it pass. Do not commit yet; Task 3 + Task 4 commit together.

- [ ] **Step 5: Commit (with Task 4)**

No separate commit. Combined commit is defined in Task 4 Step 5.

---

### Task 4: Eraser button in the top bar

**Files:**

- Modify: `src/features/student-delivery/ui/shell/SatExamTopBar.tsx`
- Modify: `src/features/student-delivery/ui/SatExamShell.tsx` (from Task 3)
- Modify: `src/features/student-delivery/ui/annotations/SatAnnotationModeContext.ts` (from Task 3)
- Test: `src/features/student-delivery/ui/SatExamShell.test.tsx` (from Task 3)

- [ ] **Step 1: Write the failing test**

Already written in Task 3 Step 1 (shared test). No new test code in this task.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/student-delivery/ui/SatExamShell.test.tsx -t "Eraser"`

Expected: FAIL, no `Eraser` button.

- [ ] **Step 3: Write minimal implementation**

In `src/features/student-delivery/ui/shell/SatExamTopBar.tsx`, replace the prop line:

```ts
  onToggleAnnotationMode?: (mode: 'highlight' | 'underline') => void;
```

with:

```ts
  onToggleAnnotationMode?: (mode: 'highlight' | 'underline' | 'erase') => void;
```

and replace the toolbar block:

```tsx
          {props.notesAvailable ? (['highlight', 'underline'] as const).map((mode) => (
            <button key={mode} type="button" aria-label={mode === 'highlight' ? 'Highlight' : 'Underline'}
              aria-pressed={props.annotationMode === mode} disabled={props.blocked}
              onClick={() => props.onToggleAnnotationMode?.(mode)}
              className="sat-touch-target min-w-0 rounded px-2 text-sm font-medium aria-pressed:bg-[var(--sat-accent-soft)] aria-pressed:text-[var(--sat-accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--sat-focus)]"
            >{mode === 'highlight' ? 'Highlight' : 'Underline'}</button>
          )) : null}
```

with:

```tsx
          {props.notesAvailable ? (['highlight', 'underline', 'erase'] as const).map((mode) => (
            <button key={mode} type="button" aria-label={mode === 'highlight' ? 'Highlight' : mode === 'underline' ? 'Underline' : 'Eraser'}
              aria-pressed={props.annotationMode === mode} disabled={props.blocked}
              onClick={() => props.onToggleAnnotationMode?.(mode)}
              className="sat-touch-target min-w-0 rounded px-2 text-sm font-medium aria-pressed:bg-[var(--sat-accent-soft)] aria-pressed:text-[var(--sat-accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--sat-focus)]"
            >{mode === 'highlight' ? 'Highlight' : mode === 'underline' ? 'Underline' : 'Eraser'}</button>
          )) : null}
```

Text-only button (same treatment as Highlight/Underline) — no icon import, no layout change. Hidden in Math via the existing `notesAvailable` gate; inert/disabled when blocked via existing `disabled={props.blocked}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/student-delivery/ui/SatExamShell.test.tsx`

Expected: PASS (existing highlight-persistence test + new Eraser exclusivity test).

- [ ] **Step 5: Commit**

```bash
git add src/features/student-delivery/ui/annotations/SatAnnotationModeContext.ts src/features/student-delivery/ui/SatExamShell.tsx src/features/student-delivery/ui/shell/SatExamTopBar.tsx src/features/student-delivery/ui/SatExamShell.test.tsx
git commit -m "feat(sat): add Eraser toggle to exam top bar"
```

---

### Task 5: Erase behavior in the annotated content surface

**Files:**

- Modify: `src/features/student-delivery/ui/annotations/SatAnnotatedContent.tsx`
- Test: `src/features/student-delivery/ui/annotations/SatAnnotatedContent.test.tsx`

- [ ] **Step 1: Write the failing test**

In `src/features/student-delivery/ui/annotations/SatAnnotatedContent.test.tsx`, widen the existing helper `view` mode union from `'none' | 'highlight'` to `'none' | 'highlight' | 'erase'`, then append inside `describe('SAT annotation decoration')`:

```tsx
  it('removes intersecting marks on selection completion while erase mode is armed', () => {
    const onChange = vi.fn();
    const content = { version: 1 as const, nodes: [{ type: 'paragraph' as const, id: 'p', text: 'A tree grows.' }] };
    const annotations = emptySatAnnotations();
    annotations.annotations = [
      createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:p', startOffset: 2, endOffset: 6, exact: 'tree' }),
      createSatTextAnnotation({ kind: 'underline', nodeId: 'stimulus:p', startOffset: 7, endOffset: 12, exact: 'grows' }),
    ];
    const view = (mode: 'none' | 'highlight' | 'erase') => <SatAnnotationModeContext.Provider value={mode}>
      <SatAnnotatedContent content={content} annotations={annotations} region="stimulus" enabled onChange={onChange} />
    </SatAnnotationModeContext.Provider>;
    const { container, rerender } = render(view('none'));
    rerender(view('erase'));
    const leaf = container.querySelector('[data-content-text-node] span span')!.firstChild!;
    const range = document.createRange();
    range.setStart(leaf, 2); range.setEnd(leaf, 6);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    fireEvent.pointerUp(container.firstChild!);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].annotations).toHaveLength(1);
    expect(onChange.mock.calls[0]![0].annotations[0]).toMatchObject({ kind: 'underline' });
    onChange.mockClear();
    const plain = document.createRange();
    plain.setStart(leaf, 0); plain.setEnd(leaf, 1);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(plain);
    fireEvent.pointerUp(container.firstChild!);
    expect(onChange).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/student-delivery/ui/annotations/SatAnnotatedContent.test.tsx -t "erase mode is armed"`

Expected: FAIL — `onChange` never called (current code creates nothing for unknown mode / treats erase as a kind).

- [ ] **Step 3: Write minimal implementation**

In `src/features/student-delivery/ui/annotations/SatAnnotatedContent.tsx`:

(a) Extend the import:

```ts
import { applySatAnnotationsToText, createSatTextAnnotation, type SatQuestionAnnotations, type SatTextAnnotation, type SatTextSegment } from '../../domain/satResponses';
```

becomes:

```ts
import { applySatAnnotationsToText, createSatTextAnnotation, removeSatAnnotationsInRange, type SatQuestionAnnotations, type SatTextAnnotation, type SatTextSegment } from '../../domain/satResponses';
```

(b) Replace the `complete` handler body:

```ts
    const complete = (event: Event) => {
      if (!root.current || annotations.annotations.length >= 200) return;
      if (event.type === 'pointerup' && (!(event.target instanceof Node) || !root.current.contains(event.target))) return;
      const anchor = captureSatTextSelection(root.current, region, window.getSelection());
      if (!anchor) return;
      const kind = mode === 'note' ? 'highlight' : mode;
```

with:

```ts
    const complete = (event: Event) => {
      if (!root.current) return;
      if (event.type === 'pointerup' && (!(event.target instanceof Node) || !root.current.contains(event.target))) return;
      const anchor = captureSatTextSelection(root.current, region, window.getSelection());
      if (!anchor) return;
      if (mode === 'erase') {
        const next = removeSatAnnotationsInRange(annotations, anchor.nodeId, anchor.startOffset, anchor.endOffset);
        if (next !== annotations) {
          onChange(next);
          window.getSelection()?.removeAllRanges();
        }
        return;
      }
      if (annotations.annotations.length >= 200) return;
      const kind = mode === 'note' ? 'highlight' : mode;
```

Type note: after the `mode === 'none'` early return at the effect top and the `mode === 'erase'` branch above, TypeScript narrows `mode` to `'highlight' | 'underline' | 'note'`, so the existing `kind` line typechecks unchanged.

(c) Replace the root element:

```tsx
  return <div ref={root} data-sat-annotation-region={enabled ? region : undefined}>
```

with:

```tsx
  return <div ref={root} data-sat-annotation-region={enabled ? region : undefined} data-sat-erase-armed={mode === 'erase' || undefined}
    style={mode === 'erase' ? { cursor: 'cell' } : undefined}>
```

Do NOT add `mode` to the `renderText` useMemo deps — segment output does not depend on mode. Do NOT gate on the 200-cap for erase (erasing at cap must still work).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/student-delivery/ui/annotations/SatAnnotatedContent.test.tsx`

Expected: PASS (2 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add src/features/student-delivery/ui/annotations/SatAnnotatedContent.tsx src/features/student-delivery/ui/annotations/SatAnnotatedContent.test.tsx
git commit -m "feat(sat): erase intersecting marks on selection in eraser mode"
```

---

### Task 6: Stale note-editor cleanup when its annotation is erased

**Files:**

- Modify: `src/features/student-delivery/ui/question/SatQuestionRenderer.tsx`
- Test: `src/features/student-delivery/ui/question/SatQuestionRenderer.test.tsx` (append; check file exists — if absent, create it with the test below plus the imports shown)

- [ ] **Step 1: Write the failing test**

Append to `src/features/student-delivery/ui/question/SatQuestionRenderer.test.tsx`:

```tsx
describe('annotation editor cleanup on erase', () => {
  it('closes the note editor when its annotation disappears from props', async () => {
    const question = makeQuestion();
    const noted = createSatTextAnnotation({ kind: 'highlight', nodeId: 'stimulus:debug', startOffset: 0, endOffset: 7, exact: 'Several', note: 'Check the evidence' });
    const seeded = (): SatQuestionResponseDraft => ({ questionId: question.examQuestionId, answer: '', markedForReview: false, eliminatedOptionIds: [], annotations: { version: 2, annotations: [noted], legacyQuestionNote: '' } });
    const view = (response: SatQuestionResponseDraft) => render(
      <SatQuestionRenderer sectionKey="reading-writing" questionNumber={1} question={question} response={response}
        eliminationMode={false} disabled={false} readingPreferences={createSatReadingPreferences()}
        onReadingSplitRatioChange={() => undefined} onAnswerChange={() => undefined}
        onToggleReview={() => undefined} onToggleEliminationMode={() => undefined} onToggleEliminatedOption={() => undefined} />,
    );
    const { rerender, unmount } = view(seeded());
    fireEvent.click(screen.getByRole('button', { name: 'Edit note: Several' }));
    expect(screen.getByRole('textbox', { name: 'Note for selected text' })).toBeInTheDocument();
    rerender(view({ ...seeded(), annotations: { version: 2, annotations: [], legacyQuestionNote: '' } }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Note for selected text' })).not.toBeInTheDocument());
    unmount();
  });
});
```

Helpers `makeQuestion()` resolution: if `SatQuestionRenderer.test.tsx` already defines a question factory, reuse its name and delete the local call (use the file's factory). If the file does not exist, create it with: imports for `fireEvent, render, screen, waitFor`, `describe/expect/it`, `SatQuestionRenderer`, `createSatTextAnnotation`, `createSatReadingPreferences`, type `SatQuestionResponseDraft`, and a minimal `makeQuestion()` returning a reading-writing `DeliveredQuestion` with `stimulus` paragraph `{ id: 'debug', text: 'Several researchers studied heat.' }`, prompt paragraph, and a 2-option single_choice answer. Keep the factory to stimulus+prompt+answer only.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/student-delivery/ui/question/SatQuestionRenderer.test.tsx -t "disappears from props"`

Expected: FAIL — file missing, or the textbox stays mounted (stale `editingNoteId` keeps rendering) depending on current behavior. Note: without the cleanup effect the editor DOES unmount (find returns undefined) but the stale id lingers and reopens incorrectly on next identical-id render; the committed effect makes the null-out explicit and the test pins it. If the test passes without the effect, keep the effect anyway (stale-id hygiene) and keep the test as the pin.

- [ ] **Step 3: Write minimal implementation**

In `src/features/student-delivery/ui/question/SatQuestionRenderer.tsx`, after:

```tsx
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  useEffect(() => { setEditingNoteId(null); }, [props.question.examQuestionId, props.disabled]);
```

insert:

```tsx
  useEffect(() => {
    if (editingNoteId && !props.response.annotations.annotations.some((annotation) => annotation.id === editingNoteId)) {
      setEditingNoteId(null);
    }
  }, [props.response.annotations, editingNoteId]);
```

No other renderer changes. `enabled={policy.highlight || policy.underline}` already gates erase to R&W; erase never calls `onEditNote` (only `mode === 'note'` does); erasing a noted mark deletes note + decoration together via the Task 1 helper.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/student-delivery/ui/question/SatQuestionRenderer.test.tsx src/features/student-delivery/ui/annotations/SatAnnotationNoteEditor.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/student-delivery/ui/question/SatQuestionRenderer.tsx src/features/student-delivery/ui/question/SatQuestionRenderer.test.tsx
git commit -m "feat(sat): close note editor when its annotation is erased"
```

---

### Task 7: End-to-end flow, persistence round-trip, and quality gates

**Files:**

- Modify: `src/features/student-delivery/ui/annotations/SatAnnotationFlow.test.tsx` (append flow test)
- Modify: `src/features/student-delivery/application/__tests__/satAnnotationRoundTrip.test.ts` (append erase case)
- Test-only task; no source changes expected. If a source change is needed to make a test pass, stop and re-plan — do not bundle drive-by fixes here.

- [ ] **Step 1: Write the failing tests**

(a) Append to `describe('SAT shell annotation flow')` in `src/features/student-delivery/ui/annotations/SatAnnotationFlow.test.tsx`:

```tsx
  it('erases a highlight via Eraser mode and exits erase on Escape', () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }));
    const selectFirstWord = () => {
      const leaf = container.querySelector('[data-sat-annotation-region="stimulus"] [data-content-text-node] span span')!.firstChild!;
      const range = document.createRange();
      range.setStart(leaf, 0); range.setEnd(leaf, 7);
      window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
      fireEvent.pointerUp(leaf.parentElement!);
    };
    selectFirstWord();
    expect(container.querySelector('[data-sat-highlight="true"]')).toHaveTextContent('Several');
    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }));
    expect(screen.getByRole('button', { name: 'Eraser' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'false');
    selectFirstWord();
    expect(container.querySelectorAll('[data-sat-highlight="true"]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Eraser' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Eraser' })).toHaveAttribute('aria-pressed', 'false');
    selectFirstWord();
    expect(container.querySelectorAll('[data-sat-highlight="true"]')).toHaveLength(0);
  });

  it('erases with the keyboard (shift+arrows then keyup) while erase is armed', () => {
    const { container } = render(<SatAccessibilityDebugRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }));
    const leaf = container.querySelector('[data-sat-annotation-region="stimulus"] [data-content-text-node] span span')!.firstChild!;
    const seed = document.createRange();
    seed.setStart(leaf, 0); seed.setEnd(leaf, 7);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(seed);
    fireEvent.pointerUp(leaf.parentElement!);
    expect(container.querySelector('[data-sat-highlight="true"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Eraser' }));
    const again = document.createRange();
    again.setStart(leaf, 0); again.setEnd(leaf, 7);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(again);
    fireEvent.keyUp(document, { key: 'ArrowRight', shiftKey: true });
    expect(container.querySelectorAll('[data-sat-highlight="true"]')).toHaveLength(0);
  });
```

(b) Append to `describe('SAT annotation recovery')` in `src/features/student-delivery/application/__tests__/satAnnotationRoundTrip.test.ts`:

```tsx
  it('keeps the wire format stable after an eraser removal', () => {
    const draft = emptySatQuestionResponse('question-1');
    const first = createSatTextAnnotation({
      id: 'annotation-1', kind: 'highlight', nodeId: 'stimulus:paragraph-1',
      startOffset: 4, endOffset: 12, exact: 'evidence', prefix: 'The ',
      suffix: ' shows', now: '2026-09-06T00:00:00Z',
    });
    const second = createSatTextAnnotation({
      id: 'annotation-2', kind: 'underline', nodeId: 'stimulus:paragraph-1',
      startOffset: 20, endOffset: 26, exact: 'claims', now: '2026-09-06T00:00:00Z',
    });
    draft.annotations.annotations.push(first, second);
    const erased = removeSatAnnotationsInRange(draft.annotations, 'stimulus:paragraph-1', 0, 15);
    expect(erased.annotations.map((a) => a.id)).toEqual(['annotation-2']);
    const wire = JSON.parse(JSON.stringify(satDraftToDurablePayload({ ...draft, annotations: erased })));
    expect(durablePayloadToSatDraft(draft.questionId, wire).annotations).toEqual(erased);
  });
```

Add `removeSatAnnotationsInRange` to that file's import from `../../domain/satResponses`.

- [ ] **Step 2: Run tests to verify they fail (pre-source state cannot be reproduced now — run to verify they PASS on current source)**

Run: `npx vitest run src/features/student-delivery/ui/annotations/SatAnnotationFlow.test.tsx src/features/student-delivery/application/__tests__/satAnnotationRoundTrip.test.ts`

Expected: PASS on the Task 1–6 source. (These are pinning/characterization tests written last; their "red" state was covered by Tasks 1–5. If either FAILS here, stop: root-cause in the earlier task's source, do not patch around it in this task.)

- [ ] **Step 3: Quality gates — typecheck, lint, full delivery suite (no source edits in this step)**

Run in order:

```bash
npm run typecheck
npx eslint src/features/student-delivery/domain/satResponses.ts src/features/student-delivery/domain/satInteractionState.ts src/features/student-delivery/domain/satInteractionIntents.ts src/features/student-delivery/hooks/useSatInteractionController.ts src/features/student-delivery/ui/annotations/SatAnnotationModeContext.ts src/features/student-delivery/ui/SatExamShell.tsx src/features/student-delivery/ui/shell/SatExamTopBar.tsx src/features/student-delivery/ui/annotations/SatAnnotatedContent.tsx src/features/student-delivery/ui/question/SatQuestionRenderer.tsx
npx vitest run src/features/student-delivery
```

Expected: `tsc` clean; eslint clean (no new warnings); full `student-delivery` suite green including pre-existing `SatExamShell`, `SatAnnotationFlow`, `satInteraction*`, `satAnnotationsV2`, outbox/persistence suites. Math-mode check: `SatAccessibilityDebugRoute` with `?mode=math` renders no Highlight/Underline/Eraser buttons (covered by existing `notesAvailable: false` shell test).

- [ ] **Step 4: Run gates again to confirm green (same commands as Step 3)**

Only needed if Step 3 required a test-only fix (e.g., selector drift like `[data-sat-highlight="true"]`). No source edits allowed in this task.

- [ ] **Step 5: Commit**

```bash
git add src/features/student-delivery/ui/annotations/SatAnnotationFlow.test.tsx src/features/student-delivery/application/__tests__/satAnnotationRoundTrip.test.ts
git commit -m "test(sat): pin eraser flow, keyboard erase, and post-erase persistence"
```

---

## Verification matrix (must all hold at the end)

| # | Check | Where |
|---|---|---|
| 1 | Eraser arms only in R&W; hidden in Math; disabled + inert when blocked/paused | TopBar `notesAvailable` gate + shell provider `'none'` + Task 3 test |
| 2 | Exclusive toggle: arming Eraser disarms Highlight/Underline/Notes and vice versa; re-press disarms | Controller `toggleAnnotationMode` + Task 3 test |
| 3 | Escape exits erase (no selection → `DISABLE_ANNOTATION_MODE`); transient selection cleared first when present | Escape arbitration + Tasks 2, 7 tests |
| 4 | Drag/double-click/keyboard selection in erase mode deletes intersecting highlight+underline; plain-text selection is a no-op (`onChange` not called) | Task 5 test |
| 5 | Erase works at the 200-annotation cap (cap gates creation only) | Code inspection Task 5b (no cap check on erase path) |
| 6 | Note attached to erased mark is deleted; open editor on that id unmounts; stale id nulled | Task 6 test |
| 7 | Erase mode survives question navigation, resets on module change, revoked on policy change | Task 2 test |
| 8 | Removal persists through the durable wire format (outbox/offline/retry unchanged) | Task 7b test |
| 9 | `npm run typecheck`, eslint on touched files, full `src/features/student-delivery` suite green | Task 7 Step 3 |
| 10 | Screen reader: `aria-label="Eraser"` + `aria-pressed`; keyboard-only erase path; focus return unchanged (no new surface) | Tasks 4, 7 tests |

## Out of scope (do not build)

- Bulk "clear all marks on this question" (follow-up; helpers ready).
- Per-span × delete buttons.
- Eraser in Math (annotations are R&W-only by policy).
- New policy flag, format v3, outbox/migration changes.
- Cursor/UX polish beyond `cursor: cell` + pressed state + `data-sat-erase-armed` hook.

## Self-review

1. **Spec coverage:** every locked decision has a task — eraser mode (2–5), both-kinds scope (1, 5), note-dies-with-mark (1, 6), no-policy-flag (explicit NOT-touched + Task 2 derivation), no-migration (Task 7b + NOT-touched). Escape/selection/blocked contracts pinned in Tasks 2, 5, 7.
2. **Placeholder scan:** no TBD/TODO/"similar to"/"appropriate handling" — all code blocks are copy-paste complete; Task 6 documents both branches (file exists vs. missing) with exact code for each.
3. **Type consistency:** `'erase'` spelled identically across `SatAnnotationInteractionMode`, `SatAnnotationMode`, intent union, controller signature, shell mapping, TopBar union; `removeSatAnnotationsInRange` / `removeSatAnnotationById` signatures identical in Tasks 1, 5, 7; `kind` narrowing in Task 5 relies on documented early returns.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-09-sat-highlight-eraser.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session, batch execution with checkpoints.

**Which approach?**
