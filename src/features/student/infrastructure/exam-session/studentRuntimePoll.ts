// Student runtime poll client (plan C1/C3): the versioned poll that replaces
// student WebSockets. GET /api/v1/student/sessions/{scheduleId}/runtime with
// ?sinceRevision=: 304 (or same-revision 200) means steady state — no refresh
// needed. The server's pollAfterSecs drives the adaptive cadence (2s
// fast-lane within 60s of a control command, 25s steady). HTTP 410
// STUDENT_WS_RETIRED is terminal (never retry-storm a retired surface).

export interface StudentRuntimePollView {
  revision: number;
  status: string;
  activeSection: string | null;
  pollAfterSecs: number;
  notModified: boolean;
}

export interface StudentRuntimePollError extends Error {
  terminal?: boolean;
  status?: number;
}

interface FetchJsonResult {
  status: number;
  json: unknown;
}

export interface StudentRuntimePollInput {
  readonly scheduleId: string;
  readonly fetchJson: (path: string) => Promise<FetchJsonResult>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export interface StudentRuntimePoll {
  poll(sinceRevision: number): Promise<StudentRuntimePollView>;
}

export function createStudentRuntimePoll(input: StudentRuntimePollInput): StudentRuntimePoll {
  return {
    async poll(sinceRevision: number): Promise<StudentRuntimePollView> {
      const path =
        `/api/v1/student/sessions/${encodeURIComponent(input.scheduleId)}` +
        `/runtime?sinceRevision=${encodeURIComponent(String(sinceRevision))}`;
      const res = await input.fetchJson(path);
      if (res.status === 304) {
        return {
          revision: sinceRevision,
          status: '',
          activeSection: null,
          pollAfterSecs: 25,
          notModified: true,
        };
      }
      if (res.status === 410) {
        const err = new Error('Student live channel is retired; runtime poll is authoritative.') as StudentRuntimePollError;
        err.terminal = true;
        err.status = 410;
        throw err;
      }
      if (res.status < 200 || res.status >= 300) {
        const err = new Error(`Runtime poll failed with status ${res.status}.`) as StudentRuntimePollError;
        err.status = res.status;
        throw err;
      }
      const body = asRecord(res.json) ?? {};
      const revision = finiteNumber(body['revision'], sinceRevision);
      return {
        revision,
        status: typeof body['status'] === 'string' ? (body['status'] as string) : '',
        activeSection:
          typeof body['activeSection'] === 'string' ? (body['activeSection'] as string) : null,
        pollAfterSecs: finiteNumber(body['pollAfterSecs'], 25),
        notModified: revision === sinceRevision,
      };
    },
  };
}
