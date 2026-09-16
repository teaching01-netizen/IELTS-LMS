import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { resolveSatExamToolPolicy } from '../../domain/satToolPolicy';
import type { SatInteractionContext } from '../../domain/satInteractionState';
import { useSatInteractionController } from '../useSatInteractionController';

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

describe('useSatInteractionController (only public mutation surface)', () => {
  it('opens/closes the navigator and exposes dumb-view flags', () => {
    const { result } = renderHook(({ ctx }: { ctx: SatInteractionContext }) => useSatInteractionController(ctx), {
      initialProps: { ctx: mathCtx() },
    });
    expect(result.current.is.navigatorOpen).toBe(false);
    expect(result.current.can.openNavigator).toBe(true);
    act(() => result.current.openNavigator());
    expect(result.current.is.navigatorOpen).toBe(true);
    act(() => result.current.closeSurface());
    expect(result.current.is.navigatorOpen).toBe(false);
  });

  // Tool buttons dispatch runner commands directly (activeTools is the
  // single tool truth): the controller toggle is a refused no-op that leaves
  // all interaction state untouched.
  it('refuses the calculator toggle while refusing annotation without R&W capability', () => {
    const { result } = renderHook(({ ctx }: { ctx: SatInteractionContext }) => useSatInteractionController(ctx), {
      initialProps: { ctx: mathCtx() },
    });
    const before = result.current.state;
    act(() => result.current.toggleCalculator());
    expect(result.current.state).toBe(before);
    expect(result.current.can.annotate).toBe(false);
    // Selection-first: a Math selection is refused by the same capability.
    act(() => result.current.selectionCaptured({ nodeId: 'stimulus:p1', startOffset: 0, endOffset: 4, exact: 'tree' }));
    expect(result.current.state.annotation.selection).toBeNull();
  });

  it('captures a selection in R&W with no armed mode and clears it on demand', () => {
    const anchor = { nodeId: 'stimulus:p1', startOffset: 0, endOffset: 4, exact: 'tree' };
    const { result } = renderHook(({ ctx }: { ctx: SatInteractionContext }) => useSatInteractionController(ctx), {
      initialProps: { ctx: { ...mathCtx(), toolPolicy: resolveSatExamToolPolicy('reading-writing', []), sectionKey: 'reading-writing' } },
    });
    expect(result.current.is.annotationEditorOpen).toBe(false);
    act(() => result.current.selectionCaptured(anchor));
    expect(result.current.state.annotation.selection).toEqual(anchor);
    expect(result.current.view.annotation.hasSelection).toBe(true);
    act(() => result.current.selectionCleared());
    expect(result.current.state.annotation.selection).toBeNull();
  });

  it('clears transient UI on scope change and discards all on termination', () => {
    const { result, rerender } = renderHook(
      ({ ctx }: { ctx: SatInteractionContext }) => useSatInteractionController(ctx),
      { initialProps: { ctx: mathCtx() } },
    );
    act(() => result.current.openNavigator());
    expect(result.current.is.navigatorOpen).toBe(true);
    rerender({ ctx: { ...mathCtx(), questionId: 'q2' } });
    expect(result.current.is.navigatorOpen).toBe(false);
    rerender({ ctx: { ...mathCtx(), questionId: 'q2', terminated: true } });
    expect(result.current.is.terminal).toBe(true);
    expect(result.current.can.answer).toBe(false);
  });

  it('normalizes a revoked selection away when the module policy changes', () => {
    const { result, rerender } = renderHook(
      ({ ctx }: { ctx: SatInteractionContext }) => useSatInteractionController(ctx),
      { initialProps: { ctx: { ...mathCtx(), toolPolicy: resolveSatExamToolPolicy('reading-writing', []), sectionKey: 'reading-writing' } } },
    );
    act(() => result.current.selectionCaptured({ nodeId: 'stimulus:p1', startOffset: 0, endOffset: 4, exact: 'tree' }));
    expect(result.current.state.annotation.selection).not.toBeNull();
    rerender({
      ctx: {
        ...mathCtx(),
        toolPolicy: resolveSatExamToolPolicy('math', ['calculator']),
        sectionKey: 'math',
        moduleKey: 'math-m1',
      },
    });
    expect(result.current.state.annotation.selection).toBeNull();
  });

  it('arbitrates Escape to exactly one action: surface, then selection', () => {
    const { result } = renderHook(({ ctx }: { ctx: SatInteractionContext }) => useSatInteractionController(ctx), {
      initialProps: {
        ctx: {
          ...mathCtx(),
          toolPolicy: {
            ...resolveSatExamToolPolicy('reading-writing', []),
            calculator: true,
            referenceSheet: true,
          },
          sectionKey: 'reading-writing',
        },
      },
    });
    const anchor = { nodeId: 'stimulus:p1', startOffset: 0, endOffset: 4, exact: 'tree' };
    act(() => result.current.selectionCaptured(anchor));
    expect(result.current.state.annotation.selection).toEqual(anchor);
    let acted = false;
    // 1) The selection is the innermost annotation state: Escape clears it.
    act(() => {
      acted = result.current.handleEscape();
    });
    expect(acted).toBe(true);
    expect(result.current.state.annotation.selection).toBeNull();
    // 2) Nothing left to clear.
    act(() => {
      acted = result.current.handleEscape();
    });
    expect(acted).toBe(false);
    // 3) Opening a surface drops the selection (one live annotation target),
    //    and the surface itself is the next thing Escape closes.
    act(() => result.current.selectionCaptured(anchor));
    act(() => result.current.openNavigator());
    expect(result.current.is.navigatorOpen).toBe(true);
    expect(result.current.state.annotation.selection).toBeNull();
    act(() => {
      acted = result.current.handleEscape();
    });
    expect(acted).toBe(true);
    expect(result.current.is.navigatorOpen).toBe(false);
  });
});
