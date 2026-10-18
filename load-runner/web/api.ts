export interface SessionResponse {
  authenticated: boolean;
  operator: { id: string };
  expiresAt: string;
  csrfToken: string;
  controller: { ready: boolean; queueHeld: { count: number; runIds: string[] } };
}

export interface SuiteSummary {
  id: string;
  title: string;
  description: string;
  family: string;
  environments: string[];
  adapter: string;
  controlOwner: string;
  parameters: string[];
  requires: string[];
  deadlineMinutes: number;
  capacity: { apiCandidates: number | null; browserCandidates: number | null; nativeProof: boolean };
  effects: string[];
  runAll: boolean;
  legacy: boolean;
  exclusionReason: string | null;
  steps: string[];
}

export interface TargetProfile {
  id: string;
  label: string;
  environment: 'isolated' | 'staging' | 'production';
  origin: string;
  revision: string;
  enabled: boolean;
  ready: boolean;
  detail: string;
}

export interface PreflightResponse {
  digest: string;
  catalogRevision: string;
  createdAt: string;
  expiresAt: string;
  mode: 'selected' | 'all';
  suites: Array<{
    suiteId: string;
    title: string;
    environment: string;
    controlOwner: string;
    requestedApiCandidates: number | null;
    requestedBrowserCandidates: number | null;
    effects: string[];
    targetId: string | null;
    deadlineMinutes: number;
  }>;
  blockers: Array<{ requirement: string; detail: string }>;
  effects: string[];
  warnings: string[];
  estimatedMaximumMinutes: number;
  confirmation: { production: boolean; syntheticFixtures: boolean };
}

export interface RunSummary {
  runId: string;
  status: string;
  admissionSequence: number;
  createdAt: string;
  updatedAt: string;
  suiteIds: string[];
  holdReason: string | null;
  result: { executed: number; passed: number; failed: number; skipped: number } | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

let csrfToken = '';

export function setCsrfToken(token: string): void {
  csrfToken = token;
}

async function request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      ...(csrfToken ? { 'x-portal-csrf': csrfToken } : {}),
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text.length > 0 ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const envelope = parsed as { error?: { code?: string; message?: string; details?: unknown } } | null;
    throw new ApiError(
      response.status,
      envelope?.error?.code ?? 'INTERNAL',
      envelope?.error?.message ?? `HTTP ${response.status}`,
      envelope?.error?.details,
    );
  }
  return parsed as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ operator: { id: string }; expiresAt: string; csrfToken: string }>('POST', '/api/v1/auth/login', {
      username,
      password,
    }),
  session: () => request<SessionResponse>('GET', '/api/v1/auth/session'),
  logout: () => request<{ ok: boolean }>('POST', '/api/v1/auth/logout', {}),
  suites: () => request<{ catalogRevision: string; suites: SuiteSummary[] }>('GET', '/api/v1/suites'),
  targets: () => request<{ productionEnabled: boolean; targets: TargetProfile[] }>('GET', '/api/v1/targets'),
  preflight: (payload: unknown) => request<PreflightResponse>('POST', '/api/v1/runs/preflight', payload),
  createRun: (payload: unknown, idempotencyKey: string) =>
    request<{ run: RunSummary; created: boolean }>('POST', '/api/v1/runs', payload, {
      'idempotency-key': idempotencyKey,
    }),
  runs: (limit = 25, cursor?: number) =>
    request<{ runs: RunSummary[]; nextCursor: number | null }>(
      'GET',
      `/api/v1/runs?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`,
    ),
  run: (runId: string) => request<Record<string, unknown>>('GET', `/api/v1/runs/${runId}`),
  cancel: (runId: string, reason?: string) =>
    request<{ run: RunSummary }>('POST', `/api/v1/runs/${runId}/cancel`, reason ? { reason } : {}),
  releaseQueue: (runIds?: string[]) =>
    request<{ released: string[]; blockers: Record<string, unknown> }>(
      'POST',
      '/api/v1/controller/release-queue',
      runIds ? { runIds } : {},
    ),
};
