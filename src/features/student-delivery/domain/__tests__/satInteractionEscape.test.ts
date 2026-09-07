import { describe, expect, it } from 'vitest';
import { createSatInteractionState } from '../satInteractionState';
import { resolveEscapeAction } from '../satInteractionEscape';
import type { SatInteractionContext } from '../satInteractionState';
import { resolveSatExamToolPolicy } from '../satToolPolicy';

function ctx(): SatInteractionContext {
  return {
    phase: 'module',
    paused: false,
    terminated: false,
    isSubmitting: false,
    persistenceBlocked: false,
    toolPolicy: resolveSatExamToolPolicy('reading-writing', []),
    sectionKey: 'reading-writing',
    moduleKey: 'rw-m1',
    questionId: 'q1',
  };
}

describe('resolveEscapeAction (exactly one semantic action per press)', () => {
  it('ignores Escape while blocked or terminal', () => {
    const state = {
      ...createSatInteractionState(),
      surface: { kind: 'navigator' as const, returnFocus: { type: 'footer' as const, control: 'navigator' as const } },
    };
    expect(resolveEscapeAction(state, { ...ctx(), paused: true }).type).toBe('IGNORE');
    expect(resolveEscapeAction(state, { ...ctx(), terminated: true }).type).toBe('IGNORE');
  });

  it('closes the annotation note editor before any other surface', () => {
    const state = {
      ...createSatInteractionState(),
      surface: {
        kind: 'annotation-note-editor' as const,
        annotationId: 'a1',
        returnFocus: { type: 'question' as const, questionId: 'q1' },
      },
    };
    expect(resolveEscapeAction(state, ctx()).type).toBe('CLOSE_ANNOTATION_EDITOR');
  });

  it('closes an open exclusive surface next', () => {
    const state = {
      ...createSatInteractionState(),
      surface: { kind: 'navigator' as const, returnFocus: { type: 'footer' as const, control: 'navigator' as const } },
    };
    expect(resolveEscapeAction(state, ctx()).type).toBe('CLOSE_SURFACE');
  });

  it('clears transient selection before disabling a persistent annotation mode', () => {
    const selecting = {
      ...createSatInteractionState(),
      annotation: { mode: 'highlight' as const, textSelection: 'selecting' as const },
    };
    expect(resolveEscapeAction(selecting, ctx()).type).toBe('CLEAR_SELECTION');
    const armed = {
      ...createSatInteractionState(),
      annotation: { mode: 'highlight' as const, textSelection: 'idle' as const },
    };
    expect(resolveEscapeAction(armed, ctx()).type).toBe('DISABLE_ANNOTATION_MODE');
  });

  it('is a NOOP when nothing is open, armed, or selecting', () => {
    expect(resolveEscapeAction(createSatInteractionState(), ctx()).type).toBe('NOOP');
  });
});
