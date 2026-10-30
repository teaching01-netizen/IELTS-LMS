import { useEffect, useRef } from 'react';
import type { StudentAttempt } from '../../../types/studentAttempt';
import { cleanupIeltsOfflineArtifacts } from '../application/ieltsOfflineCleanup';

/**
 * Cleanup gate for shared-timetable rooms. Only a server-confirmed receipt
 * (submittedAt) with nothing pending and every retained evidence batch
 * acknowledged may remove the offline package/media/shell. A local completion
 * marker, a closed room, or elapsed time never qualifies; unsent work stays
 * in the durability store.
 */
export function useIeltsOfflineCleanup(input: {
  enabled: boolean;
  attempt: StudentAttempt | null;
  pendingMutationCount: number;
  unacknowledgedEvidenceCount: number;
}): void {
  const { enabled, attempt, pendingMutationCount, unacknowledgedEvidenceCount } = input;
  const cleanedAttemptId = useRef<string | null>(null);
  const attemptId = attempt?.id ?? null;
  const submittedAt = attempt?.submittedAt ?? null;
  useEffect(() => {
    if (!enabled || !attemptId || !submittedAt) return;
    if (pendingMutationCount > 0 || unacknowledgedEvidenceCount > 0) return;
    if (cleanedAttemptId.current === attemptId) return;
    cleanedAttemptId.current = attemptId;
    void cleanupIeltsOfflineArtifacts(attemptId).catch(() => {
      if (cleanedAttemptId.current === attemptId) cleanedAttemptId.current = null;
    });
  }, [enabled, attemptId, submittedAt, pendingMutationCount, unacknowledgedEvidenceCount]);
}
