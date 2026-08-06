import { describe, expect, it } from 'vitest';
import { getBlockingCopy } from '../blockingCopy';
import type { BlockingReason } from '../providers/StudentRuntimeProvider';

// FEX-060: every blocking reason must parameterize a correct title, message,
// badge, and context label. The strings here are the exact overlay copy — any
// student-facing rewording must update this table (and the app-level overlay
// tests that assert the reachable subset).
describe('getBlockingCopy (FEX-060 pause overlay parameterization)', () => {
  it.each([
    {
      reason: 'cohort_paused' as const,
      title: 'Cohort paused',
      message:
        'The proctor has paused delivery. Your current section will resume when the cohort restarts.',
      badge: 'Paused',
      contextLabel: 'Cohort Runtime',
    },
    {
      reason: 'proctor_paused' as const,
      title: 'Individual session paused',
      message: 'This session is paused for review. Wait for resume instructions.',
      badge: 'Paused',
      contextLabel: 'Proctor Review',
    },
    {
      reason: 'not_started' as const,
      title: 'Waiting for start',
      message: 'The proctor has not started this cohort yet.',
      badge: 'Locked',
      contextLabel: 'Cohort Runtime',
    },
    {
      reason: 'waiting_for_advance' as const,
      title: 'Waiting for cohort advance',
      message: 'The proctor is preparing the next section. Please wait for the cohort to advance.',
      badge: 'Waiting',
      contextLabel: 'Cohort Runtime',
    },
    {
      reason: 'waiting_for_runtime' as const,
      title: 'Waiting for runtime',
      message: 'The exam runtime is synchronizing before the next section can continue.',
      badge: 'Waiting',
      contextLabel: 'Session Runtime',
    },
    {
      reason: 'offline' as const,
      title: 'Connection lost',
      message:
        'Your session is paused while connectivity is unavailable. Recovery will resume after reconnection.',
      badge: 'Offline',
      contextLabel: 'Session Recovery',
    },
    {
      reason: 'heartbeat_lost' as const,
      title: 'Heartbeat lost',
      message:
        'The secure session heartbeat was interrupted. The exam remains paused until continuity is restored.',
      badge: 'Review',
      contextLabel: 'Integrity Hold',
    },
    {
      reason: 'device_mismatch' as const,
      title: 'Device review required',
      message:
        'This session no longer matches the original device continuity check. Wait for proctor review.',
      badge: 'Blocked',
      contextLabel: 'Integrity Hold',
    },
    {
      reason: 'storage_unavailable' as const,
      title: 'Answer storage unavailable',
      message:
        'Your browser cannot safely store new answers right now. Keep this tab open and contact the proctor.',
      badge: 'Blocked',
      contextLabel: 'Session Recovery',
    },
  ] as Array<{
    reason: BlockingReason;
    title: string;
    message: string;
    badge: string;
    contextLabel: string;
  }>)(
    'returns the full overlay copy for $reason',
    ({ reason, title, message, badge, contextLabel }) => {
      expect(getBlockingCopy(reason)).toEqual({ title, message, badge, contextLabel });
    },
  );

  it('returns null for syncing_reconnect and unknown reasons so no overlay renders', () => {
    // syncing_reconnect has no overlay by design (FEX-032: the header
    // autoSaveStatus badge is the only surface for the reconnect state).
    expect(getBlockingCopy('syncing_reconnect')).toBeNull();
    expect(getBlockingCopy(null)).toBeNull();
  });
});
