import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Violation } from '../../../types';
import { useStudentWarningVisibility } from '../useStudentWarningVisibility';

function violation(partial: Partial<Violation>): Violation {
  return {
    id: partial.id ?? 'v-1',
    type: partial.type ?? 'TAB_SWITCH',
    severity: partial.severity ?? 'low',
    timestamp: partial.timestamp ?? '2026-01-01T00:00:00.000Z',
    description: partial.description ?? 'warning',
  };
}

describe('useStudentWarningVisibility', () => {
  it('shows tab-switch warning only in exam phase when rule is warn and not acknowledged', () => {
    const { result, rerender } = renderHook(
      ({ phase, fullscreenOpen }: { phase: 'exam' | 'lobby'; fullscreenOpen: boolean }) =>
        useStudentWarningVisibility({
          effectivePhase: phase,
          fullscreenWarningOpen: fullscreenOpen,
          violations: [violation({ id: 'tab-1', type: 'TAB_SWITCH', severity: 'critical' })],
          security: {
            tabSwitchRule: 'warn',
            detectSecondaryScreen: false,
            antiScreenshotGuardEnabled: false,
            preventTranslation: false,
          },
        }),
      { initialProps: { phase: 'exam', fullscreenOpen: false } },
    );

    expect(result.current.shouldShowTabSwitchWarning).toBe(true);
    expect(result.current.tabSwitchSeverity).toBe('critical');

    act(() => {
      result.current.acknowledgeTabSwitch();
    });
    expect(result.current.shouldShowTabSwitchWarning).toBe(false);

    rerender({ phase: 'lobby', fullscreenOpen: false });
    expect(result.current.shouldShowTabSwitchWarning).toBe(false);
  });

  it('hides tab-switch warning while fullscreen warning is active', () => {
    const { result } = renderHook(() =>
      useStudentWarningVisibility({
        effectivePhase: 'exam',
        fullscreenWarningOpen: true,
        violations: [violation({ id: 'tab-1', type: 'TAB_SWITCH' })],
        security: {
          tabSwitchRule: 'warn',
          detectSecondaryScreen: false,
          antiScreenshotGuardEnabled: false,
          preventTranslation: false,
        },
      }),
    );

    expect(result.current.shouldShowTabSwitchWarning).toBe(false);
  });

  it('applies per-signal config gates for screenshot, translation, and secondary screen', () => {
    const { result } = renderHook(() =>
      useStudentWarningVisibility({
        effectivePhase: 'exam',
        fullscreenWarningOpen: false,
        violations: [
          violation({ id: 'screenshot-1', type: 'SCREENSHOT_ATTEMPT' }),
          violation({ id: 'translation-1', type: 'TRANSLATION_DETECTED' }),
          violation({ id: 'screen-1', type: 'SECONDARY_SCREEN' }),
        ],
        security: {
          tabSwitchRule: 'warn',
          detectSecondaryScreen: true,
          antiScreenshotGuardEnabled: true,
          preventTranslation: true,
        },
      }),
    );

    expect(result.current.shouldShowScreenshotWarning).toBe(true);
    expect(result.current.shouldShowTranslationWarning).toBe(true);
    expect(result.current.shouldShowSecondaryScreenWarning).toBe(true);

    act(() => {
      result.current.acknowledgeScreenshot();
      result.current.acknowledgeTranslation();
      result.current.acknowledgeSecondaryScreen();
    });

    expect(result.current.shouldShowScreenshotWarning).toBe(false);
    expect(result.current.shouldShowTranslationWarning).toBe(false);
    expect(result.current.shouldShowSecondaryScreenWarning).toBe(false);
  });
});
