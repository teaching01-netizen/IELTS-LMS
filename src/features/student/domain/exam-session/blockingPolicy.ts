import type { ExamSessionRuntime, RuntimeStatus } from '../../../../types/domain';
import type { StudentAttempt } from '../../../../types/studentAttempt';

export type StudentBlockingReason =
  | 'cohort_paused'
  | 'proctor_paused'
  | 'not_started'
  | 'waiting_for_runtime'
  | 'waiting_for_advance'
  | 'offline'
  | 'syncing_reconnect'
  | 'heartbeat_lost'
  | 'device_mismatch'
  | 'storage_unavailable'
  | null;

export interface BlockingPolicyInput {
  readonly runtimeBacked: boolean;
  readonly runtime: ExamSessionRuntime | null;
  readonly waitingForCohortAdvance: boolean;
  readonly proctorStatus: StudentAttempt['proctorStatus'];
  readonly blockingReasonOverride: StudentBlockingReason;
  readonly timeRemaining: number;
}

export interface BlockingPolicyState {
  readonly active: boolean;
  readonly reason: Exclude<StudentBlockingReason, 'offline' | 'syncing_reconnect' | 'heartbeat_lost' | 'device_mismatch'>;
  readonly runtimeStatus: RuntimeStatus | null;
  readonly timeRemaining: number;
}

const LOG_ONLY_REASONS = new Set<Exclude<StudentBlockingReason, null>>([
  'offline',
  'syncing_reconnect',
  'heartbeat_lost',
  'device_mismatch',
]);

function isLogOnlyReason(
  reason: StudentBlockingReason,
): reason is 'offline' | 'syncing_reconnect' | 'heartbeat_lost' | 'device_mismatch' {
  return reason !== null && LOG_ONLY_REASONS.has(reason);
}

export function deriveBlockingState(input: BlockingPolicyInput): BlockingPolicyState {
  const runtimeStatus = input.runtimeBacked ? input.runtime?.status ?? 'not_started' : null;
  const override = isLogOnlyReason(input.blockingReasonOverride)
    ? null
    : input.blockingReasonOverride;

  if (override) {
    return {
      active: true,
      reason: override,
      runtimeStatus,
      timeRemaining: input.timeRemaining,
    };
  }

  if (input.proctorStatus === 'paused') {
    return {
      active: true,
      reason: 'proctor_paused',
      runtimeStatus,
      timeRemaining: input.timeRemaining,
    };
  }

  if (!input.runtimeBacked) {
    return {
      active: false,
      reason: null,
      runtimeStatus: null,
      timeRemaining: input.timeRemaining,
    };
  }

  const currentSection = input.runtime?.currentSectionKey
    ? input.runtime.sections.find((section) => section.sectionKey === input.runtime?.currentSectionKey)
    : null;

  if (runtimeStatus === 'paused' || currentSection?.status === 'paused') {
    return {
      active: true,
      reason: 'cohort_paused',
      runtimeStatus,
      timeRemaining: input.timeRemaining,
    };
  }

  if (runtimeStatus === 'not_started') {
    return {
      active: true,
      reason: 'not_started',
      runtimeStatus,
      timeRemaining: input.timeRemaining,
    };
  }

  if (input.waitingForCohortAdvance || input.runtime?.waitingForNextSection) {
    return {
      active: true,
      reason: 'waiting_for_advance',
      runtimeStatus,
      timeRemaining: input.timeRemaining,
    };
  }

  return {
    active: false,
    reason: null,
    runtimeStatus,
    timeRemaining: input.timeRemaining,
  };
}
