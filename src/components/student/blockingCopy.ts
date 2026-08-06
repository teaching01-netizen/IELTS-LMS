import type { BlockingReason } from './providers/StudentRuntimeProvider';

export interface BlockingCopy {
  title: string;
  message: string;
  badge: string;
  contextLabel: string;
}

// FEX-060: the pause-overlay copy is parameterized per blocking reason. The
// blocking overlay renders only when this returns a copy AND the blocking
// machine is active (StudentApp.tsx blockingOverlay).
export function getBlockingCopy(reason: BlockingReason): BlockingCopy | null {
  switch (reason) {
    case 'cohort_paused':
      return {
        title: 'Cohort paused',
        message:
          'The proctor has paused delivery. Your current section will resume when the cohort restarts.',
        badge: 'Paused',
        contextLabel: 'Cohort Runtime',
      };
    case 'proctor_paused':
      return {
        title: 'Individual session paused',
        message: 'This session is paused for review. Wait for resume instructions.',
        badge: 'Paused',
        contextLabel: 'Proctor Review',
      };
    case 'not_started':
      return {
        title: 'Waiting for start',
        message: 'The proctor has not started this cohort yet.',
        badge: 'Locked',
        contextLabel: 'Cohort Runtime',
      };
    case 'waiting_for_advance':
      return {
        title: 'Waiting for cohort advance',
        message: 'The proctor is preparing the next section. Please wait for the cohort to advance.',
        badge: 'Waiting',
        contextLabel: 'Cohort Runtime',
      };
    case 'waiting_for_runtime':
      return {
        title: 'Waiting for runtime',
        message: 'The exam runtime is synchronizing before the next section can continue.',
        badge: 'Waiting',
        contextLabel: 'Session Runtime',
      };
    case 'offline':
      return {
        title: 'Connection lost',
        message:
          'Your session is paused while connectivity is unavailable. Recovery will resume after reconnection.',
        badge: 'Offline',
        contextLabel: 'Session Recovery',
      };
    case 'heartbeat_lost':
      return {
        title: 'Heartbeat lost',
        message:
          'The secure session heartbeat was interrupted. The exam remains paused until continuity is restored.',
        badge: 'Review',
        contextLabel: 'Integrity Hold',
      };
    case 'device_mismatch':
      return {
        title: 'Device review required',
        message:
          'This session no longer matches the original device continuity check. Wait for proctor review.',
        badge: 'Blocked',
        contextLabel: 'Integrity Hold',
      };
    case 'storage_unavailable':
      return {
        title: 'Answer storage unavailable',
        message:
          'Your browser cannot safely store new answers right now. Keep this tab open and contact the proctor.',
        badge: 'Blocked',
        contextLabel: 'Session Recovery',
      };
    default:
      return null;
  }
}
