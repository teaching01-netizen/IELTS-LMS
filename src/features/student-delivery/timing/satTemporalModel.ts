import type {
  AssessmentDeliveryBootstrap,
  AssessmentModuleAttemptSnapshot,
  AssessmentTimingSnapshot,
} from '../contracts/assessmentDelivery';
import { isSatPersonalTimingModel } from '../../../types/domain';
import { breakRemainingSeconds, personalModuleRemainingSeconds } from '../domain/satTiming';
import {
  satBreakCountdownSeconds,
  satClockOffsetMs,
  satCountdown,
  satPersonalClockRunning,
  satSectionWaitSeconds,
  satSharedClockRunning,
} from '../application/satTimingPolicy';
import { resolveAuthoritativeRemainingSeconds } from '@shared/hooks/useAuthoritativeDeadlineClock';

export interface SatTemporalModel {
  data: AssessmentDeliveryBootstrap | null;
  effectiveTiming: AssessmentTimingSnapshot | null;
  snapshotReceivedAt: number;
  effectiveTimingReceivedAt: number;
  stateModuleAttempt: AssessmentModuleAttemptSnapshot | undefined;
  stateSectionKey: string | null;
  pendingAttempt: AssessmentModuleAttemptSnapshot | undefined;
  pendingSectionKey: string | null;
}

export function deriveSatTemporalSnapshot(model: SatTemporalModel, now: number) {
  const { data, effectiveTiming, snapshotReceivedAt } = model;
  const offset = satClockOffsetMs(effectiveTiming?.serverNow ?? null, model.effectiveTimingReceivedAt);
  const sharedRunning = satSharedClockRunning({
    runtimeStatus: data?.scheduleRuntimeStatus,
    stageStatus: effectiveTiming?.stageStatus,
  });
  const authoritativeSeconds = resolveAuthoritativeRemainingSeconds({
    deadlineAt: effectiveTiming?.deadlineAt ?? null,
    clockOffsetMs: offset,
    fallbackSeconds: effectiveTiming?.remainingSeconds ?? 0,
    running: sharedRunning,
    nowMs: now,
  });
  const personalRunning = satPersonalClockRunning({
    timingModel: effectiveTiming?.timingModel,
    runtimeStatus: data?.scheduleRuntimeStatus,
    stageStatus: effectiveTiming?.stageStatus,
  });
  const personalSeconds = model.stateModuleAttempt
    ? personalModuleRemainingSeconds(model.stateModuleAttempt, snapshotReceivedAt, now, offset, personalRunning)
    : null;
  const countdown = satCountdown({
    timingModel: effectiveTiming?.timingModel,
    stageKey: effectiveTiming?.stageKey,
    sectionKey: model.stateSectionKey,
    personalSeconds,
    authoritativeSeconds,
  });
  const waitingForNextSection = effectiveTiming?.waitingForNextSection ?? false;
  const nextSectionStartAt = waitingForNextSection ? effectiveTiming?.nextSectionStartAt ?? null : null;
  const nextSectionStartSeconds = resolveAuthoritativeRemainingSeconds({
    deadlineAt: nextSectionStartAt,
    clockOffsetMs: offset,
    fallbackSeconds: 0,
    running: Boolean(nextSectionStartAt) && data?.scheduleRuntimeStatus === 'live',
    nowMs: now,
  });
  const personalBreak = data && isSatPersonalTimingModel(effectiveTiming?.timingModel)
    ? data.attempt.personalBreaks?.find((candidate) => candidate.state !== 'completed') ?? null
    : null;
  const pendingBreakSeconds = data
    ? isSatPersonalTimingModel(effectiveTiming?.timingModel)
      ? (() => {
          if (!personalBreak || personalBreak.state !== 'active' || !personalBreak.deadlineAt) return 0;
          if (personalBreak.pausedAt) return Math.max(0, personalBreak.remainingSeconds);
          const deadline = Date.parse(personalBreak.deadlineAt);
          const startsAt = personalBreak.startsAt ? Date.parse(personalBreak.startsAt) : Number.NaN;
          if (Number.isFinite(startsAt) && startsAt > now + offset) return 0;
          return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - (now + offset)) / 1_000)) : 0;
        })()
      : satBreakCountdownSeconds({
          timingModel: effectiveTiming?.timingModel,
          nextSectionStartAt,
          nextSectionStartSeconds,
          legacyBreakSeconds: breakRemainingSeconds(data, model.pendingAttempt, snapshotReceivedAt, now),
        })
    : 0;
  const pendingSectionWaitSeconds = data && effectiveTiming
    ? satSectionWaitSeconds({
        timingModel: effectiveTiming.timingModel,
        stageKey: effectiveTiming.stageKey,
        sectionKey: model.pendingSectionKey,
        runtimeStatus: data.scheduleRuntimeStatus,
        waitingForNextSection,
        authoritativeSeconds,
      })
    : 0;
  const handoffSeconds = model.pendingSectionKey && effectiveTiming?.stageKey &&
    (effectiveTiming.stageKey === model.pendingSectionKey ||
      effectiveTiming.stageKey.startsWith(`${model.pendingSectionKey}:`))
    ? authoritativeSeconds
    : null;

  return {
    ...countdown,
    authoritativeSeconds,
    nextSectionStartSeconds,
    pendingBreakSeconds,
    pendingSectionWaitSeconds,
    handoffSeconds,
  };
}
