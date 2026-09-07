import { describe, expect, it } from 'vitest';
import type { AssessmentModuleAttemptSnapshot, AssessmentTimingSnapshot } from '../contracts/assessmentDelivery';
import { mergeAuthoritativeTiming, snapshotRemainingSeconds } from './satTiming';

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

  it('rejects an older cohort runtime revision', () => {
    const current: AssessmentTimingSnapshot = {
      authority: 'cohort_runtime', timingModel: 'cohort_section_v3', stageKey: 'math',
      stageStatus: 'live', serverNow: '2026-09-06T00:00:00Z', deadlineAt: null,
      remainingSeconds: 600, runtimeRevision: 7,
    };
    expect(mergeAuthoritativeTiming(current, { ...current, runtimeRevision: 6, stageKey: 'reading-writing' })).toBe(current);
  });
});
