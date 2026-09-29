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
    expect(view.can.annotate).toBe(true);
    // Tool visibility is runner-owned (activeTools) — the view exposes
    // only capability (can.open*), never visibility.
    expect(view).not.toHaveProperty('tools');
    expect(view.is.blocked).toBe(false);
    expect(view.gate).toBe('interactive');
  });

  it('marks blocked/terminal without components reading pause flags', () => {
    expect(selectSatInteraction(createSatInteractionState(), { ...ctx(), paused: true }).is.blocked).toBe(true);
    expect(selectSatInteraction(createSatInteractionState(), { ...ctx(), terminated: true }).is.terminal).toBe(true);
    expect(selectSatInteraction(createSatInteractionState(), { ...ctx(), paused: true }).can.answer).toBe(false);
  });

  // Tool visibility lives in the runner (activeTools), not this view.
  // Surfaces still reflect.
  it('reflects open surfaces and exposes no tool visibility', () => {
    const state = {
      ...createSatInteractionState(),
      surface: {
        kind: 'navigator' as const,
        returnFocus: { type: 'footer' as const, control: 'navigator' as const },
      },
    };
    const view = selectSatInteraction(state, ctx());
    expect(view.is.navigatorOpen).toBe(true);
    expect(view.is.surfaceOpen).toBe(true);
    expect(view).not.toHaveProperty('tools');
  });

  it('exposes the armed annotation mode and the live selection as separate answers', () => {
    const anchor = { nodeId: 'stimulus:p1', startOffset: 0, endOffset: 4, exact: 'tree' };
    const view = selectSatInteraction(
      { ...createSatInteractionState(), annotation: { modeEnabled: true, selectionToolsAnchor: anchor } },
      { ...ctx(), toolPolicy: { ...ctx().toolPolicy, highlight: true, underline: true, notes: true } },
    );
    expect(view.annotation.modeEnabled).toBe(true);
    expect(view.annotation.selectionToolsAnchor).not.toBeNull();
    expect(view.annotation.selectionToolsAnchor).toEqual(anchor);

    // The three states a caller must be able to tell apart: unarmed with nothing
    // selected, armed with nothing selected, armed with a selection. Collapsing
    // the mode into "is something selected" is exactly what this pass removed.
    const fresh = selectSatInteraction(createSatInteractionState(), ctx());
    expect(fresh.annotation.modeEnabled).toBe(false);
    expect(fresh.annotation.selectionToolsAnchor).toBeNull();
    const armedOnly = selectSatInteraction(
      { ...createSatInteractionState(), annotation: { modeEnabled: true, selectionToolsAnchor: null } },
      { ...ctx(), toolPolicy: { ...ctx().toolPolicy, highlight: true, underline: true, notes: true } },
    );
    expect(armedOnly.annotation.modeEnabled).toBe(true);
    expect(armedOnly.annotation.selectionToolsAnchor).toBeNull();
  });
});
