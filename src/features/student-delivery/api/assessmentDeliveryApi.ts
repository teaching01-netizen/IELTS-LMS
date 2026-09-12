import {
  backendPatch,
  backendPost,
  ensureClientSessionIdForStudentKey,
  satWriterStudentKey,
  hasBackendStatusCode,
  isAttemptCredentialExpiringWithin,
  refreshAttemptCredential,
  storeAttemptCredential,
  tryBuildAttemptAuthorizationHeader,
  type ApiRequestConfig,
  type BackendAttemptCredential,
} from '../infrastructure/assessmentDeliveryBackendGateway';
import type {
  AssessmentDeliveryBootstrap,
  AssessmentModuleStartRequest,
  AssessmentModuleSubmitRequest,
  AssessmentResponseRequest,
  AssessmentResponseSnapshot,
  AssessmentResult,
  AssessmentSubmitRequest,
} from '../contracts/assessmentDelivery';

const ATTEMPT_REFRESH_WINDOW_MS = 5 * 60 * 1_000;
const attemptCandidates = new Map<string, string>();
const attemptPreferredSessions = new Map<string, string>();
const credentialRefreshes = new Map<string, Promise<boolean>>();
const LEGACY_SAT_SESSION_KEY_PREFIX = 'sat-client-session:';

export interface SatHeartbeatResponse {
  refreshedAttemptCredential?: BackendAttemptCredential | null;
  /** Plan C5: server-echoed presence window (coalesce beats inside it). */
  nextHeartbeatSecs?: number | null;
}

function attemptKey(scheduleId: string, attemptId: string): string {
  return `${scheduleId}:${attemptId}`;
}

export function configureAssessmentDeliveryAttempt(
  scheduleId: string,
  attemptId: string,
  candidateId: string,
  preferredClientSessionId?: string | null,
): void {
  if (candidateId.trim()) attemptCandidates.set(attemptKey(scheduleId, attemptId), candidateId);
  if (typeof preferredClientSessionId === 'string' && preferredClientSessionId.trim()) {
    attemptPreferredSessions.set(attemptKey(scheduleId, attemptId), preferredClientSessionId.trim());
  }
}

/** Shared studentKey derivation — single owner in studentAttemptRepository. */
function studentKeyFor(scheduleId: string, candidateId: string): string {
  return satWriterStudentKey(scheduleId, candidateId);
}

function removeLegacySatSessionKeys(scheduleId: string, attemptId: string): void {
  // One-way migration: the split `sat-client-session:` identity is retired.
  // Best-effort — storage may be unavailable; resolution never depends on it.
  try {
    window.sessionStorage.removeItem(`${LEGACY_SAT_SESSION_KEY_PREFIX}${scheduleId}:${attemptId}`);
  } catch {
    // ignore
  }
}

function attemptConfig(scheduleId: string, attemptId: string): ApiRequestConfig {
  const headers = tryBuildAttemptAuthorizationHeader(scheduleId, attemptId);
  return {
    ...(headers ? { headers } : {}),
    retries: 0,
    skipUnauthorizedHandler: true,
  };
}

/**
 * Single writer identity shared with the attempt owner: heartbeat, credential
 * refresh, V2 saves, and takeover all present this id, so the bearer-bound
 * session check never sees a SAT-specific second identity.
 */
function clientSessionId(scheduleId: string, attemptId: string): string {
  const key = attemptKey(scheduleId, attemptId);
  const candidateId = attemptCandidates.get(key);
  // Exam-day re-audit defect 3: the key MUST equal attempt.studentKey or the
  // bearer-bound session check fences one path. candidateId here is the
  // attempt's candidateId (route prop), so studentKeyFor matches the owner.
  // Without a candidate we cannot derive the owner key — no fallback key is
  // invented (a second `attempt:` key would split the writer identity again);
  // the caller must configure first (controller does this on mount).
  if (!candidateId) {
    throw new Error('SAT delivery attempt is not configured: missing candidateId.');
  }
  const studentKey = studentKeyFor(scheduleId, candidateId);
  const preferred = attemptPreferredSessions.get(key) ?? null;
  const resolved = ensureClientSessionIdForStudentKey(scheduleId, studentKey, preferred);
  removeLegacySatSessionKeys(scheduleId, attemptId);
  return resolved;
}

async function refreshCredentialSingleflight(scheduleId: string, attemptId: string): Promise<boolean> {
  const key = attemptKey(scheduleId, attemptId);
  const candidateId = attemptCandidates.get(key);
  if (!candidateId) return false;
  const existing = credentialRefreshes.get(key);
  if (existing) return existing;

  const refresh = refreshAttemptCredential(
    { id: attemptId, scheduleId, candidateId },
    clientSessionId(scheduleId, attemptId),
  ).finally(() => credentialRefreshes.delete(key));
  credentialRefreshes.set(key, refresh);
  return refresh;
}

async function attemptRequest<T>(
  scheduleId: string,
  attemptId: string,
  request: (config: ApiRequestConfig) => Promise<T>,
): Promise<T> {
  if (isAttemptCredentialExpiringWithin(scheduleId, attemptId, ATTEMPT_REFRESH_WINDOW_MS)) {
    await refreshCredentialSingleflight(scheduleId, attemptId).catch(() => false);
  }

  try {
    return await request(attemptConfig(scheduleId, attemptId));
  } catch (error) {
    if (!hasBackendStatusCode(error, 401)) throw error;
    const refreshed = await refreshCredentialSingleflight(scheduleId, attemptId);
    if (!refreshed) throw error;
    return request(attemptConfig(scheduleId, attemptId));
  }
}

export const assessmentDeliveryApi = {
  heartbeat(
    scheduleId: string,
    attemptId: string,
    eventType: 'heartbeat' | 'disconnect' | 'reconnect' | 'lost' = 'heartbeat',
    payload: Record<string, unknown> = {},
  ): Promise<SatHeartbeatResponse> {
    return attemptRequest(scheduleId, attemptId, async (config) => {
      const key = attemptKey(scheduleId, attemptId);
      const candidateId = attemptCandidates.get(key);
      if (!candidateId) {
        throw new Error('SAT delivery attempt is not configured: missing candidateId.');
      }
      const response = await backendPost<SatHeartbeatResponse>(
        `/v1/student/sessions/${scheduleId}/heartbeat?responseMode=ack`,
        {
          studentKey: studentKeyFor(scheduleId, candidateId),
          clientSessionId: clientSessionId(scheduleId, attemptId),
          eventType,
          payload: { providerKey: 'sat', ...payload },
          clientTimestamp: new Date().toISOString(),
        },
        config,
      );
      storeAttemptCredential({ id: attemptId, scheduleId }, response.refreshedAttemptCredential);
      return response;
    });
  },

  recordAudit(
    scheduleId: string,
    attemptId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    return attemptRequest(scheduleId, attemptId, (config) => backendPost(
      `/v1/student/sessions/${scheduleId}/audit`,
      { actionType, payload: { providerKey: 'sat', ...payload }, clientTimestamp: new Date().toISOString() },
      config,
    ));
  },

  // Plan C4: conditional bootstrap — If-None-Match makes reconnects a 304
  // (zero bytes) instead of a full version re-fetch. Pass the cached ETag
  // from createBootstrapCache; null = first fetch.
  bootstrap(
    scheduleId: string,
    attemptId: string,
    ifNoneMatch?: string | null,
  ): Promise<AssessmentDeliveryBootstrap> {
    return attemptRequest(scheduleId, attemptId, (config) => backendPost<AssessmentDeliveryBootstrap>(
      `/v1/assessment-delivery/schedules/${scheduleId}/bootstrap`,
      undefined,
      {
        ...config,
        ...(ifNoneMatch ? { headers: { ...config.headers, 'If-None-Match': ifNoneMatch } } : {}),
      },
    ));
  },

  saveResponse(
    scheduleId: string,
    attemptId: string,
    examQuestionId: string,
    request: AssessmentResponseRequest,
  ): Promise<AssessmentResponseSnapshot> {
    return attemptRequest(scheduleId, attemptId, (config) => backendPatch<AssessmentResponseSnapshot>(
      `/v1/assessment-delivery/schedules/${scheduleId}/responses/${examQuestionId}`,
      request,
      config,
    ));
  },

  startModule(
    scheduleId: string,
    attemptId: string,
    request: AssessmentModuleStartRequest,
  ): Promise<AssessmentDeliveryBootstrap> {
    return attemptRequest(scheduleId, attemptId, (config) => backendPost<AssessmentDeliveryBootstrap>(
      `/v1/assessment-delivery/schedules/${scheduleId}/modules/start`,
      request,
      config,
    ));
  },

  submitModule(
    scheduleId: string,
    attemptId: string,
    request: AssessmentModuleSubmitRequest,
  ): Promise<AssessmentDeliveryBootstrap> {
    return attemptRequest(scheduleId, attemptId, (config) => backendPost<AssessmentDeliveryBootstrap>(
      `/v1/assessment-delivery/schedules/${scheduleId}/modules/submit`,
      request,
      config,
    ));
  },

  submitAssessment(
    scheduleId: string,
    attemptId: string,
    request: AssessmentSubmitRequest,
  ): Promise<AssessmentResult> {
    return attemptRequest(scheduleId, attemptId, (config) => backendPost<AssessmentResult>(
      `/v1/assessment-delivery/schedules/${scheduleId}/submit`,
      request,
      config,
    ));
  },
};
