import {
  backendGet,
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
  AssessmentDeliveryState,
  AssessmentBreakEntryRequest,
  AssessmentModuleEntryRequest,
  AssessmentModuleEntryStateAck,
  AssessmentModuleStartRequest,
  AssessmentModuleSubmitRequest,
  AssessmentResponseRequest,
  AssessmentResponseSnapshot,
  AssessmentResult,
  AssessmentStageVisibleAck,
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
  } else {
    attemptPreferredSessions.delete(attemptKey(scheduleId, attemptId));
  }
}

/** Shared studentKey derivation — single owner in studentAttemptRepository. */
function studentKeyFor(scheduleId: string, candidateId: string): string {
  return satWriterStudentKey(scheduleId, candidateId);
}

function removeLegacySatSessionKeys(scheduleId: string, attemptId: string): void {
  // One-way migration: the split `sat-client-session:` identity is retired.
  // The `sat-bootstrap-etag:` entry is retired with it — an ETag derived from
  // the static exam version was never a validator for live attempt state, so
  // the cached payload must not survive a reload either. Best-effort — storage
  // may be unavailable; nothing reads either key any more.
  try {
    window.sessionStorage.removeItem(`${LEGACY_SAT_SESSION_KEY_PREFIX}${scheduleId}:${attemptId}`);
    window.sessionStorage.removeItem(`sat-bootstrap-etag:${scheduleId}:${attemptId}`);
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

  // Unconditional bootstrap. The payload is LIVE attempt state — module
  // attempts, the adaptive Higher/Lower route, responses, timers, result —
  // while the only cache validator the endpoint used to accept is the
  // published exam version. Routing a candidate into Module 2 Higher does not
  // move the version, so a version-scoped If-None-Match answered 304 and the
  // runner kept the pre-routing module. No attempt-state read is conditional
  // now; client-side equivalent-payload skipping is where no-change lives.
  bootstrap(
    scheduleId: string,
    attemptId: string,
  ): Promise<AssessmentDeliveryBootstrap> {
    return attemptRequest(scheduleId, attemptId, (config) => backendPost<AssessmentDeliveryBootstrap>(
      `/v1/assessment-delivery/schedules/${scheduleId}/bootstrap`,
      undefined,
      config,
    ));
  },

  state(scheduleId: string, attemptId: string): Promise<AssessmentDeliveryState> {
    return attemptRequest(scheduleId, attemptId, (config) => backendGet<AssessmentDeliveryState>(
      `/v1/assessment-delivery/schedules/${scheduleId}/state`,
      config,
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
  ): Promise<AssessmentDeliveryBootstrap | AssessmentModuleEntryStateAck> {
    return attemptRequest(scheduleId, attemptId, (config) => backendPost<AssessmentModuleEntryStateAck>(
      `/v1/assessment-delivery/schedules/${scheduleId}/modules/start`,
      request,
      config,
    ));
  },

  enterModule(
    scheduleId: string,
    attemptId: string,
    request: AssessmentModuleEntryRequest,
  ): Promise<AssessmentDeliveryBootstrap | AssessmentModuleEntryStateAck> {
    return attemptRequest(scheduleId, attemptId, (config) => backendPost<AssessmentModuleEntryStateAck>(
      `/v1/assessment-delivery/schedules/${scheduleId}/modules/enter`,
      request,
      config,
    ));
  },

  /**
   * The authoritative, cheap entry read behind "Retry now" and the
   * lost-response recovery path. It mutates nothing, so a client that does not
   * know whether its transition command committed asks here instead of
   * replaying the command.
   */
  entryState(
    scheduleId: string,
    attemptId: string,
    moduleId: string,
  ): Promise<AssessmentModuleEntryStateAck> {
    return attemptRequest(scheduleId, attemptId, (config) => backendGet<AssessmentModuleEntryStateAck>(
      `/v1/assessment-delivery/schedules/${scheduleId}/modules/${encodeURIComponent(moduleId)}/entry-state`,
      config,
    ));
  },

  markStageVisible(
    scheduleId: string,
    attemptId: string,
    request: AssessmentModuleEntryRequest,
  ): Promise<AssessmentStageVisibleAck> {
    return attemptRequest(scheduleId, attemptId, (config) => backendPost<AssessmentStageVisibleAck>(
      `/v1/assessment-delivery/schedules/${scheduleId}/modules/visible`,
      request,
      config,
    ));
  },

  startBreak(
    scheduleId: string,
    attemptId: string,
    breakId: string,
    request?: AssessmentBreakEntryRequest,
  ): Promise<AssessmentDeliveryBootstrap> {
    // Only the control-epoch fence is meaningful here (the server ignores the
    // rest of the entry shape); an undefined epoch is omitted so legacy
    // clients keep the pre-existing un-fenced behavior.
    const body = request?.controlEpoch === undefined ? undefined : { controlEpoch: request.controlEpoch };
    return attemptRequest(scheduleId, attemptId, (config) => backendPost<AssessmentDeliveryBootstrap>(
      `/v1/assessment-delivery/schedules/${scheduleId}/breaks/${breakId}/start`,
      body,
      config,
    ));
  },

  enterBreak(
    scheduleId: string,
    attemptId: string,
    request: AssessmentBreakEntryRequest,
  ): Promise<AssessmentDeliveryBootstrap> {
    return attemptRequest(scheduleId, attemptId, (config) => backendPost<AssessmentDeliveryBootstrap>(
      `/v1/assessment-delivery/schedules/${scheduleId}/breaks/enter`,
      request,
      config,
    ));
  },

  markBreakVisible(
    scheduleId: string,
    attemptId: string,
    request: AssessmentBreakEntryRequest,
  ): Promise<AssessmentDeliveryBootstrap> {
    return attemptRequest(scheduleId, attemptId, (config) => backendPost<AssessmentDeliveryBootstrap>(
      `/v1/assessment-delivery/schedules/${scheduleId}/breaks/visible`,
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
