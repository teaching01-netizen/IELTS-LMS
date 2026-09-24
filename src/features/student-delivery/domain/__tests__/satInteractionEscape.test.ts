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

  it('dismisses the contextual annotation tools before the line reader', () => {
    const selected = {
      ...createSatInteractionState(),
      annotation: {
        modeEnabled: true,
        selectionToolsAnchor: { nodeId: 'stimulus:p1', startOffset: 0, endOffset: 4, exact: 'tree' },
      },
    };
    expect(resolveEscapeAction(selected, ctx()).type).toBe('DISMISS_SELECTION_TOOLS');
    expect(resolveEscapeAction(selected, ctx(), { lineReaderEnabled: true }).type).toBe('DISMISS_SELECTION_TOOLS');
    // With no selection the line reader is the next thing Escape turns off.
    expect(resolveEscapeAction(createSatInteractionState(), ctx(), { lineReaderEnabled: true }).type).toBe('DISABLE_LINE_READER');
  });

  it('is a NOOP when nothing is open, selected, or reading-aided', () => {
    expect(resolveEscapeAction(createSatInteractionState(), ctx()).type).toBe('NOOP');
    // An ARMED mode with nothing selected is still nothing to dismiss: Escape
    // dismisses chrome, and the mode is not chrome. It has its own control.
    expect(
      resolveEscapeAction(
        { ...createSatInteractionState(), annotation: { modeEnabled: true, selectionToolsAnchor: null } },
        ctx(),
      ).type,
    ).toBe('NOOP');
  });
});
