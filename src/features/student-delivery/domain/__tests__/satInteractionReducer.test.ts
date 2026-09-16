import { describe, expect, it } from 'vitest';
import {
  createSatInteractionState,
  isAnnotationAllowed,
  normalizeSatInteractionState,
  satInteractionReducer,
} from '../satInteractionState';
import { resolveEscapeAction } from '../satInteractionEscape';
import { resolveSatInteractionIntent } from '../satInteractionIntents';
import { resolveSatExamToolPolicy } from '../satToolPolicy';
import type { SatInteractionContext } from '../satInteractionState';
import type { SatTextAnchor as Anchor } from '../satResponses';

function mathCtx(): SatInteractionContext {
  return {
    phase: 'module',
    paused: false,
    terminated: false,
    isSubmitting: false,
    persistenceBlocked: false,
    toolPolicy: resolveSatExamToolPolicy('math', ['calculator', 'reference_sheet']),
    sectionKey: 'math',
    moduleKey: 'math-m1',
    questionId: 'q1',
  };
}

function rwCtx(): SatInteractionContext {
  return {
    ...mathCtx(),
    toolPolicy: resolveSatExamToolPolicy('reading-writing', []),
    sectionKey: 'reading-writing',
  };
}

/** A captured selection anchor; the exact span is irrelevant to transitions. */
function anchor(exact: string = 'tree'): Anchor {
  return { nodeId: 'stimulus:p1', startOffset: 0, endOffset: exact.length, exact };
}

describe('satInteractionReducer transition contracts', () => {
  it('makes two exclusive surfaces structurally impossible', () => {
    let state = createSatInteractionState();
    state = satInteractionReducer(
      state,
      { type: 'NAVIGATOR_OPENED', returnFocus: { type: 'footer', control: 'navigator' } },
      mathCtx(),
    );
    expect(state.surface.kind).toBe('navigator');
    state = satInteractionReducer(
      state,
      { type: 'READING_SETTINGS_OPENED', returnFocus: { type: 'topbar', control: 'reading' } },
      mathCtx(),
    );
    expect(state.surface.kind).toBe('reading-settings');
    // Exactly one surface is ever present: the previous one was replaced, not stacked.
    expect(state.surface.kind).not.toBe('navigator');
  });

  // Tool events are runner-owned (activeTools) and reduce to strict no-ops
  // here: the same state reference returns, disturbing neither the annotation
  // selection nor the exclusive surface.
  it('treats tool events as strict no-ops beside a live selection and open surfaces', () => {
    const bothCtx = {
      ...mathCtx(),
      toolPolicy: { ...mathCtx().toolPolicy, highlight: true, underline: true, notes: true },
    };
    let state = createSatInteractionState();
    state = satInteractionReducer(
      state,
      { type: 'READING_SETTINGS_OPENED', returnFocus: { type: 'topbar', control: 'reading' } },
      bothCtx,
    );
    state = satInteractionReducer(state, { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() }, bothCtx);
    const before = state;
    state = satInteractionReducer(state, { type: 'CALCULATOR_OPENED' }, bothCtx);
    expect(state).toBe(before);
    expect(state.annotation.selection?.exact).toBe('tree');
    expect(state.surface.kind).toBe('reading-settings');
  });

  it('rejects navigator while the annotation note editor is unresolved', () => {
    let state = createSatInteractionState();
    state = satInteractionReducer(
      state,
      {
        type: 'ANNOTATION_NOTE_EDITOR_OPENED',
        annotationId: 'ann-9',
        returnFocus: { type: 'question', questionId: 'q1' },
      },
      rwCtx(),
    );
    const next = satInteractionReducer(
      state,
      { type: 'NAVIGATOR_OPENED', returnFocus: { type: 'footer', control: 'navigator' } },
      rwCtx(),
    );
    expect(next.surface.kind).toBe('annotation-note-editor');
  });

  it('captures a selection with no armed mode and clears it on question change', () => {
    const ctx = rwCtx();
    let state = createSatInteractionState();
    state = satInteractionReducer(state, { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() }, ctx);
    expect(state.annotation.selection).toEqual(anchor());
    state = satInteractionReducer(
      state,
      { type: 'QUESTION_CHANGED', moduleKey: 'rw-m1', questionId: 'q2' },
      { ...ctx, moduleKey: 'rw-m1', questionId: 'q2' },
    );
    expect(state.annotation.selection).toBeNull();
    expect(state.surface.kind).toBe('none');
  });

  it('resets the selection on module change, preserving nothing ephemeral', () => {
    const ctx = rwCtx();
    let state = createSatInteractionState();
    state = satInteractionReducer(state, { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() }, ctx);
    state = satInteractionReducer(
      state,
      { type: 'MODULE_SCOPE_CHANGED', moduleKey: 'rw-m1', questionId: 'q1' },
      { ...ctx, moduleKey: 'rw-m1', questionId: 'q1' },
    );
    expect(state.annotation.selection).toBeNull();
    expect(state.surface.kind).toBe('none');
    expect(state.scope).toEqual({ moduleKey: 'rw-m1', questionId: 'q1' });
  });

  it('refuses a selection without annotation capability and normalizes one that policy revokes', () => {
    const captured = satInteractionReducer(
      createSatInteractionState(),
      { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() },
      mathCtx(),
    );
    expect(captured.annotation.selection).toBeNull();
    // Capability asserted directly: the reducer and the selectors agree.
    expect(isAnnotationAllowed(mathCtx().toolPolicy)).toBe(false);
    expect(isAnnotationAllowed(rwCtx().toolPolicy)).toBe(true);

    const rwState = satInteractionReducer(
      createSatInteractionState(),
      { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() },
      rwCtx(),
    );
    expect(rwState.annotation.selection).not.toBeNull();
    // Entering a section without annotation data regions drops the anchor so a
    // Math question can never inherit a R&W toolbar.
    expect(normalizeSatInteractionState(rwState, mathCtx()).annotation.selection).toBeNull();
  });

  it('refuses a selection while the note editor owns interaction', () => {
    const ctx = rwCtx();
    let state = satInteractionReducer(
      createSatInteractionState(),
      {
        type: 'ANNOTATION_NOTE_EDITOR_OPENED',
        annotationId: 'ann-1',
        returnFocus: { type: 'question', questionId: 'q1' },
      },
      ctx,
    );
    state = satInteractionReducer(state, { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() }, ctx);
    expect(state.annotation.selection).toBeNull();
    expect(state.surface.kind).toBe('annotation-note-editor');
  });

  it('discards all interaction on terminal transition', () => {
    let state = createSatInteractionState();
    state = satInteractionReducer(state, { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() }, rwCtx());
    state = satInteractionReducer(state, { type: 'TERMINAL_TRANSITION' }, mathCtx());
    expect(state).toEqual({
      ...createSatInteractionState(),
      scope: state.scope,
    });
  });

  it('is a pure function: same (S, C, E) always yields the same S-prime', () => {
    const event = { type: 'NAVIGATOR_OPENED', returnFocus: { type: 'footer', control: 'navigator' } } as const;
    const a = satInteractionReducer(createSatInteractionState(), event, mathCtx());
    const b = satInteractionReducer(createSatInteractionState(), event, mathCtx());
    expect(a).toEqual(b);
  });
});

describe('selection-first annotation intents', () => {
  it('resolves a captured selection in R&W and refuses it in Math', () => {
    const intent = { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() } as const;
    expect(resolveSatInteractionIntent(createSatInteractionState(), rwCtx(), intent)).toEqual(intent);
    expect(resolveSatInteractionIntent(createSatInteractionState(), mathCtx(), intent)).toBeNull();
  });

  it('keeps the selection across a question change contract and clears it explicitly', () => {
    const ctx = rwCtx();
    let state = createSatInteractionState({ moduleKey: 'rw-m1', questionId: 'q1' });
    const event = resolveSatInteractionIntent(state, ctx, { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() });
    state = satInteractionReducer(state, event!, ctx);
    expect(state.annotation.selection).not.toBeNull();
    const cleared = resolveSatInteractionIntent(state, ctx, { type: 'TEXT_SELECTION_CLEARED' });
    expect(cleared).toEqual({ type: 'TEXT_SELECTION_CLEARED' });
    state = satInteractionReducer(state, cleared!, ctx);
    expect(state.annotation.selection).toBeNull();
  });

  it('exits the selection through the standard Escape arbitration', () => {
    const ctx = rwCtx();
    const selected = satInteractionReducer(
      createSatInteractionState(),
      { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() },
      ctx,
    );
    expect(resolveEscapeAction(selected, ctx)).toEqual({ type: 'CLEAR_SELECTION' });
  });
});
