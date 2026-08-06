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
      ({ phase }: { phase: 'exam' | 'lobby' }) =>
        useStudentWarningVisibility({
          effectivePhase: phase,
          violations: [violation({ id: 'tab-1', type: 'TAB_SWITCH', severity: 'critical' })],
          security: {
            tabSwitchRule: 'warn',
            detectSecondaryScreen: false,
            antiScreenshotGuardEnabled: false,
            preventTranslation: false,
          },
        }),
      { initialProps: { phase: 'exam' } },
    );

    expect(result.current.shouldShowTabSwitchWarning).toBe(true);
    expect(result.current.tabSwitchSeverity).toBe('critical');

    act(() => {
      result.current.acknowledgeTabSwitch();
    });
    expect(result.current.shouldShowTabSwitchWarning).toBe(false);

    rerender({ phase: 'lobby' });
    expect(result.current.shouldShowTabSwitchWarning).toBe(false);
  });

  it('applies per-signal config gates for screenshot, translation, and secondary screen', () => {
    const { result } = renderHook(() =>
      useStudentWarningVisibility({
        effectivePhase: 'exam',
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

  it('shows each warning type once per violation id: duplicates and older ids never reopen after acknowledgement (FEX-061)', () => {
    const { result, rerender } = renderHook(
      ({ violations }: { violations: Violation[] }) =>
        useStudentWarningVisibility({
          effectivePhase: 'exam',
          violations,
          security: {
            tabSwitchRule: 'warn',
            detectSecondaryScreen: false,
            antiScreenshotGuardEnabled: false,
            preventTranslation: false,
          },
        }),
      {
        initialProps: {
          violations: [
            violation({ id: 'tab-1', type: 'TAB_SWITCH' }),
            violation({ id: 'tab-2', type: 'TAB_SWITCH' }),
          ],
        },
      },
    );

    // Only the latest violation of the type drives the warning.
    expect(result.current.latestTabSwitchViolation?.id).toBe('tab-2');
    expect(result.current.shouldShowTabSwitchWarning).toBe(true);

    act(() => {
      result.current.acknowledgeTabSwitch();
    });
    expect(result.current.shouldShowTabSwitchWarning).toBe(false);

    // Duplicate live update: the same violations re-delivered stay closed.
    rerender({
      violations: [
        violation({ id: 'tab-1', type: 'TAB_SWITCH' }),
        violation({ id: 'tab-2', type: 'TAB_SWITCH' }),
      ],
    });
    expect(result.current.shouldShowTabSwitchWarning).toBe(false);

    // A new violation id reopens the warning.
    rerender({
      violations: [
        violation({ id: 'tab-1', type: 'TAB_SWITCH' }),
        violation({ id: 'tab-2', type: 'TAB_SWITCH' }),
        violation({ id: 'tab-3', type: 'TAB_SWITCH' }),
      ],
    });
    expect(result.current.latestTabSwitchViolation?.id).toBe('tab-3');
    expect(result.current.shouldShowTabSwitchWarning).toBe(true);

    act(() => {
      result.current.acknowledgeTabSwitch();
    });
    expect(result.current.shouldShowTabSwitchWarning).toBe(false);

    // Re-delivering the full history (including the acknowledged latest id)
    // never reopens the warning: older ids never re-trigger.
    rerender({
      violations: [
        violation({ id: 'tab-1', type: 'TAB_SWITCH' }),
        violation({ id: 'tab-2', type: 'TAB_SWITCH' }),
        violation({ id: 'tab-3', type: 'TAB_SWITCH' }),
      ],
    });
    expect(result.current.shouldShowTabSwitchWarning).toBe(false);

    // The same holds when the acknowledged id remains the latest.
    rerender({
      violations: [
        violation({ id: 'tab-2', type: 'TAB_SWITCH' }),
        violation({ id: 'tab-3', type: 'TAB_SWITCH' }),
      ],
    });
    expect(result.current.shouldShowTabSwitchWarning).toBe(false);
  });

  it('keeps acknowledgements isolated per warning type (FEX-061)', () => {
    const { result, rerender } = renderHook(
      ({ violations }: { violations: Violation[] }) =>
        useStudentWarningVisibility({
          effectivePhase: 'exam',
          violations,
          security: {
            tabSwitchRule: 'warn',
            detectSecondaryScreen: false,
            antiScreenshotGuardEnabled: true,
            preventTranslation: false,
          },
        }),
      {
        initialProps: {
          violations: [
            violation({ id: 'shot-1', type: 'SCREENSHOT_ATTEMPT' }),
            violation({ id: 'tab-1', type: 'TAB_SWITCH' }),
          ],
        },
      },
    );

    expect(result.current.shouldShowScreenshotWarning).toBe(true);
    expect(result.current.shouldShowTabSwitchWarning).toBe(true);

    // Acknowledging the screenshot must not acknowledge the tab-switch type.
    act(() => {
      result.current.acknowledgeScreenshot();
    });
    expect(result.current.shouldShowScreenshotWarning).toBe(false);
    expect(result.current.shouldShowTabSwitchWarning).toBe(true);

    // Duplicate screenshot re-delivery stays closed; a NEW screenshot id
    // reopens only the screenshot warning.
    rerender({
      violations: [
        violation({ id: 'shot-1', type: 'SCREENSHOT_ATTEMPT' }),
        violation({ id: 'shot-2', type: 'SCREENSHOT_ATTEMPT' }),
        violation({ id: 'tab-1', type: 'TAB_SWITCH' }),
      ],
    });
    expect(result.current.latestScreenshotViolation?.id).toBe('shot-2');
    expect(result.current.shouldShowScreenshotWarning).toBe(true);
    expect(result.current.shouldShowTabSwitchWarning).toBe(true);

    act(() => {
      result.current.acknowledgeScreenshot();
    });
    expect(result.current.shouldShowScreenshotWarning).toBe(false);
    // The tab-switch warning is untouched by the screenshot acknowledgement.
    expect(result.current.shouldShowTabSwitchWarning).toBe(true);

    act(() => {
      result.current.acknowledgeTabSwitch();
    });
    expect(result.current.shouldShowTabSwitchWarning).toBe(false);
    expect(result.current.shouldShowScreenshotWarning).toBe(false);
  });
});
