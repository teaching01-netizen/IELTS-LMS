import {
  backendPatch,
  backendPost,
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
const credentialRefreshes = new Map<string, Promise<boolean>>();

export interface SatHeartbeatResponse {
  refreshedAttemptCredential?: BackendAttemptCredential | null;
}

function attemptKey(scheduleId: string, attemptId: string): string {
  return `${scheduleId}:${attemptId}`;
}

export function configureAssessmentDeliveryAttempt(
  scheduleId: string,
  attemptId: string,
  candidateId: string,
): void {
  if (candidateId.trim()) attemptCandidates.set(attemptKey(scheduleId, attemptId), candidateId);
}

function attemptConfig(scheduleId: string, attemptId: string): ApiRequestConfig {
  const headers = tryBuildAttemptAuthorizationHeader(scheduleId, attemptId);
  return {
    ...(headers ? { headers } : {}),
    retries: 0,
    skipUnauthorizedHandler: true,
  };
}

function clientSessionId(scheduleId: string, attemptId: string): string {
  const key = `sat-client-session:${scheduleId}:${attemptId}`;
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = globalThis.crypto?.randomUUID?.() ?? `sat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(key, created);
  return created;
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
      const response = await backendPost<SatHeartbeatResponse>(
        `/v1/student/sessions/${scheduleId}/heartbeat?responseMode=ack`,
        {
          studentKey: 'sat',
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

  bootstrap(scheduleId: string, attemptId: string): Promise<AssessmentDeliveryBootstrap> {
    return attemptRequest(scheduleId, attemptId, (config) => backendPost<AssessmentDeliveryBootstrap>(
      `/v1/assessment-delivery/schedules/${scheduleId}/bootstrap`,
      undefined,
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
