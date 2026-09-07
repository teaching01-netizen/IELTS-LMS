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
  it('refuses calculator open when policy revokes it, but always allows close', () => {
    const rw = {
      ...mathCtx(),
      toolPolicy: resolveSatExamToolPolicy('reading-writing', []),
      sectionKey: 'reading-writing' as const,
    };
    expect(
      resolveSatInteractionIntent(createSatInteractionState(), rw, { type: 'CALCULATOR_TOGGLE_REQUESTED' }),
    ).toBeNull();
    const open = { ...createSatInteractionState(), tools: { calculator: 'open' as const, reference: 'closed' as const } };
    expect(
      resolveSatInteractionIntent(open, rw, { type: 'CALCULATOR_TOGGLE_REQUESTED' }),
    ).toEqual({ type: 'CALCULATOR_CLOSED' });
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

  it('refuses annotation intents outside R&W capability', () => {
    expect(
      resolveSatInteractionIntent(createSatInteractionState(), mathCtx(), {
        type: 'ANNOTATION_MODE_REQUESTED',
        mode: 'highlight',
      }),
    ).toBeNull();
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
