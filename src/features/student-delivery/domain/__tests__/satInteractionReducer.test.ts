import { describe, expect, it } from 'vitest';
import {
  createSatInteractionState,
  isAnnotationAllowed,
  normalizeSatInteractionState,
  satInteractionReducer,
  type SatInteractionContext,
  type SatInteractionState,
} from '../satInteractionState';
import { resolveEscapeAction } from '../satInteractionEscape';
import { resolveSatInteractionIntent } from '../satInteractionIntents';
import { resolveSatExamToolPolicy } from '../satToolPolicy';
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

/** The one gesture that makes selection meaningful: arm the mode. */
function arm(state: SatInteractionState, ctx: SatInteractionContext = rwCtx()): SatInteractionState {
  return satInteractionReducer(state, { type: 'ANNOTATION_MODE_ENABLED' }, ctx);
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
  // mode, its selection, nor the exclusive surface.
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
    state = arm(state, bothCtx);
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

  it('settles a note editor into an open pane, so the next selection raises the tools', () => {
    const ctx = rwCtx();
    let state = arm(createSatInteractionState(), ctx);
    state = satInteractionReducer(
      state,
      {
        type: 'ANNOTATION_NOTE_EDITOR_OPENED',
        annotationId: 'ann-9',
        returnFocus: { type: 'question', questionId: 'q1' },
      },
      ctx,
    );
    // While the student is in the note, a selection is refused: one thing at a
    // time, and the field they are typing in is the thing.
    expect(
      satInteractionReducer(state, { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() }, ctx)
        .annotation.selection,
    ).toBeNull();

    // Pressing away settles the note and keeps the pane: the notes stay on screen
    // and the exam stops being "in" the editor — which is what makes the very
    // next selection a selection again instead of a competing editor.
    state = satInteractionReducer(state, { type: 'NOTE_EDITOR_SETTLED' }, ctx);
    expect(state.surface.kind).toBe('question-notes');
    const selected = satInteractionReducer(
      state,
      { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() },
      ctx,
    );
    expect(selected.annotation.selection).not.toBeNull();
  });

  it('leaves a pane that holds no live note exactly as it was', () => {
    const ctx = rwCtx();
    const paneOpen = satInteractionReducer(
      createSatInteractionState(),
      { type: 'QUESTION_NOTES_OPENED', returnFocus: { type: 'topbar', control: 'notes' } },
      ctx,
    );
    const settled = satInteractionReducer(paneOpen, { type: 'NOTE_EDITOR_SETTLED' }, ctx);
    // Nothing was open, so nothing settles: reading the notes is not a state to
    // be released from.
    expect(settled.surface).toEqual(paneOpen.surface);
  });

  // The invariant this whole pass exists for. Nothing about the state of the
  // exam — a selection, a surface, a note editor — may produce a selection in
  // an unarmed exam.
  it('starts unarmed, and a selection in an unarmed exam is discarded', () => {
    const ctx = rwCtx();
    expect(createSatInteractionState().annotation.modeEnabled).toBe(false);
    const state = satInteractionReducer(
      createSatInteractionState(),
      { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() },
      ctx,
    );
    expect(state.annotation.modeEnabled).toBe(false);
    expect(state.annotation.selection).toBeNull();
    // Same state reference: an ignored selection cannot churn a render either.
    expect(state).toEqual(createSatInteractionState());
  });

  it('arms the mode without touching the surface or inventing a selection', () => {
    const state = satInteractionReducer(
      createSatInteractionState(),
      { type: 'QUESTION_NOTES_OPENED', returnFocus: { type: 'topbar', control: 'notes' } },
      rwCtx(),
    );
    const armed = arm(state);
    expect(armed.annotation.modeEnabled).toBe(true);
    expect(armed.annotation.selection).toBeNull();
    // Arming is not opening: the column the student was reading stays open.
    expect(armed.surface.kind).toBe('question-notes');
    // And arming twice is not an event at all.
    expect(arm(armed)).toBe(armed);
  });

  it('captures a selection while armed and clears it on question change, keeping the mode', () => {
    const ctx = rwCtx();
    let state = arm(createSatInteractionState(), ctx);
    state = satInteractionReducer(state, { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() }, ctx);
    expect(state.annotation.selection).toEqual(anchor());
    state = satInteractionReducer(
      state,
      { type: 'QUESTION_CHANGED', moduleKey: 'rw-m1', questionId: 'q2' },
      { ...ctx, moduleKey: 'rw-m1', questionId: 'q2' },
    );
    expect(state.annotation.selection).toBeNull();
    expect(state.surface.kind).toBe('none');
    // The armed mode is the student's standing choice for the module, so the
    // next question is still armed and needs no re-arming.
    expect(state.annotation.modeEnabled).toBe(true);
  });

  it('resets the selection AND the mode on module change', () => {
    const ctx = rwCtx();
    let state = arm(createSatInteractionState(), ctx);
    state = satInteractionReducer(state, { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() }, ctx);
    state = satInteractionReducer(
      state,
      { type: 'MODULE_SCOPE_CHANGED', moduleKey: 'rw-m2', questionId: 'q1' },
      { ...ctx, moduleKey: 'rw-m2', questionId: 'q1' },
    );
    expect(state.annotation.modeEnabled).toBe(false);
    expect(state.annotation.selection).toBeNull();
    expect(state.surface.kind).toBe('none');
    expect(state.scope).toEqual({ moduleKey: 'rw-m2', questionId: 'q1' });
  });

  it('closes the tools by dropping the selection when the mode is disarmed', () => {
    const ctx = rwCtx();
    let state = arm(createSatInteractionState(), ctx);
    state = satInteractionReducer(state, { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() }, ctx);
    expect(state.annotation.selection).not.toBeNull();
    const disarmed = satInteractionReducer(state, { type: 'ANNOTATION_MODE_DISABLED' }, ctx);
    expect(disarmed.annotation.modeEnabled).toBe(false);
    expect(disarmed.annotation.selection).toBeNull();
  });

  // The mode's own cleanup, asserted on the surface as well: the panel the
  // student was reading is NOT the mode's to close. Two independent states
  // means disarming one leaves the other exactly where it was.
  it('disarming leaves an open Notes column open', () => {
    const ctx = rwCtx();
    let state = satInteractionReducer(
      createSatInteractionState(),
      { type: 'QUESTION_NOTES_OPENED', returnFocus: { type: 'topbar', control: 'notes' } },
      ctx,
    );
    state = arm(state, ctx);
    // Arming did not close it…
    expect(state.surface.kind).toBe('question-notes');
    const disarmed = satInteractionReducer(state, { type: 'ANNOTATION_MODE_DISABLED' }, ctx);
    // …and disarming does not either.
    expect(disarmed.surface).toEqual(state.surface);
    expect(disarmed.surface.kind).toBe('question-notes');
  });

  it('refuses a selection without annotation capability and normalizes one that policy revokes', () => {
    const captured = satInteractionReducer(
      arm(createSatInteractionState(), mathCtx()),
      { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() },
      mathCtx(),
    );
    expect(captured.annotation.selection).toBeNull();
    expect(captured.annotation.modeEnabled).toBe(false);
    // Capability asserted directly: the reducer and the selectors agree.
    expect(isAnnotationAllowed(mathCtx().toolPolicy)).toBe(false);
    expect(isAnnotationAllowed(rwCtx().toolPolicy)).toBe(true);

    const rwState = satInteractionReducer(
      arm(createSatInteractionState()),
      { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() },
      rwCtx(),
    );
    expect(rwState.annotation.selection).not.toBeNull();
    expect(rwState.annotation.modeEnabled).toBe(true);
    // Entering a section without annotation data regions drops the anchor and
    // disarms the mode, so a Math question can never inherit a R&W toolbar.
    const normalized = normalizeSatInteractionState(rwState, mathCtx()).annotation;
    expect(normalized.selection).toBeNull();
    expect(normalized.modeEnabled).toBe(false);
  });

  it('refuses a selection while the note editor owns interaction', () => {
    const ctx = rwCtx();
    let state = satInteractionReducer(
      arm(createSatInteractionState(), ctx),
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

  it('discards all interaction, including the mode, on terminal transition', () => {
    let state = arm(createSatInteractionState());
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

describe('armed annotation intents', () => {
  it('resolves a captured selection in R&W and refuses it in Math', () => {
    const intent = { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() } as const;
    expect(resolveSatInteractionIntent(createSatInteractionState(), rwCtx(), intent)).toEqual(intent);
    expect(resolveSatInteractionIntent(createSatInteractionState(), mathCtx(), intent)).toBeNull();
  });

  it('maps one toggle request onto the mode the machine is actually in', () => {
    const off = createSatInteractionState();
    expect(resolveSatInteractionIntent(off, rwCtx(), { type: 'ANNOTATION_MODE_TOGGLE_REQUESTED' })).toEqual({
      type: 'ANNOTATION_MODE_ENABLED',
    });
    const on = arm(off);
    expect(resolveSatInteractionIntent(on, rwCtx(), { type: 'ANNOTATION_MODE_TOGGLE_REQUESTED' })).toEqual({
      type: 'ANNOTATION_MODE_DISABLED',
    });
    // No capability, no mode: Math cannot arm annotation through any path.
    expect(resolveSatInteractionIntent(off, mathCtx(), { type: 'ANNOTATION_MODE_TOGGLE_REQUESTED' })).toBeNull();
  });

  it('keeps the selection across a question change contract and clears it explicitly', () => {
    const ctx = rwCtx();
    let state = arm(createSatInteractionState({ moduleKey: 'rw-m1', questionId: 'q1' }));
    const event = resolveSatInteractionIntent(state, ctx, { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() });
    state = satInteractionReducer(state, event!, ctx);
    expect(state.annotation.selection).not.toBeNull();
    const cleared = resolveSatInteractionIntent(state, ctx, { type: 'TEXT_SELECTION_CLEARED' });
    expect(cleared).toEqual({ type: 'TEXT_SELECTION_CLEARED' });
    state = satInteractionReducer(state, cleared!, ctx);
    expect(state.annotation.selection).toBeNull();
    // Dismissing the tools does not disarm the tool.
    expect(state.annotation.modeEnabled).toBe(true);
  });

  it('exits the selection through the standard Escape arbitration', () => {
    const ctx = rwCtx();
    const selected = satInteractionReducer(
      arm(createSatInteractionState()),
      { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() },
      ctx,
    );
    expect(resolveEscapeAction(selected, ctx)).toEqual({ type: 'CLEAR_SELECTION' });
  });

  // Escape dismisses chrome; it does not silently disarm the mode. A student who
  // pressed Escape to get rid of a toolbar must not find the next selection
  // does nothing, with the top-bar toggle still claiming to be on.
  it('leaves the mode armed when Escape clears a selection', () => {
    const ctx = rwCtx();
    const armed = arm(createSatInteractionState());
    expect(resolveEscapeAction(armed, ctx)).toEqual({ type: 'NOOP' });
    const selected = satInteractionReducer(armed, { type: 'TEXT_SELECTION_CAPTURED', anchor: anchor() }, ctx);
    const afterEscape = satInteractionReducer(selected, { type: 'TEXT_SELECTION_CLEARED' }, ctx);
    expect(afterEscape.annotation.modeEnabled).toBe(true);
  });
});
