import { describe, expect, it } from 'vitest';
import {
  createSatInteractionState,
  isAnnotationModeAllowed,
  normalizeSatInteractionState,
  satInteractionReducer,
} from '../satInteractionState';
import { resolveEscapeAction } from '../satInteractionEscape';
import { resolveSatInteractionIntent } from '../satInteractionIntents';
import { resolveSatExamToolPolicy } from '../satToolPolicy';
import type { SatInteractionContext } from '../satInteractionState';

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
  // here: the same state reference returns, disturbing neither annotation
  // mode nor the exclusive surface.
  it('treats tool events as strict no-ops beside highlight mode and open surfaces', () => {
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
    state = satInteractionReducer(state, { type: 'ANNOTATION_MODE_CHANGED', mode: 'highlight' }, bothCtx);
    const before = state;
    state = satInteractionReducer(state, { type: 'CALCULATOR_OPENED' }, bothCtx);
    expect(state).toBe(before);
    expect(state.annotation.mode).toBe('highlight');
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

  it('clears transient selection on question change but preserves annotation mode', () => {
    let state = createSatInteractionState();
    state = satInteractionReducer(state, { type: 'ANNOTATION_MODE_CHANGED', mode: 'highlight' }, rwCtx());
    state = satInteractionReducer(state, { type: 'TEXT_SELECTION_STARTED' }, rwCtx());
    expect(state.annotation.textSelection).toBe('selecting');
    state = satInteractionReducer(
      state,
      { type: 'QUESTION_CHANGED', moduleKey: 'rw-m1', questionId: 'q2' },
      { ...rwCtx(), moduleKey: 'rw-m1', questionId: 'q2' },
    );
    expect(state.annotation.mode).toBe('highlight');
    expect(state.annotation.textSelection).toBe('idle');
    expect(state.surface.kind).toBe('none');
  });

  it('resets annotation mode on module change, preserving nothing ephemeral', () => {
    let state = createSatInteractionState();
    state = satInteractionReducer(state, { type: 'ANNOTATION_MODE_CHANGED', mode: 'underline' }, rwCtx());
    state = satInteractionReducer(
      state,
      { type: 'MODULE_SCOPE_CHANGED', moduleKey: 'rw-m1', questionId: 'q1' },
      { ...rwCtx(), moduleKey: 'rw-m1', questionId: 'q1' },
    );
    expect(state.annotation.mode).toBe('off');
    expect(state.annotation.textSelection).toBe('idle');
    expect(state.surface.kind).toBe('none');
    expect(state.scope).toEqual({ moduleKey: 'rw-m1', questionId: 'q1' });
  });

  it('normalizes away annotation modes that policy revokes (math -> R&W)', () => {
    let state = createSatInteractionState();
    state = satInteractionReducer(state, { type: 'ANNOTATION_MODE_CHANGED', mode: 'underline' }, mathCtx());
    const normalized = normalizeSatInteractionState(state, rwCtx());
    expect(normalized.annotation.mode).toBe('off');
  });

  it('discards all interaction on terminal transition', () => {
    let state = createSatInteractionState();
    state = satInteractionReducer(state, { type: 'ANNOTATION_MODE_CHANGED', mode: 'highlight' }, rwCtx());
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

describe('annotation eraser mode', () => {
  it('arms erase in R&W and refuses it where no annotation capability exists', () => {
    expect(isAnnotationModeAllowed('erase', rwCtx().toolPolicy)).toBe(true);
    expect(isAnnotationModeAllowed('erase', mathCtx().toolPolicy)).toBe(false);
    let state = createSatInteractionState({ moduleKey: 'rw-m1', questionId: 'q1' });
    state = satInteractionReducer(state, { type: 'ANNOTATION_MODE_CHANGED', mode: 'highlight' }, rwCtx());
    expect(state.annotation.mode).toBe('highlight');
    state = satInteractionReducer(state, { type: 'ANNOTATION_MODE_CHANGED', mode: 'erase' }, rwCtx());
    expect(state.annotation.mode).toBe('erase');
    // Refused transitions keep current state (established reducer contract);
    // central normalization is what drops a revoked mode to 'off'.
    const fromOff = satInteractionReducer(createSatInteractionState(), { type: 'ANNOTATION_MODE_CHANGED', mode: 'erase' }, mathCtx());
    expect(fromOff.annotation.mode).toBe('off');
    expect(normalizeSatInteractionState(state, mathCtx()).annotation.mode).toBe('off');
  });

  it('resolves the erase intent, survives question change, and resets on module change', () => {
    const ctx = rwCtx();
    let state = createSatInteractionState({ moduleKey: 'rw-m1', questionId: 'q1' });
    const event = resolveSatInteractionIntent(state, ctx, { type: 'ANNOTATION_MODE_REQUESTED', mode: 'erase' });
    expect(event).toEqual({ type: 'ANNOTATION_MODE_CHANGED', mode: 'erase' });
    state = satInteractionReducer(state, event!, ctx);
    state = satInteractionReducer(state, { type: 'QUESTION_CHANGED', moduleKey: 'rw-m1', questionId: 'q2' }, { ...ctx, questionId: 'q2' });
    expect(state.annotation.mode).toBe('erase');
    state = satInteractionReducer(state, { type: 'MODULE_SCOPE_CHANGED', moduleKey: 'rw-m2', questionId: 'q1' }, { ...ctx, moduleKey: 'rw-m2' });
    expect(state.annotation.mode).toBe('off');
  });

  it('exits erase through the standard Escape arbitration', () => {
    const ctx = rwCtx();
    const armed = satInteractionReducer(createSatInteractionState(), { type: 'ANNOTATION_MODE_CHANGED', mode: 'erase' }, ctx);
    expect(resolveEscapeAction(armed, ctx)).toEqual({ type: 'DISABLE_ANNOTATION_MODE' });
  });
});
