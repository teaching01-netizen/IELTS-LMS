import { describe, expect, it } from 'vitest';
import { resolveSatInteractionIntent } from '../satInteractionIntents';
import { createSatInteractionState } from '../satInteractionState';
import type { SatInteractionContext } from '../satInteractionState';
import { resolveSatExamToolPolicy } from '../satToolPolicy';

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

describe('resolveSatInteractionIntent (intent, not mutation)', () => {
  // Tool buttons dispatch runner commands directly (activeTools is the
  // single tool truth), so the machine refuses tool intents in all cases —
  // revoked or not — instead of resolving them to events.
  it('refuses calculator and reference toggle intents unconditionally', () => {
    expect(
      resolveSatInteractionIntent(createSatInteractionState(), mathCtx(), {
        type: 'CALCULATOR_TOGGLE_REQUESTED',
      }),
    ).toBeNull();
    expect(
      resolveSatInteractionIntent(createSatInteractionState(), mathCtx(), {
        type: 'REFERENCE_TOGGLE_REQUESTED',
      }),
    ).toBeNull();
  });

  it('toggles an exclusive surface closed when the same surface is requested', () => {
    const open = {
      ...createSatInteractionState(),
      surface: {
        kind: 'navigator' as const,
        returnFocus: { type: 'footer' as const, control: 'navigator' as const },
      },
    };
    expect(
      resolveSatInteractionIntent(open, mathCtx(), {
        type: 'SURFACE_TOGGLE_REQUESTED',
        surface: 'navigator',
      }),
    ).toEqual({ type: 'SURFACE_CLOSED' });
  });

  it('refuses surface opens while the annotation editor is unresolved', () => {
    const editor = {
      ...createSatInteractionState(),
      surface: {
        kind: 'annotation-note-editor' as const,
        annotationId: 'a1',
        returnFocus: { type: 'question' as const, questionId: 'q1' },
      },
    };
    expect(
      resolveSatInteractionIntent(editor, mathCtx(), { type: 'NAVIGATOR_OPEN_REQUESTED' }),
    ).toBeNull();
    // …but the editor itself can always be closed.
    expect(
      resolveSatInteractionIntent(editor, mathCtx(), { type: 'SURFACE_CLOSE_REQUESTED' }),
    ).toEqual({ type: 'ANNOTATION_NOTE_EDITOR_CLOSED' });
  });

  it('refuses text-selection capture outside R&W capability', () => {
    // The intent layer resolves DATA, not session policy: whether the mode is
    // armed is the reducer's guard (see satInteractionReducer), because an
    // in-flight selection must still be discarded by the state machine that
    // owns the mode. Capability is what this layer can answer.
    const anchor = { nodeId: 'stimulus:p1', startOffset: 0, endOffset: 4, exact: 'tree' } as const;
    expect(
      resolveSatInteractionIntent(createSatInteractionState(), mathCtx(), {
        type: 'TEXT_SELECTION_CAPTURED',
        anchor,
      }),
    ).toBeNull();
    const rw = { ...mathCtx(), toolPolicy: { ...mathCtx().toolPolicy, highlight: true, underline: true, notes: true } };
    expect(
      resolveSatInteractionIntent(createSatInteractionState(), rw, {
        type: 'TEXT_SELECTION_CAPTURED',
        anchor,
      }),
    ).toEqual({ type: 'TEXT_SELECTION_CAPTURED', anchor });
  });

  it('maps question navigation intent to an explicit scope transition', () => {
    expect(
      resolveSatInteractionIntent(createSatInteractionState(), mathCtx(), {
        type: 'QUESTION_NAVIGATION_REQUESTED',
        moduleKey: 'math-m1',
        questionId: 'q2',
      }),
    ).toEqual({ type: 'QUESTION_CHANGED', moduleKey: 'math-m1', questionId: 'q2' });
  });
});
