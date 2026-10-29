import type {
  AssessmentDeliveryBootstrap,
  AssessmentModuleAttemptSnapshot,
  AssessmentTimingSnapshot,
} from '../contracts/assessmentDelivery';
import { breakRemainingSeconds, personalModuleRemainingSeconds } from '../domain/satTiming';
import {
  satBreakCountdownSeconds,
  satBreakWindow,
  satClockOffsetMs,
  satCountdown,
  satOpenPersonalBreak,
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
  /**
   * The break authored before the pending module while no break row exists yet
   * (satPendingAuthoredBreakSeconds). A primitive so the memo that builds this
   * model stays referentially stable when `data` does not change.
   */
  authoredBreakSeconds: number;
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
    ? personalModuleRemainingSeconds(
        model.stateModuleAttempt,
        snapshotReceivedAt,
        now,
        offset,
        personalRunning,
        effectiveTiming?.timingModel,
      )
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
  const breakWindow = satBreakWindow({
    timingModel: effectiveTiming?.timingModel,
    personalBreak: satOpenPersonalBreak(effectiveTiming?.timingModel, data?.attempt.personalBreaks),
    serverNowMs: now + offset,
    authoredBreakSeconds: model.authoredBreakSeconds,
    sharedSeconds: data
      ? satBreakCountdownSeconds({
          timingModel: effectiveTiming?.timingModel,
          nextSectionStartAt,
          nextSectionStartSeconds,
          legacyBreakSeconds: breakRemainingSeconds(data, model.pendingAttempt, snapshotReceivedAt, now),
        })
      : 0,
  });
  const pendingBreakSeconds = breakWindow.seconds ?? 0;
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
    breakWindow,
    pendingBreakSeconds,
    pendingSectionWaitSeconds,
    handoffSeconds,
  };
}
