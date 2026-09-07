import type {
  AssessmentDeliveryBootstrap,
  AssessmentModuleAttemptSnapshot,
  AssessmentTimingSnapshot,
} from '../contracts/assessmentDelivery';

export function mergeAuthoritativeTiming(
  current: AssessmentTimingSnapshot | null,
  incoming: AssessmentTimingSnapshot,
): AssessmentTimingSnapshot {
  if (!current || current.timingModel !== incoming.timingModel) return incoming;
  if (incoming.runtimeRevision < current.runtimeRevision) return current;
  if (
    incoming.runtimeRevision === current.runtimeRevision
    && incoming.stageKey === current.stageKey
    && current.deadlineAt
    && incoming.deadlineAt
    && Date.parse(incoming.deadlineAt) > Date.parse(current.deadlineAt)
  ) {
    return { ...incoming, deadlineAt: current.deadlineAt };
  }
  return incoming;
}

export function snapshotRemainingSeconds(
  attempt: AssessmentModuleAttemptSnapshot | undefined,
  snapshotReceivedAt: number,
  now: number,
): number {
  if (!attempt) return 0;
  if (attempt.pausedAt || !attempt.startedAt) return Math.max(0, attempt.remainingSeconds ?? 0);
  const elapsedSinceSnapshot = Math.max(0, Math.floor((now - snapshotReceivedAt) / 1_000));
  return Math.max(0, (attempt.remainingSeconds ?? 0) - elapsedSinceSnapshot);
}

export function breakRemainingSeconds(
  data: AssessmentDeliveryBootstrap,
  attempt: AssessmentModuleAttemptSnapshot | undefined,
  snapshotReceivedAt: number,
  now: number,
): number {
  if (data.timing.timingModel === 'cohort_stage_v2' || data.timing.timingModel === 'cohort_section_v3') {
    return data.timing.stageKey?.startsWith('sat:break:') ? data.timing.remainingSeconds : 0;
  }
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
  const endsAt = data.timing.timingModel === 'cohort_stage_v2' && data.timing.deadlineAt
    ? data.timing.deadlineAt
    : data.timing.timingModel === 'cohort_section_v3' && data.timing.deadlineAt
      ? new Date(Math.min(Date.parse(fallbackEndsAt), Date.parse(data.timing.deadlineAt))).toISOString()
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
