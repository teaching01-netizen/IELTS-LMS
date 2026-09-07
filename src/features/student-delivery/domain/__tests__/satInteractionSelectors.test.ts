import { describe, expect, it } from 'vitest';
import { selectSatInteraction } from '../satInteractionSelectors';
import { createSatInteractionState } from '../satInteractionState';
import type { SatInteractionContext } from '../satInteractionState';
import { resolveSatExamToolPolicy } from '../satToolPolicy';

function ctx(): SatInteractionContext {
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

describe('selectSatInteraction (dumb UI contract)', () => {
  it('exposes capabilities without leaking raw state comparisons into JSX', () => {
    const view = selectSatInteraction(createSatInteractionState(), ctx());
    expect(view.can.openCalculator).toBe(true);
    expect(view.can.annotate).toBe(false);
    expect(view.tools.calculator.visible).toBe(false);
    expect(view.is.blocked).toBe(false);
    expect(view.gate).toBe('interactive');
  });

  it('marks blocked/terminal without components reading pause flags', () => {
    expect(selectSatInteraction(createSatInteractionState(), { ...ctx(), paused: true }).is.blocked).toBe(true);
    expect(selectSatInteraction(createSatInteractionState(), { ...ctx(), terminated: true }).is.terminal).toBe(true);
    expect(selectSatInteraction(createSatInteractionState(), { ...ctx(), paused: true }).can.answer).toBe(false);
  });

  it('reflects open surfaces and tool visibility', () => {
    const state = {
      ...createSatInteractionState(),
      surface: {
        kind: 'navigator' as const,
        returnFocus: { type: 'footer' as const, control: 'navigator' as const },
      },
      tools: { calculator: 'open' as const, reference: 'closed' as const },
    };
    const view = selectSatInteraction(state, ctx());
    expect(view.is.navigatorOpen).toBe(true);
    expect(view.is.surfaceOpen).toBe(true);
    expect(view.tools.calculator.visible).toBe(true);
  });
});
