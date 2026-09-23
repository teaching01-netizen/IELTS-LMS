type HeartbeatResponseMode = 'ack' | 'full';

function appendQuery(endpoint: string, query: URLSearchParams): string {
  const queryString = query.toString();
  return queryString.length > 0 ? `${endpoint}?${queryString}` : endpoint;
}

function withCandidateId(endpoint: string, candidateId: string): string {
  return appendQuery(endpoint, new URLSearchParams({ candidateId }));
}

function resolveCandidateIdFromStudentKey(scheduleId: string, studentKey: string): string | null {
  const normalizedScheduleId = typeof scheduleId === 'string' ? scheduleId.trim() : '';
  const normalizedKey = typeof studentKey === 'string' ? studentKey.trim() : '';
  if (!normalizedScheduleId || !normalizedKey) {
    return null;
  }

  const prefix = `student-${normalizedScheduleId}-`;
  if (normalizedKey.startsWith(prefix)) {
    const fromPrefix = normalizedKey.slice(prefix.length).trim();
    return fromPrefix.length > 0 ? fromPrefix : null;
  }

  const parts = normalizedKey.split('-');
  const fallback = parts[parts.length - 1]?.trim();
  return fallback ? fallback : null;
}

export interface StudentSessionTransport {
  readonly paths: {
    session: (scheduleId: string, candidateId: string) => string;
    staticSession: (scheduleId: string, candidateId: string) => string;
    liveSession: (scheduleId: string, candidateId: string) => string;
    credentialRefresh: (
      scheduleId: string,
      candidateId: string,
      clientSessionId: string,
    ) => string;
    resume: (scheduleId: string, clientSessionId?: string) => string;
    precheck: (scheduleId: string) => string;
    bootstrap: (scheduleId: string) => string;
    heartbeat: (scheduleId: string, responseMode?: HeartbeatResponseMode) => string;
    audit: (scheduleId: string) => string;
  };
  readonly resolveCandidateIdFromStudentKey: (
    scheduleId: string,
    studentKey: string,
  ) => string | null;
}

export const studentSessionTransport: StudentSessionTransport = {
  paths: {
    session: (scheduleId, candidateId) => withCandidateId(`/v1/student/sessions/${scheduleId}`, candidateId),
    staticSession: (scheduleId, candidateId) =>
      withCandidateId(`/v1/student/sessions/${scheduleId}/static`, candidateId),
    liveSession: (scheduleId, candidateId) =>
      withCandidateId(`/v1/student/sessions/${scheduleId}/live`, candidateId),
    credentialRefresh: (scheduleId, candidateId, clientSessionId) =>
      appendQuery(
        `/v1/student/sessions/${scheduleId}`,
        new URLSearchParams({
          candidateId,
          refreshAttemptCredential: 'true',
          clientSessionId,
        }),
      ),
    resume: (scheduleId, clientSessionId) => {
      const params = new URLSearchParams({ refreshAttemptCredential: 'true' });
      if (clientSessionId) params.set('clientSessionId', clientSessionId);
      return appendQuery(`/v1/student/sessions/${scheduleId}`, params);
    },
    precheck: (scheduleId) => `/v1/student/sessions/${scheduleId}/precheck`,
    bootstrap: (scheduleId) => `/v1/student/sessions/${scheduleId}/bootstrap`,
    heartbeat: (scheduleId, responseMode) =>
      appendQuery(
        `/v1/student/sessions/${scheduleId}/heartbeat`,
        responseMode ? new URLSearchParams({ responseMode }) : new URLSearchParams(),
      ),
    audit: (scheduleId) => `/v1/student/sessions/${scheduleId}/audit`,
  },
  resolveCandidateIdFromStudentKey,
};
