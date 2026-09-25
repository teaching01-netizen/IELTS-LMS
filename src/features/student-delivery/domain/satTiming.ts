import type {
  AssessmentDeliveryBootstrap,
  AssessmentModuleAttemptSnapshot,
  AssessmentTimingSnapshot,
} from '../contracts/assessmentDelivery';
import { isCohortTimingModel, isSatPersonalTimingModel, isSectionKeyedCohortModel } from '../../../types/domain';

export function mergeAuthoritativeTiming(
  current: AssessmentTimingSnapshot | null,
  incoming: AssessmentTimingSnapshot,
): AssessmentTimingSnapshot {
  if (!current || current.timingModel !== incoming.timingModel) return incoming;
  if (incoming.runtimeRevision < current.runtimeRevision) return current;
  // A projection that omits the between-sections keys must not clear a known
  // break: only an explicit null/false (the server's "the break is over") ends
  // the window. Newer-but-silent payloads keep the previous value.
  const carryBetweenSections = (value: AssessmentTimingSnapshot): AssessmentTimingSnapshot => {
    const next = { ...value };
    if (next.nextSectionStartAt === undefined && current.nextSectionStartAt !== undefined) {
      next.nextSectionStartAt = current.nextSectionStartAt;
    }
    if (next.waitingForNextSection === undefined && current.waitingForNextSection !== undefined) {
      next.waitingForNextSection = current.waitingForNextSection;
    }
    return next;
  };
  if (
    incoming.runtimeRevision === current.runtimeRevision
    && incoming.stageKey === current.stageKey
    && current.deadlineAt
    && incoming.deadlineAt
    && Date.parse(incoming.deadlineAt) > Date.parse(current.deadlineAt)
  ) {
    return carryBetweenSections({ ...incoming, deadlineAt: current.deadlineAt });
  }
  return carryBetweenSections(incoming);
}

/**
 * The one convention for a server-published duration: one real second per real
 * second since the payload landed, frozen while the clock the number belongs to
 * is stopped.
 *
 * Device skew cancels — the payload instant and `now` are both read from the
 * same local clock — and transit is absorbed, because the server computed the
 * number against its own instant while the elapsed time is measured from the
 * moment the payload arrived. Every published countdown that is not an absolute
 * deadline drains through here, so the pre-entry module window and the module
 * clock the student lands in cannot disagree about what the server granted.
 */
export function drainSinceSnapshot(
  seconds: number,
  snapshotReceivedAt: number,
  now: number,
  running: boolean,
): number {
  const published = Math.max(0, Math.floor(seconds));
  if (!running) return published;
  const elapsedSinceSnapshot = Math.max(0, Math.floor((now - snapshotReceivedAt) / 1_000));
  return Math.max(0, published - elapsedSinceSnapshot);
}

export function snapshotRemainingSeconds(
  attempt: AssessmentModuleAttemptSnapshot | undefined,
  snapshotReceivedAt: number,
  now: number,
): number {
  if (!attempt) return 0;
  // A paused or unstarted module never ticks: the published remainder stands.
  if (attempt.pausedAt || !attempt.startedAt) return Math.max(0, attempt.remainingSeconds ?? 0);
  return drainSinceSnapshot(attempt.remainingSeconds ?? 0, snapshotReceivedAt, now, true);
}

/**
 * Personal module countdown that ticks between bootstraps (exam-day P1).
 *
 * The backend ships a server-computed `deadlineAt` per module attempt; when
 * present it is authoritative and advanced with the same clock offset the
 * cohort section clock uses, so the display tracks the server expiry instead
 * of freezing at the last snapshot value. Falls back to
 * snapshotRemainingSeconds when no deadline is available. A paused or
 * unstarted module never ticks (frozen countdown).
 *
 * Exam-day re-audit defect 9: a cohort-stage pause freezes the authoritative
 * section clock (`running` false in useAuthoritativeDeadlineClock), so the
 * personal clock must freeze too — otherwise min(personal ticking,
 * authoritative frozen) reaches zero during a planned pause drill. Pass
 * cohortRunning=false when the stage is not live.
 */
export function personalModuleRemainingSeconds(
  attempt: AssessmentModuleAttemptSnapshot | undefined,
  snapshotReceivedAt: number,
  now: number,
  clockOffsetMs = 0,
  cohortRunning = true,
  timingModel?: string | null,
): number {
  if (!attempt) return 0;
  if (attempt.pausedAt || !attempt.startedAt || !cohortRunning) {
    return Math.max(0, attempt.remainingSeconds ?? 0);
  }
  if (attempt.deadlineAt) {
    const deadlineMs = Date.parse(attempt.deadlineAt);
    if (Number.isFinite(deadlineMs) && Number.isFinite(clockOffsetMs)) {
      const exactSeconds = (deadlineMs - (now + clockOffsetMs)) / 1_000;
      const calculatedSeconds = Math.max(0, Math.ceil(exactSeconds));
      if (!isSatPersonalTimingModel(timingModel)) return calculatedSeconds;
      // A live event may publish startedAt before the timing snapshot advances.
      // If that snapshot predates start, ceil could briefly display more than
      // this module's authored grant (for example, 2:01 for a 2:00 module).
      const grantedSeconds = Math.max(
        0,
        attempt.allocatedSeconds + attempt.extensionSeconds + attempt.accumulatedPausedSeconds,
      );
      return Math.min(grantedSeconds, calculatedSeconds);
    }
  }
  return snapshotRemainingSeconds(attempt, snapshotReceivedAt, now);
}

/**
 * Legacy-model break countdown only. Cohort models (cohort_stage_v2 /
 * cohort_section_v3) derive the break from the server's nextSectionStartAt
 * instead: their stage keys are plain section keys, and the old
 * `sat:break:<key>` suffixed stage never had a writer, so reading it only
 * risked a silent 0:00. Kept for the legacy per-module availableAt delay.
 */
export function breakRemainingSeconds(
  data: AssessmentDeliveryBootstrap,
  attempt: AssessmentModuleAttemptSnapshot | undefined,
  snapshotReceivedAt: number,
  now: number,
): number {
  if (isCohortTimingModel(data.timing.timingModel)) return 0;
  if (!attempt?.availableAt) return 0;
  const serverDelaySeconds = Math.max(
    0,
    Math.ceil((Date.parse(attempt.availableAt) - Date.parse(data.serverNow)) / 1_000),
  );
  const elapsedSinceSnapshot = Math.max(0, Math.floor((now - snapshotReceivedAt) / 1_000));
  return Math.max(0, serverDelaySeconds - elapsedSinceSnapshot);
}

export function timingForAttempt(
  data: AssessmentDeliveryBootstrap,
  attempt: AssessmentModuleAttemptSnapshot,
): { startedAt: string; endsAt: string } {
  const startedAt = attempt.startedAt ?? data.serverNow;
  const fallbackEndsAt = attempt.deadlineAt
    ?? new Date(Date.parse(data.serverNow) + Math.max(0, attempt.remainingSeconds ?? 0) * 1_000).toISOString();
  // A section-keyed cohort model publishes the section's deadline, so the
  // module clock is clamped to it; a stage-keyed model already publishes the
  // module's own deadline. Anything else is the per-module legacy clock.
  const endsAt = isSectionKeyedCohortModel(data.timing.timingModel) && data.timing.deadlineAt
    ? new Date(Math.min(Date.parse(fallbackEndsAt), Date.parse(data.timing.deadlineAt))).toISOString()
    : isCohortTimingModel(data.timing.timingModel) && data.timing.deadlineAt
      ? data.timing.deadlineAt
      : fallbackEndsAt;
  return { startedAt, endsAt };
}

export const SAT_TIMER_AUTO_REVEAL_SECONDS = 300;

export function shouldAutoRevealTimer(args: {
  previousSeconds: number | null | undefined;
  remainingSeconds: number | null | undefined;
  alreadyRevealed: boolean;
}): boolean {
  const { previousSeconds, remainingSeconds, alreadyRevealed } = args;
  if (alreadyRevealed) return false;
  if (remainingSeconds == null || remainingSeconds > SAT_TIMER_AUTO_REVEAL_SECONDS) return false;
  // Hydration: the exam loaded already at or below five minutes.
  if (previousSeconds == null) return true;
  return previousSeconds > SAT_TIMER_AUTO_REVEAL_SECONDS;
}

export function formatSatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}
