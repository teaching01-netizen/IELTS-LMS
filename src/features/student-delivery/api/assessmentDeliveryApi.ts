import {
  backendPatch,
  backendPost,
  tryBuildAttemptAuthorizationHeader,
  type ApiRequestConfig,
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

function attemptConfig(scheduleId: string, attemptId: string): ApiRequestConfig {
  const headers = tryBuildAttemptAuthorizationHeader(scheduleId, attemptId);
  return headers ? { headers } : {};
}

function clientSessionId(scheduleId: string, attemptId: string): string {
  const key = `sat-client-session:${scheduleId}:${attemptId}`;
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = globalThis.crypto?.randomUUID?.() ?? `sat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(key, created);
  return created;
}

export const assessmentDeliveryApi = {
  heartbeat(
    scheduleId: string,
    attemptId: string,
    eventType: 'heartbeat' | 'disconnect' | 'reconnect' | 'lost' = 'heartbeat',
    payload: Record<string, unknown> = {},
  ): Promise<unknown> {
    return backendPost(
      `/v1/student/sessions/${scheduleId}/heartbeat?responseMode=ack`,
      {
        studentKey: 'sat',
        clientSessionId: clientSessionId(scheduleId, attemptId),
        eventType,
        payload: { providerKey: 'sat', ...payload },
        clientTimestamp: new Date().toISOString(),
      },
      attemptConfig(scheduleId, attemptId),
    );
  },

  recordAudit(
    scheduleId: string,
    attemptId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    return backendPost(
      `/v1/student/sessions/${scheduleId}/audit`,
      { actionType, payload: { providerKey: 'sat', ...payload }, clientTimestamp: new Date().toISOString() },
      attemptConfig(scheduleId, attemptId),
    );
  },

  bootstrap(scheduleId: string, attemptId: string): Promise<AssessmentDeliveryBootstrap> {
    return backendPost<AssessmentDeliveryBootstrap>(
      `/v1/assessment-delivery/schedules/${scheduleId}/bootstrap`,
      undefined,
      attemptConfig(scheduleId, attemptId),
    );
  },

  saveResponse(
    scheduleId: string,
    attemptId: string,
    examQuestionId: string,
    request: AssessmentResponseRequest,
  ): Promise<AssessmentResponseSnapshot> {
    return backendPatch<AssessmentResponseSnapshot>(
      `/v1/assessment-delivery/schedules/${scheduleId}/responses/${examQuestionId}`,
      request,
      attemptConfig(scheduleId, attemptId),
    );
  },

  startModule(
    scheduleId: string,
    attemptId: string,
    request: AssessmentModuleStartRequest,
  ): Promise<AssessmentDeliveryBootstrap> {
    return backendPost<AssessmentDeliveryBootstrap>(
      `/v1/assessment-delivery/schedules/${scheduleId}/modules/start`,
      request,
      attemptConfig(scheduleId, attemptId),
    );
  },

  submitModule(
    scheduleId: string,
    attemptId: string,
    request: AssessmentModuleSubmitRequest,
  ): Promise<AssessmentDeliveryBootstrap> {
    return backendPost<AssessmentDeliveryBootstrap>(
      `/v1/assessment-delivery/schedules/${scheduleId}/modules/submit`,
      request,
      attemptConfig(scheduleId, attemptId),
    );
  },

  submitAssessment(
    scheduleId: string,
    attemptId: string,
    request: AssessmentSubmitRequest,
  ): Promise<AssessmentResult> {
    return backendPost<AssessmentResult>(
      `/v1/assessment-delivery/schedules/${scheduleId}/submit`,
      request,
      attemptConfig(scheduleId, attemptId),
    );
  },
};
