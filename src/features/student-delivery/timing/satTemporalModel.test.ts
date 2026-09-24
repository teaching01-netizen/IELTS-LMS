import { expect, it } from 'vitest';
import type { AssessmentDeliveryBootstrap, AssessmentTimingSnapshot } from '../contracts/assessmentDelivery';
import { deriveSatTemporalSnapshot, type SatTemporalModel } from './satTemporalModel';

it('uses the accepted server clock pair for an attempt-owned break', () => {
  const oldReceipt = Date.parse('2026-09-24T08:00:00.000Z');
  const newReceipt = oldReceipt + 10_000;
  const startsAt = new Date(newReceipt).toISOString();
  const serverNow = startsAt;
  const timing = {
    authority: 'cohort_runtime', timingModel: 'sat_personal_v1',
    stageKey: null, stageStatus: 'live', serverNow, deadlineAt: null,
    remainingSeconds: 0, runtimeRevision: 1,
  } as AssessmentTimingSnapshot;
  const data = {
    scheduleRuntimeStatus: 'live', timing,
    attempt: {
      id: 'attempt', personalBreaks: [{
        id: 'break', state: 'active', startsAt,
        deadlineAt: new Date(newReceipt + 120_000).toISOString(),
        pausedAt: null, remainingSeconds: 120,
      }],
    },
  } as AssessmentDeliveryBootstrap;
  const model: SatTemporalModel = {
    data, effectiveTiming: timing,
    snapshotReceivedAt: oldReceipt,
    effectiveTimingReceivedAt: newReceipt,
    stateModuleAttempt: undefined, stateSectionKey: null,
    pendingAttempt: undefined, pendingSectionKey: null,
  };

  expect(deriveSatTemporalSnapshot(model, newReceipt).pendingBreakSeconds).toBe(120);
});
