import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Violation } from '../../../types';
import { useStudentFullscreenWarning } from '../useStudentFullscreenWarning';

function violation(partial: Partial<Violation>): Violation {
  return {
    id: partial.id ?? 'full-1',
    type: partial.type ?? 'FULLSCREEN_EXIT',
    severity: partial.severity ?? 'high',
    timestamp: partial.timestamp ?? '2026-01-01T00:00:00.000Z',
    description: partial.description ?? 'Return to fullscreen now.',
  };
}

describe('useStudentFullscreenWarning', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens warning after grace delay when fullscreen exit occurs during exam', () => {
    const fullscreenState = { current: false };

    const { result } = renderHook(() =>
      useStudentFullscreenWarning({
        effectivePhase: 'exam',
        showWarnings: true,
        requireFullscreen: true,
        violations: [violation({ severity: 'critical', description: 'Critical fullscreen breach.' })],
        getFullscreenElementFn: () => (fullscreenState.current ? ({} as Element) : null),
      }),
    );

    expect(result.current.fullscreenWarningOpen).toBe(false);

    act(() => {
      vi.advanceTimersByTime(210);
    });

    expect(result.current.fullscreenWarningOpen).toBe(true);
    expect(result.current.fullscreenWarningSeverity).toBe('critical');
    expect(result.current.fullscreenWarningMessage).toBe('Critical fullscreen breach.');
  });

  it('does not open warning outside gated conditions', () => {
    const { result } = renderHook(() =>
      useStudentFullscreenWarning({
        effectivePhase: 'lobby',
        showWarnings: true,
        requireFullscreen: true,
        violations: [violation({})],
        getFullscreenElementFn: () => null,
      }),
    );

    act(() => {
      vi.runAllTimers();
    });

    expect(result.current.fullscreenWarningOpen).toBe(false);
  });

  it('closes warning when fullscreen returns', () => {
    const fullscreenState = { current: false };

    const { result } = renderHook(() =>
      useStudentFullscreenWarning({
        effectivePhase: 'exam',
        showWarnings: true,
        requireFullscreen: true,
        violations: [violation({})],
        getFullscreenElementFn: () => (fullscreenState.current ? ({} as Element) : null),
      }),
    );

    act(() => {
      vi.advanceTimersByTime(210);
    });
    expect(result.current.fullscreenWarningOpen).toBe(true);

    act(() => {
      fullscreenState.current = true;
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    expect(result.current.fullscreenWarningOpen).toBe(false);
  });
});
