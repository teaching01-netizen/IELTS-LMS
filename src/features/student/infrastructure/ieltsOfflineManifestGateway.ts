import { backendGet } from '@services/backendBridge';
import { tryBuildAttemptAuthorizationHeader } from '@services/attemptCredentialAdapter';
import type { StudentAttempt } from '../../../types/studentAttempt';
import { emitStudentObservabilityMetric } from '../../../utils/studentObservability';
import { rememberIeltsOfflineManifest } from './ieltsOfflinePackageStore';

/**
 * Captures the authenticated offline package descriptor through the existing
 * credentialed session read. The live poll deliberately carries no writer
 * identity, so it cannot return a descriptor without exposing the owner's
 * session id. This read runs only for a shared-timetable room that has no
 * manifest yet; the descriptor authorizes nothing server-side.
 */
export async function fetchIeltsOfflineManifestForAttempt(
  attempt: StudentAttempt,
  clientSessionId: string,
): Promise<boolean> {
  const query = new URLSearchParams({
    candidateId: attempt.candidateId,
    clientSessionId,
    refreshAttemptCredential: 'true',
  });
  const session = await backendGet<{ offlineManifest?: unknown }>(
    `/v1/student/sessions/${encodeURIComponent(attempt.scheduleId)}?${query.toString()}`,
    {
      headers: tryBuildAttemptAuthorizationHeader(attempt.scheduleId, attempt.id) ?? {},
      retries: 0,
      skipUnauthorizedHandler: true,
    },
  );
  if (!session.offlineManifest) {
    emitStudentObservabilityMetric('ielts_offline_manifest', { reason: 'absent' });
    return false;
  }
  rememberIeltsOfflineManifest(session.offlineManifest);
  emitStudentObservabilityMetric('ielts_offline_manifest', { reason: 'captured' });
  return true;
}
