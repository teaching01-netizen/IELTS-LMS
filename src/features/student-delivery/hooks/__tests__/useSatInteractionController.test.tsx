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
    act(() => result.current.setAnnotationMode('highlight'));
    expect(result.current.state.annotation.mode).toBe('off');
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

  it('normalizes revoked annotation modes when the module policy changes', () => {
    const { result, rerender } = renderHook(
      ({ ctx }: { ctx: SatInteractionContext }) => useSatInteractionController(ctx),
      { initialProps: { ctx: mathCtx() } },
    );
    rerender({
      ctx: {
        ...mathCtx(),
        toolPolicy: resolveSatExamToolPolicy('reading-writing', []),
        sectionKey: 'reading-writing',
        moduleKey: 'rw-m1',
      },
    });
    expect(result.current.state.annotation.mode).toBe('off');
  });

  it('arbitrates Escape to exactly one action: surface before mode', () => {
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
    act(() => result.current.setAnnotationMode('highlight'));
    expect(result.current.state.annotation.mode).toBe('highlight');
    act(() => result.current.openNavigator());
    expect(result.current.is.navigatorOpen).toBe(true);
    let acted = false;
    act(() => {
      acted = result.current.handleEscape();
    });
    expect(acted).toBe(true);
    expect(result.current.is.navigatorOpen).toBe(false);
    // Annotation mode persists through navigator Escape (conflict matrix).
    expect(result.current.state.annotation.mode).toBe('highlight');
    act(() => {
      acted = result.current.handleEscape();
    });
    expect(acted).toBe(true);
    expect(result.current.state.annotation.mode).toBe('off');
  });
});
