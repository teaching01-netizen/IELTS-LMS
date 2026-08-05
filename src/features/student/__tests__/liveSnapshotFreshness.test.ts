import { describe, expect, it } from 'vitest';
import {
  buildRuntimeFingerprint,
  compareFreshnessDimension,
  isRuntimeValueUnchanged,
  mergeLiveSnapshotFreshness,
} from '../liveSnapshotFreshness';

describe('liveSnapshotFreshness', () => {
  it('treats higher revisions as fresher', () => {
    expect(
      compareFreshnessDimension(
        { revision: 2, updatedAtMs: 0 },
        { revision: 1, updatedAtMs: 999999 },
      ),
    ).toBe(1);
  });

  it('never lets a revisionless snapshot override a revisioned snapshot', () => {
    expect(
      compareFreshnessDimension(
        { revision: null, updatedAtMs: Date.parse('2026-01-01T00:00:10.000Z') },
        { revision: 5, updatedAtMs: Date.parse('2026-01-01T00:00:00.000Z') },
      ),
    ).toBe(-1);
  });

  it('falls back to updatedAtMs when both revisions are missing', () => {
    expect(
      compareFreshnessDimension(
        { revision: null, updatedAtMs: 200 },
        { revision: null, updatedAtMs: 100 },
      ),
    ).toBe(1);
  });

  it('merges per-dimension based on apply flags', () => {
    const prev = {
      attempt: { revision: 10, updatedAtMs: 10 },
      runtime: { revision: 20, updatedAtMs: 20 },
    };
    const incoming = {
      attempt: { revision: 11, updatedAtMs: 11 },
      runtime: { revision: 21, updatedAtMs: 21 },
    };

    expect(mergeLiveSnapshotFreshness(prev, incoming, { applyAttempt: false, applyRuntime: true })).toEqual({
      attempt: prev.attempt,
      runtime: incoming.runtime,
    });
  });
});

function buildRuntime(overrides: Record<string, unknown> = {}) {
  return {
    id: 'runtime-1',
    scheduleId: 'sched-1',
    examId: 'exam-1',
    examTitle: 'Exam',
    cohortName: 'Cohort A',
    deliveryMode: 'proctor_start',
    status: 'live',
    actualStartAt: '2026-01-01T00:00:00.000Z',
    actualEndAt: null,
    activeSectionKey: 'listening',
    currentSectionKey: 'listening',
    currentSectionRemainingSeconds: 120,
    currentSectionDeadlineAt: '2026-01-01T00:02:00.000Z',
    serverNow: '2026-01-01T00:00:00.000Z',
    waitingForNextSection: false,
    isOverrun: false,
    totalPausedSeconds: 0,
    revision: 7,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    sections: [
      {
        sectionKey: 'listening',
        label: 'Listening',
        order: 0,
        plannedDurationMinutes: 30,
        gapAfterMinutes: 0,
        status: 'live',
        availableAt: '2026-01-01T00:00:00.000Z',
        actualStartAt: '2026-01-01T00:00:00.000Z',
        actualEndAt: null,
        pausedAt: null,
        accumulatedPausedSeconds: 0,
        extensionMinutes: 0,
        completionReason: undefined,
        projectedStartAt: '2026-01-01T00:00:00.000Z',
        projectedEndAt: '2026-01-01T01:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

describe('buildRuntimeFingerprint', () => {
  it('treats equal values with different object identity as unchanged', () => {
    const first = buildRuntime();
    const second = buildRuntime();
    expect(first).not.toBe(second);
    expect(buildRuntimeFingerprint(first)).toBe(buildRuntimeFingerprint(second));
    expect(isRuntimeValueUnchanged(first, second)).toBe(true);
    expect(isRuntimeValueUnchanged(second, first)).toBe(true);
  });

  it('detects a timer-field change as changed', () => {
    const first = buildRuntime();
    const second = buildRuntime({ currentSectionRemainingSeconds: 119 });
    expect(isRuntimeValueUnchanged(first, second)).toBe(false);

    const changedDeadline = buildRuntime({ currentSectionDeadlineAt: '2026-01-01T00:02:30.000Z' });
    expect(isRuntimeValueUnchanged(first, changedDeadline)).toBe(false);

    const changedStatus = buildRuntime({ status: 'paused' });
    expect(isRuntimeValueUnchanged(first, changedStatus)).toBe(false);

    const changedSectionStatus = buildRuntime({
      sections: [
        {
          ...buildRuntime().sections[0],
          status: 'paused',
        },
      ],
    });
    expect(isRuntimeValueUnchanged(first, changedSectionStatus)).toBe(false);
  });

  it('ignores serverNow and updatedAt sampling metadata so equal-revision polls are deduped', () => {
    const first = buildRuntime();
    const samplingOnlyChange = buildRuntime({
      serverNow: '2026-01-01T00:00:01.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
    });
    expect(isRuntimeValueUnchanged(first, samplingOnlyChange)).toBe(true);

    // A real timer-field change is still detected at the same revision.
    const timerFieldChange = buildRuntime({ currentSectionRemainingSeconds: 119 });
    expect(isRuntimeValueUnchanged(first, timerFieldChange)).toBe(false);
  });

  it('ignores non-timer metadata changes', () => {
    const first = buildRuntime();
    const changedTotalPaused = buildRuntime({ totalPausedSeconds: 42 });
    expect(isRuntimeValueUnchanged(first, changedTotalPaused)).toBe(true);

    const changedLabel = buildRuntime({
      sections: [
        {
          ...buildRuntime().sections[0],
          label: 'Renamed Listening',
        },
      ],
    });
    expect(isRuntimeValueUnchanged(first, changedLabel)).toBe(true);

    const changedOrder = buildRuntime({
      sections: [
        {
          ...buildRuntime().sections[0],
          order: 3,
        },
      ],
    });
    expect(isRuntimeValueUnchanged(first, changedOrder)).toBe(true);

    const changedExtraMetadata = buildRuntime({ proctorPresence: [] });
    expect(isRuntimeValueUnchanged(first, changedExtraMetadata)).toBe(true);
  });

  it('treats non-record values as unchanged only when both are the same non-record', () => {
    expect(buildRuntimeFingerprint(null)).toBe(buildRuntimeFingerprint(undefined));
    expect(isRuntimeValueUnchanged(42, 42)).toBe(true);
    expect(isRuntimeValueUnchanged(null, null)).toBe(false);
    expect(isRuntimeValueUnchanged(null, undefined)).toBe(false);
    expect(isRuntimeValueUnchanged(undefined, undefined)).toBe(false);
    expect(isRuntimeValueUnchanged(null, buildRuntime())).toBe(false);
    expect(isRuntimeValueUnchanged(buildRuntime(), null)).toBe(false);
  });

  it('is deterministic regardless of field insertion order', () => {
    const first = buildRuntime();
    const second: Record<string, unknown> = {};
    const shuffled = [
      'currentSectionRemainingSeconds',
      'serverNow',
      'currentSectionDeadlineAt',
      'revision',
      'sections',
      'updatedAt',
      'waitingForNextSection',
      'status',
      'currentSectionKey',
    ];
    for (const key of shuffled) {
      second[key] = (first as Record<string, unknown>)[key];
    }
    expect(buildRuntimeFingerprint(first)).toBe(buildRuntimeFingerprint(second));
  });
});

