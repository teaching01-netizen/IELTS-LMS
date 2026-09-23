import { describe, expect, it } from 'vitest';
import type { AssessmentModuleAttemptSnapshot, AssessmentTimingSnapshot } from '../contracts/assessmentDelivery';
import { mergeAuthoritativeTiming, personalModuleRemainingSeconds, snapshotRemainingSeconds } from './satTiming';

const attempt: AssessmentModuleAttemptSnapshot = {
  id: 'attempt', moduleId: 'module', state: 'not_started', allocatedSeconds: 1800,
  availableAt: null, startedAt: null, pausedAt: null, accumulatedPausedSeconds: 0,
  extensionSeconds: 0, deadlineAt: null, remainingSeconds: null, completionReason: null,
  rawCorrect: null, operationalQuestionCount: null, toolState: {}, revision: 0,
};

describe('SAT timing wire contracts', () => {
  it('handles the null remaining time sent before a module starts', () => {
    expect(snapshotRemainingSeconds(attempt, 0, 1000)).toBe(0);
  });

  it('keeps paused snapshots frozen and advances active snapshots', () => {
    const started = { ...attempt, startedAt: '2026-09-06T00:00:00Z', remainingSeconds: 90 };
    expect(snapshotRemainingSeconds(started, 1000, 6000)).toBe(85);
    expect(snapshotRemainingSeconds({ ...started, pausedAt: started.startedAt }, 1000, 6000)).toBe(90);
  });

  it('ticks the personal countdown from the server deadline between bootstraps', () => {
    const startedAt = '2026-09-10T08:00:00.000Z';
    const started = {
      ...attempt,
      startedAt,
      remainingSeconds: 60,
      deadlineAt: '2026-09-10T08:01:00.000Z',
    };
    // 10s later with zero clock skew: 50s left — no bootstrap involved.
    expect(personalModuleRemainingSeconds(started, Date.parse(startedAt), Date.parse(startedAt) + 10_000, 0)).toBe(50);
    // Positive skew (server ahead) shortens the display; negative lengthens it.
    expect(personalModuleRemainingSeconds(started, Date.parse(startedAt), Date.parse(startedAt) + 10_000, 5_000)).toBe(45);
    // Paused modules never tick, even with a deadline present.
    expect(personalModuleRemainingSeconds({ ...started, pausedAt: startedAt }, Date.parse(startedAt), Date.parse(startedAt) + 10_000, 0)).toBe(60);
    // No deadline falls back to snapshot math.
    const noDeadline = { ...started, deadlineAt: null };
    expect(personalModuleRemainingSeconds(noDeadline, 1000, 11_000, 0)).toBe(50);
    // Expired deadlines clamp at zero instead of going negative.
    expect(personalModuleRemainingSeconds(started, Date.parse(startedAt), Date.parse(startedAt) + 120_000, 0)).toBe(0);
  });

  it('freezes the personal countdown while the cohort stage is paused', () => {
    // The authoritative section clock stops when the stage leaves live;
    // personal must freeze with it or min() reaches zero during a pause.
    const startedAt = '2026-09-10T08:00:00.000Z';
    const started = {
      ...attempt,
      startedAt,
      remainingSeconds: 60,
      deadlineAt: '2026-09-10T08:01:00.000Z',
    };
    const t0 = Date.parse(startedAt);
    expect(personalModuleRemainingSeconds(started, t0, t0 + 10_000, 0, true)).toBe(50);
    expect(personalModuleRemainingSeconds(started, t0, t0 + 10_000, 0, false)).toBe(60);
    expect(personalModuleRemainingSeconds(started, t0, t0 + 10_000, 0)).toBe(50);
  });

  it('rejects an older cohort runtime revision', () => {
    const current: AssessmentTimingSnapshot = {
      authority: 'cohort_runtime', timingModel: 'cohort_section_v3', stageKey: 'math',
      stageStatus: 'live', serverNow: '2026-09-06T00:00:00Z', deadlineAt: null,
      remainingSeconds: 600, runtimeRevision: 7,
    };
    expect(mergeAuthoritativeTiming(current, { ...current, runtimeRevision: 6, stageKey: 'reading-writing' })).toBe(current);
  });
});
