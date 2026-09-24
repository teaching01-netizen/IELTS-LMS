import { describe, expect, it } from 'vitest';
import { createSatInteractionState } from '../satInteractionState';
import { resolveInteractionGate, satInteractionCan } from '../satInteractionGuards';
import type { SatInteractionContext } from '../satInteractionState';
import { resolveSatExamToolPolicy } from '../satToolPolicy';

function mathTools() {
  return resolveSatExamToolPolicy('math', ['calculator', 'reference_sheet']);
}

function rwTools() {
  return resolveSatExamToolPolicy('reading-writing', []);
}

function ctx(overrides: Partial<SatInteractionContext> = {}): SatInteractionContext {
  return {
    phase: 'module',
    paused: false,
    terminated: false,
    isSubmitting: false,
    persistenceBlocked: false,
    toolPolicy: mathTools(),
    sectionKey: 'math',
    moduleKey: 'math-m1',
    questionId: 'q1',
    ...overrides,
  };
}

describe('satInteraction guards (production-hostile)', () => {
  it('refuses navigator outside the live module phase', () => {
    for (const phase of ['directions', 'review', 'break', 'submitting', 'complete'] as const) {
      expect(satInteractionCan.openNavigator(createSatInteractionState(), ctx({ phase }))).toBe(false);
    }
  });

  it('refuses every interaction while paused, submitting, or terminated', () => {
    const blocked = [
      ctx({ paused: true }),
      ctx({ isSubmitting: true }),
      ctx({ terminated: true }),
    ];
    for (const context of blocked) {
      const state = createSatInteractionState();
      expect(satInteractionCan.answer(state, context)).toBe(false);
      expect(satInteractionCan.navigate(state, context)).toBe(false);
      expect(satInteractionCan.openNavigator(state, context)).toBe(false);
      expect(satInteractionCan.openCalculator(state, context)).toBe(false);
      expect(satInteractionCan.openReference(state, context)).toBe(false);
      expect(satInteractionCan.annotate(state, context)).toBe(false);
      expect(satInteractionCan.openQuestionNotes(state, context)).toBe(false);
      expect(satInteractionCan.openReadingSettings(state, context)).toBe(false);
    }
  });

  it('derives the gate: terminal outranks blocked outranks interactive', () => {
    expect(resolveInteractionGate(ctx())).toBe('interactive');
    expect(resolveInteractionGate(ctx({ paused: true }))).toBe('blocked');
    expect(resolveInteractionGate(ctx({ isSubmitting: true }))).toBe('blocked');
    expect(resolveInteractionGate(ctx({ terminated: true }))).toBe('terminal');
    expect(resolveInteractionGate(ctx({ terminated: true, paused: true }))).toBe('terminal');
  });

  it('gates math tools on module policy, never on section alone', () => {
    expect(
      satInteractionCan.openCalculator(createSatInteractionState(), ctx({ toolPolicy: mathTools() })),
    ).toBe(true);
    expect(
      satInteractionCan.openCalculator(
        createSatInteractionState(),
        ctx({ toolPolicy: resolveSatExamToolPolicy('math', []) }),
      ),
    ).toBe(false);
    // R&W never grants calculator even when advertised.
    expect(
      satInteractionCan.openCalculator(createSatInteractionState(), ctx({ toolPolicy: rwTools(), sectionKey: 'reading-writing' })),
    ).toBe(false);
  });

  it('gates annotation on capability, not on section string', () => {
    expect(
      satInteractionCan.annotate(createSatInteractionState(), ctx({ toolPolicy: rwTools(), sectionKey: 'reading-writing' })),
    ).toBe(true);
    expect(satInteractionCan.annotate(createSatInteractionState(), ctx({ toolPolicy: mathTools() }))).toBe(true);
    const noAnnotation = { ...mathTools(), highlight: false, underline: false, notes: false };
    expect(satInteractionCan.annotate(createSatInteractionState(), ctx({ toolPolicy: noAnnotation }))).toBe(false);
  });

  it('forbids answering while the annotation note editor owns the surface', () => {
    const state = {
      ...createSatInteractionState(),
      surface: {
        kind: 'annotation-note-editor' as const,
        annotationId: 'ann-1',
        returnFocus: { type: 'question' as const, questionId: 'q1' },
      },
    };
    // Answering is blocked, but closing the editor stays available.
    expect(satInteractionCan.answer(state, ctx())).toBe(false);
    expect(satInteractionCan.closeSurface(state, ctx())).toBe(true);
  });

  it('never duplicates authoritative exam state inside interaction state', () => {
    const state = createSatInteractionState();
    expect(state).not.toHaveProperty('paused');
    expect(state).not.toHaveProperty('terminated');
    expect(state).not.toHaveProperty('isSubmitting');
    expect(state).not.toHaveProperty('phase');
    expect(state).not.toHaveProperty('toolPolicy');
  });
});
