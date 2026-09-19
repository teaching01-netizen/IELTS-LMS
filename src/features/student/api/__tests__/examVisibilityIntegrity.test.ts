import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  StudentPlatformEvent,
  StudentPlatformMonitor,
} from '../../contracts/exam-session/StudentPlatformMonitor';
import {
  createExamVisibilityIntegrityState,
  reduceExamVisibilityIntegrity,
  type ExamVisibilityExcursion,
} from '../../application/exam-session/examVisibilityIntegrity';
import { useExamVisibilityIntegrity } from '../useExamVisibilityIntegrity';

/**
 * Executable acceptance specification (ATDD) — "Exam screen integrity".
 *
 * Product rule: ONE detection rule for every provider (IELTS, ACT, SAT).
 *
 *   Student answering exam
 *     -> exam document becomes hidden (tab/app switch, device lock)
 *     -> student returns
 *     -> EXACTLY ONE TAB_SWITCH violation with hiddenDurationMs
 *
 * Scenario IDs map 1:1 to the acceptance criteria:
 *   AC-VIS-01 one visible -> hidden -> visible excursion = exactly one violation
 *   AC-VIS-02 duplicate lifecycle noise (hidden/hidden) is not a second violation
 *   AC-VIS-03 two excursions = two violations
 *   AC-VIS-04 staying visible is never a violation
 *   AC-VIS-05 a disabled rule (tabSwitchRule: 'none') never violates
 *   AC-VIS-06 leaving while the exam is not active (waiting room, break,
 *             directions, completed) never violates
 *   AC-VIS-07 a long background suspension still warns on return (no timers)
 *   AC-VIS-08 the excursion reports the whole away window, not a fixed delay
 *   AC-VIS-09 a mount that starts hidden is a baseline, not a violation
 */

const HIDDEN_AT = '2026-01-01T00:00:10.000Z';
const RETURN_EARLY = '2026-01-01T00:00:11.000Z';
const RETURN_LATE = '2026-01-01T00:00:40.000Z';

function createFakeMonitor() {
  const listeners = new Set<(event: StudentPlatformEvent) => void>();
  const monitor: StudentPlatformMonitor = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const emit = (event: StudentPlatformEvent) => {
    for (const listener of [...listeners]) listener(event);
  };
  return {
    monitor,
    listenerCount: () => listeners.size,
    hidden: (timestamp: string = HIDDEN_AT) =>
      emit({ type: 'VISIBILITY_HIDDEN', timestamp }),
    visible: (timestamp: string = RETURN_EARLY) =>
      emit({ type: 'VISIBILITY_VISIBLE', timestamp }),
    noise: (event: StudentPlatformEvent) => emit(event),
  };
}

function renderIntegrity(overrides: {
  active?: boolean;
  enabled?: boolean;
  monitor: StudentPlatformMonitor;
}) {
  const onViolation = vi.fn<(excursion: ExamVisibilityExcursion) => void>();
  const harness = renderHook(
    ({ active, enabled }: { active: boolean; enabled: boolean }) =>
      useExamVisibilityIntegrity({
        active,
        enabled,
        monitor: overrides.monitor,
        onViolation,
      }),
    {
      initialProps: {
        active: overrides.active ?? true,
        enabled: overrides.enabled ?? true,
      },
    },
  );
  return { ...harness, onViolation };
}

describe('exam visibility integrity rule (pure)', () => {
  it('AC-VIS-01/08: visible -> hidden -> visible is exactly one excursion', () => {
    const hidden = reduceExamVisibilityIntegrity(
      createExamVisibilityIntegrityState('visible'),
      { visible: false, atEpochMs: Date.parse(HIDDEN_AT) },
    );

    expect(hidden.excursion).toBeNull();
    expect(hidden.state).toEqual({
      visibility: 'hidden',
      hiddenAtEpochMs: Date.parse(HIDDEN_AT),
    });

    const returned = reduceExamVisibilityIntegrity(hidden.state, {
      visible: true,
      atEpochMs: Date.parse(RETURN_EARLY),
    });

    expect(returned.excursion).toEqual({
      violationType: 'TAB_SWITCH',
      source: 'page_visibility',
      hiddenAt: HIDDEN_AT,
      returnedAt: RETURN_EARLY,
      hiddenDurationMs: 1_000,
    });
  });

  it('AC-VIS-02: duplicate hidden events do not arm twice', () => {
    const first = reduceExamVisibilityIntegrity(
      createExamVisibilityIntegrityState('visible'),
      { visible: false, atEpochMs: Date.parse(HIDDEN_AT) },
    );
    const duplicate = reduceExamVisibilityIntegrity(first.state, {
      visible: false,
      atEpochMs: Date.parse(RETURN_EARLY),
    });

    expect(duplicate.state).toEqual(first.state);
    expect(duplicate.excursion).toBeNull();
  });

  it('AC-VIS-03: two excursions produce two excursions', () => {
    const first = reduceExamVisibilityIntegrity(
      createExamVisibilityIntegrityState('visible'),
      { visible: false, atEpochMs: Date.parse(HIDDEN_AT) },
    );
    const second = reduceExamVisibilityIntegrity(first.state, {
      visible: true,
      atEpochMs: Date.parse(RETURN_EARLY),
    });
    const third = reduceExamVisibilityIntegrity(second.state, {
      visible: false,
      atEpochMs: Date.parse(RETURN_LATE),
    });
    const fourth = reduceExamVisibilityIntegrity(third.state, {
      visible: true,
      atEpochMs: Date.parse(RETURN_LATE) + 5_000,
    });

    expect([second.excursion !== null, fourth.excursion !== null]).toEqual([true, true]);
    expect(fourth.excursion?.hiddenDurationMs).toBe(5_000);
  });

  it('AC-VIS-04: staying visible is never an excursion', () => {
    const result = reduceExamVisibilityIntegrity(
      createExamVisibilityIntegrityState('visible'),
      { visible: true, atEpochMs: Date.parse(HIDDEN_AT) },
    );

    expect(result.excursion).toBeNull();
  });

  it('AC-VIS-09: returning from a hide that started before the exam is not an excursion', () => {
    const startingHidden = createExamVisibilityIntegrityState('hidden');
    const returned = reduceExamVisibilityIntegrity(startingHidden, {
      visible: true,
      atEpochMs: Date.parse(RETURN_EARLY),
    });

    expect(returned.excursion).toBeNull();
    expect(returned.state.visibility).toBe('visible');
  });
});

describe('useExamVisibilityIntegrity (provider-neutral seam)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AC-VIS-01: reports exactly one violation per excursion and survives a long suspension', () => {
    const fake = createFakeMonitor();
    const { onViolation } = renderIntegrity({ monitor: fake.monitor });

    act(() => {
      fake.hidden(HIDDEN_AT);
    });
    // iOS may suspend the page for seconds or minutes; nothing may depend on a
    // timer executing while hidden.
    expect(onViolation).not.toHaveBeenCalled();

    act(() => {
      fake.visible(RETURN_LATE);
    });

    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation.mock.calls[0]?.[0]).toEqual({
      violationType: 'TAB_SWITCH',
      source: 'page_visibility',
      hiddenAt: HIDDEN_AT,
      returnedAt: RETURN_LATE,
      hiddenDurationMs: 30_000,
    });
  });

  it('AC-VIS-02: lifecycle noise (blur/pagehide/blur-hidden duplicates) adds no violation', () => {
    const fake = createFakeMonitor();
    const { onViolation } = renderIntegrity({ monitor: fake.monitor });

    act(() => {
      fake.hidden(HIDDEN_AT);
      fake.hidden(RETURN_EARLY);
      fake.noise({ type: 'NETWORK_ONLINE', timestamp: RETURN_EARLY });
      fake.visible(RETURN_EARLY);
      fake.visible(RETURN_EARLY);
    });

    expect(onViolation).toHaveBeenCalledTimes(1);
  });

  it('AC-VIS-03: a second excursion produces a second violation', () => {
    const fake = createFakeMonitor();
    const { onViolation } = renderIntegrity({ monitor: fake.monitor });

    act(() => {
      fake.hidden(HIDDEN_AT);
      fake.visible(RETURN_EARLY);
      fake.hidden(RETURN_LATE);
      fake.visible(new Date(Date.parse(RETURN_LATE) + 2_000).toISOString());
    });

    expect(onViolation).toHaveBeenCalledTimes(2);
  });

  it('AC-VIS-04: a visible-only exam never violates', () => {
    const fake = createFakeMonitor();
    const { onViolation } = renderIntegrity({ monitor: fake.monitor });

    act(() => {
      fake.visible();
      fake.visible();
    });

    expect(onViolation).not.toHaveBeenCalled();
  });

  it("AC-VIS-05: tabSwitchRule 'none' (disabled) never violates", () => {
    const fake = createFakeMonitor();
    const { onViolation } = renderIntegrity({ enabled: false, monitor: fake.monitor });

    act(() => {
      fake.hidden(HIDDEN_AT);
      fake.visible(RETURN_LATE);
    });

    expect(onViolation).not.toHaveBeenCalled();
  });

  it('AC-VIS-06: leaving while the exam is not active never violates', () => {
    const fake = createFakeMonitor();
    const { onViolation, rerender } = renderIntegrity({
      active: false,
      monitor: fake.monitor,
    });

    act(() => {
      fake.hidden(HIDDEN_AT);
    });
    // Still away when the exam starts: the hide belongs to the waiting room.
    act(() => {
      rerender({ active: true, enabled: true });
      fake.visible(RETURN_LATE);
    });
    expect(onViolation).not.toHaveBeenCalled();

    // ...and once active, a real excursion is still detected.
    act(() => {
      fake.hidden(RETURN_LATE);
      fake.visible(new Date(Date.parse(RETURN_LATE) + 3_000).toISOString());
    });
    expect(onViolation).toHaveBeenCalledTimes(1);
  });

  it('keeps a violation that started during the exam even if the phase changed before the return', () => {
    const fake = createFakeMonitor();
    const { onViolation, rerender } = renderIntegrity({ monitor: fake.monitor });

    act(() => {
      fake.hidden(HIDDEN_AT);
    });
    // The module ended while the student was away (auto-submit / break start):
    // the leave still happened during the exam.
    act(() => {
      rerender({ active: false, enabled: true });
      fake.visible(RETURN_LATE);
    });

    expect(onViolation).toHaveBeenCalledTimes(1);
  });

  it('AC-VIS-09: a session that mounts hidden is not charged for the first return', () => {
    const fake = createFakeMonitor();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

    const { onViolation } = renderIntegrity({ monitor: fake.monitor });
    act(() => {
      fake.visible(RETURN_EARLY);
    });

    expect(onViolation).not.toHaveBeenCalled();
  });

  it('unsubscribes from the monitor on unmount', () => {
    const fake = createFakeMonitor();
    const { unmount } = renderIntegrity({ monitor: fake.monitor });

    expect(fake.listenerCount()).toBe(1);
    unmount();
    expect(fake.listenerCount()).toBe(0);
  });

  it('uses the latest onViolation callback without re-subscribing', () => {
    const fake = createFakeMonitor();
    const first = vi.fn();
    const { rerender } = renderHook(
      ({ handler }: { handler: (excursion: ExamVisibilityExcursion) => void }) =>
        useExamVisibilityIntegrity({
          active: true,
          enabled: true,
          monitor: fake.monitor,
          onViolation: handler,
        }),
      { initialProps: { handler: first } },
    );

    const second = vi.fn();
    rerender({ handler: second });

    act(() => {
      fake.hidden(HIDDEN_AT);
      fake.visible(RETURN_EARLY);
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(fake.listenerCount()).toBe(1);
  });
});
