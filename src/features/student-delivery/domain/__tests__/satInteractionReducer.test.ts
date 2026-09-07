import { describe, expect, it } from 'vitest';
import {
  createSatInteractionState,
  normalizeSatInteractionState,
  satInteractionReducer,
} from '../satInteractionState';
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

  it('keeps calculator open beside highlight mode, but closes reading settings on tool open', () => {
    // The machine is policy-agnostic: use a synthetic context granting both
    // (real section policies never do — R&W has no calculator, math has no
    // highlight — which is exactly what normalization enforces below).
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
    state = satInteractionReducer(state, { type: 'CALCULATOR_OPENED' }, bothCtx);
    expect(state.tools.calculator).toBe('open');
    expect(state.annotation.mode).toBe('highlight');
    expect(state.surface.kind).toBe('none');
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

  it('resets annotation mode and closes tools on module change, preserving nothing ephemeral', () => {
    let state = createSatInteractionState();
    state = satInteractionReducer(state, { type: 'ANNOTATION_MODE_CHANGED', mode: 'underline' }, rwCtx());
    state = satInteractionReducer(state, { type: 'CALCULATOR_OPENED' }, mathCtx());
    state = satInteractionReducer(
      state,
      { type: 'MODULE_SCOPE_CHANGED', moduleKey: 'rw-m1', questionId: 'q1' },
      { ...rwCtx(), moduleKey: 'rw-m1', questionId: 'q1' },
    );
    expect(state.annotation.mode).toBe('off');
    expect(state.annotation.textSelection).toBe('idle');
    expect(state.tools.calculator).toBe('closed');
    expect(state.tools.reference).toBe('closed');
    expect(state.surface.kind).toBe('none');
    expect(state.scope).toEqual({ moduleKey: 'rw-m1', questionId: 'q1' });
  });

  it('normalizes away tools that policy revokes (math -> R&W)', () => {
    let state = createSatInteractionState();
    state = satInteractionReducer(state, { type: 'CALCULATOR_OPENED' }, mathCtx());
    state = satInteractionReducer(state, { type: 'REFERENCE_OPENED' }, mathCtx());
    const normalized = normalizeSatInteractionState(state, rwCtx());
    expect(normalized.tools.calculator).toBe('closed');
    expect(normalized.tools.reference).toBe('closed');
    expect(normalized.annotation.mode).toBe('off');
  });

  it('discards all interaction on terminal transition', () => {
    let state = createSatInteractionState();
    state = satInteractionReducer(state, { type: 'ANNOTATION_MODE_CHANGED', mode: 'highlight' }, rwCtx());
    state = satInteractionReducer(state, { type: 'CALCULATOR_OPENED' }, mathCtx());
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
