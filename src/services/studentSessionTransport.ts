type HeartbeatResponseMode = 'ack' | 'full';

function appendQuery(endpoint: string, query: URLSearchParams): string {
  const queryString = query.toString();
  return queryString.length > 0 ? `${endpoint}?${queryString}` : endpoint;
}

function withCandidateAndSession(endpoint: string, candidateId: string, clientSessionId?: string | null): string {
  const query = new URLSearchParams({ candidateId });
  if (clientSessionId) query.set('clientSessionId', clientSessionId);
  return appendQuery(endpoint, query);
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
    session: (scheduleId: string, candidateId: string, clientSessionId?: string) => string;
    /**
     * clientSessionId presents this browser's writer identity: a SAT
     * single-writer attempt serves protected content only to its owner.
     */
    staticSession: (scheduleId: string, candidateId: string, clientSessionId?: string | null) => string;
    liveSession: (scheduleId: string, candidateId: string) => string;
    credentialRefresh: (
      scheduleId: string,
      candidateId: string,
      clientSessionId: string,
    ) => string;
    resume: (scheduleId: string, clientSessionId: string) => string;
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
    session: (scheduleId, candidateId, clientSessionId) => {
      const query = new URLSearchParams({ candidateId });
      if (clientSessionId) query.set('clientSessionId', clientSessionId);
      return appendQuery(`/v1/student/sessions/${scheduleId}`, query);
    },
    staticSession: (scheduleId, candidateId, clientSessionId) =>
      withCandidateAndSession(`/v1/student/sessions/${scheduleId}/static`, candidateId, clientSessionId),
    liveSession: (scheduleId, candidateId) =>
      withCandidateAndSession(`/v1/student/sessions/${scheduleId}/live`, candidateId),
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
      params.set('clientSessionId', clientSessionId);
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
