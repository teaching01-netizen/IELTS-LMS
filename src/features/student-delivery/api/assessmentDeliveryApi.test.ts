import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../infrastructure/assessmentDeliveryBackendGateway', () => ({
  backendGet: vi.fn(),
  backendPatch: vi.fn(),
  backendPost: vi.fn(),
  // Shared-owner fake: mirrors `ielts-student-client-session:v1:` keying so
  // identity assertions pin the unified key instead of the retired sat- key.
  // Shared-owner fake: mirrors `ielts-student-client-session:v1:` keying so
  // identity assertions pin the unified key instead of the retired sat- key.
  // satWriterStudentKey is the real canonical derivation (single owner).
  satWriterStudentKey: (scheduleId: string, candidateId: string) =>
    `student-${scheduleId}-${candidateId}`,
  ensureClientSessionIdForStudentKey: vi.fn((scheduleId: string, studentKey: string, preferred: string | null = null) => {
    const key = `ielts-student-client-session:v1:${scheduleId}:${studentKey}`;
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const created = preferred?.trim() ? preferred.trim() : `shared-${scheduleId}-${studentKey}`;
    window.sessionStorage.setItem(key, created);
    return created;
  }),
  hasBackendStatusCode: (error: unknown, statusCode: number) => (
    typeof error === 'object'
    && error !== null
    && 'statusCode' in error
    && (error as { statusCode?: unknown }).statusCode === statusCode
  ),
  isAttemptCredentialExpiringWithin: vi.fn(),
  refreshAttemptCredential: vi.fn(),
  storeAttemptCredential: vi.fn(),
  tryBuildAttemptAuthorizationHeader: vi.fn(),
}));

import {
  backendPatch,
  backendPost,
  isAttemptCredentialExpiringWithin,
  refreshAttemptCredential,
  storeAttemptCredential,
  tryBuildAttemptAuthorizationHeader,
} from '../infrastructure/assessmentDeliveryBackendGateway';
import {
  assessmentDeliveryApi,
  configureAssessmentDeliveryAttempt,
  loadAssessmentDeliveryMedia,
  releaseAssessmentDeliveryMedia,
} from './assessmentDeliveryApi';

const mockedPatch = vi.mocked(backendPatch);
const mockedPost = vi.mocked(backendPost);
const mockedAuthHeader = vi.mocked(tryBuildAttemptAuthorizationHeader);
const mockedExpiring = vi.mocked(isAttemptCredentialExpiringWithin);
const mockedRefresh = vi.mocked(refreshAttemptCredential);
const mockedStore = vi.mocked(storeAttemptCredential);
const nativeCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const nativeRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (nativeCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', nativeCreateObjectURL);
  else Reflect.deleteProperty(URL, 'createObjectURL');
  if (nativeRevokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', nativeRevokeObjectURL);
  else Reflect.deleteProperty(URL, 'revokeObjectURL');
});

function imageResponse() {
  return { ok: true, blob: async () => new Blob(['image-bytes'], { type: 'image/png' }) };
}

function installObjectUrls() {
  let next = 0;
  const createObjectURL = vi.fn(() => `blob:media-${++next}`);
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  return { createObjectURL, revokeObjectURL };
}

function responseSnapshot() {
  return {
    id: 'response-1', moduleAttemptId: 'module-attempt', examQuestionId: 'question-1',
    response: 'A', markedForReview: false, eliminatedOptions: [], annotations: {}, revision: 1,
  };
}

describe('assessmentDeliveryApi attempt-auth transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mockedExpiring.mockReturnValue(false);
    mockedAuthHeader.mockReturnValue({ Authorization: 'Bearer current-token' });
  });

  it('loads image bytes directly with the attempt bearer', async () => {
    configureAssessmentDeliveryAttempt('schedule-media', 'attempt-media', 'candidate-media');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['image-bytes'], { type: 'image/png' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const createObjectURL = vi.fn().mockReturnValue('blob:media-image');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });

    await expect(loadAssessmentDeliveryMedia('schedule-media', 'attempt-media', 'asset-1'))
      .resolves.toBe('blob:media-image');

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/media/asset-1/content', expect.objectContaining({
      headers: { Authorization: 'Bearer current-token' },
      credentials: 'same-origin',
    }));
    expect(createObjectURL).toHaveBeenCalledOnce();
  });

  it('downloads each figure once per attempt and shares the in-flight request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse());
    vi.stubGlobal('fetch', fetchMock);
    installObjectUrls();

    const [first, concurrent] = await Promise.all([
      loadAssessmentDeliveryMedia('schedule-cache', 'attempt-cache', 'asset-1'),
      loadAssessmentDeliveryMedia('schedule-cache', 'attempt-cache', 'asset-1'),
    ]);
    const revisit = await loadAssessmentDeliveryMedia('schedule-cache', 'attempt-cache', 'asset-1');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(concurrent).toBe(first);
    expect(revisit).toBe(first);
  });

  it('downloads again and revokes the old copy when asked for fresh bytes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse());
    vi.stubGlobal('fetch', fetchMock);
    const { revokeObjectURL } = installObjectUrls();

    const first = await loadAssessmentDeliveryMedia('schedule-fresh', 'attempt-fresh', 'asset-1');
    const fresh = await loadAssessmentDeliveryMedia('schedule-fresh', 'attempt-fresh', 'asset-1', { fresh: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fresh).not.toBe(first);
    expect(revokeObjectURL).toHaveBeenCalledWith(first);
  });

  it('retries transient failures and does not remember a final failure', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 502 })
      .mockResolvedValueOnce(imageResponse());
    vi.stubGlobal('fetch', fetchMock);
    installObjectUrls();

    const failed = loadAssessmentDeliveryMedia('schedule-retry', 'attempt-retry', 'asset-1');
    const failedAssertion = expect(failed).rejects.toMatchObject({ statusCode: 502 });
    await vi.runAllTimersAsync();
    await failedAssertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await expect(loadAssessmentDeliveryMedia('schedule-retry', 'attempt-retry', 'asset-1'))
      .resolves.toMatch(/^blob:/);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not retry a figure the server says is not there', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetchMock);
    installObjectUrls();

    await expect(loadAssessmentDeliveryMedia('schedule-404', 'attempt-404', 'asset-1'))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('lets a slow body finish after the headers arrive', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return Promise.resolve({
        ok: true,
        blob: () => new Promise<Blob>((resolve) => setTimeout(() => resolve(new Blob(['x'])), 60_000)),
      });
    }));
    installObjectUrls();

    const loaded = loadAssessmentDeliveryMedia('schedule-slow', 'attempt-slow', 'asset-1');
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(loaded).resolves.toMatch(/^blob:/);
    expect(signal?.aborted).toBe(false);
  });

  it('releases every figure held for the attempt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse()));
    const { revokeObjectURL } = installObjectUrls();

    const one = await loadAssessmentDeliveryMedia('schedule-release', 'attempt-release', 'asset-1');
    const two = await loadAssessmentDeliveryMedia('schedule-release', 'attempt-release', 'asset-2');
    releaseAssessmentDeliveryMedia('schedule-release', 'attempt-release');
    await Promise.resolve();

    expect(revokeObjectURL).toHaveBeenCalledWith(one);
    expect(revokeObjectURL).toHaveBeenCalledWith(two);
  });

  it('stores a rotated attempt credential returned by heartbeat', async () => {
    const refreshedAttemptCredential = {
      attemptToken: 'rotated-token',
      expiresAt: '2026-08-30T05:00:00Z',
    };
    configureAssessmentDeliveryAttempt('schedule-heartbeat', 'attempt-heartbeat', 'candidate-heartbeat');
    mockedPost.mockResolvedValueOnce({ refreshedAttemptCredential });

    await assessmentDeliveryApi.heartbeat('schedule-heartbeat', 'attempt-heartbeat');

    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost.mock.calls[0]?.[2]).toMatchObject({
      headers: { Authorization: 'Bearer current-token' },
      retries: 0,
      skipUnauthorizedHandler: true,
    });
    expect(mockedStore).toHaveBeenCalledWith(
      { id: 'attempt-heartbeat', scheduleId: 'schedule-heartbeat' },
      refreshedAttemptCredential,
    );
  });

  it('refreshes once and retries once after an attempt-token 401', async () => {
    configureAssessmentDeliveryAttempt('schedule-401', 'attempt-401', 'candidate-401');
    mockedRefresh.mockResolvedValueOnce(true);
    mockedPatch
      .mockRejectedValueOnce({ statusCode: 401 })
      .mockResolvedValueOnce(responseSnapshot());

    await assessmentDeliveryApi.saveResponse(
      'schedule-401',
      'attempt-401',
      'question-1',
      {
        revision: 0,
        response: 'A',
        markedForReview: false,
        eliminatedOptions: [],
        annotations: {},
      },
    );

    expect(mockedRefresh).toHaveBeenCalledTimes(1);
    expect(mockedRefresh).toHaveBeenCalledWith(
      { id: 'attempt-401', scheduleId: 'schedule-401', candidateId: 'candidate-401' },
      expect.stringMatching(/.+/),
    );
    expect(
      window.sessionStorage.getItem(
        'ielts-student-client-session:v1:schedule-401:student-schedule-401-candidate-401',
      ),
    ).toBe(mockedRefresh.mock.calls[0]?.[1]);
    expect(mockedPatch).toHaveBeenCalledTimes(2);
    for (const call of mockedPatch.mock.calls) {
      expect(call[2]).toMatchObject({ retries: 0, skipUnauthorizedHandler: true });
    }
  });

  it('singleflights proactive refresh across concurrent near-expiry requests', async () => {
    configureAssessmentDeliveryAttempt('schedule-proactive', 'attempt-proactive', 'candidate-proactive');
    mockedExpiring.mockReturnValue(true);
    let releaseRefresh!: (value: boolean) => void;
    mockedRefresh.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      releaseRefresh = resolve;
    }));
    mockedPost.mockResolvedValue({ ok: true });

    const first = assessmentDeliveryApi.recordAudit(
      'schedule-proactive', 'attempt-proactive', 'HEARTBEAT', {},
    );
    const second = assessmentDeliveryApi.recordAudit(
      'schedule-proactive', 'attempt-proactive', 'NETWORK_RECONNECTED', {},
    );

    await vi.waitFor(() => expect(mockedRefresh).toHaveBeenCalledTimes(1));
    expect(mockedPost).not.toHaveBeenCalled();
    releaseRefresh(true);
    await Promise.all([first, second]);

    expect(mockedRefresh).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledTimes(2);
    for (const call of mockedPost.mock.calls) {
      expect(call[2]).toMatchObject({ retries: 0, skipUnauthorizedHandler: true });
    }
  });

  it('sends the shared owner id on heartbeat and retires the legacy sat- key', async () => {
    configureAssessmentDeliveryAttempt('schedule-shared', 'attempt-shared', 'candidate-shared');
    window.sessionStorage.setItem('sat-client-session:schedule-shared:attempt-shared', 'stale-sat-id');
    mockedPost.mockResolvedValueOnce({});

    await assessmentDeliveryApi.heartbeat('schedule-shared', 'attempt-shared');

    const body = mockedPost.mock.calls[0]?.[1] as { clientSessionId?: unknown };
    const shared = window.sessionStorage.getItem(
      'ielts-student-client-session:v1:schedule-shared:student-schedule-shared-candidate-shared',
    );
    expect(typeof shared === 'string' && shared.length > 0).toBe(true);
    expect(body.clientSessionId).toBe(shared);
    expect(window.sessionStorage.getItem('sat-client-session:schedule-shared:attempt-shared')).toBeNull();
  });

  it('prefers the attempt snapshot session id when configured', async () => {
    configureAssessmentDeliveryAttempt('schedule-pref', 'attempt-pref', 'candidate-pref', 'established-session');
    mockedPost.mockResolvedValueOnce({});

    await assessmentDeliveryApi.heartbeat('schedule-pref', 'attempt-pref');

    const body = mockedPost.mock.calls[0]?.[1] as { clientSessionId?: unknown };
    expect(body.clientSessionId).toBe('established-session');
  });

  it('refuses to invent a second identity when the attempt was never configured', async () => {
    // Exam-day re-audit defect 3: no `attempt:` fallback key may be created.
    // An unconfigured heartbeat must fail loudly, never mint a divergent id.
    mockedPost.mockResolvedValueOnce({});
    await expect(
      assessmentDeliveryApi.heartbeat('schedule-unconfigured', 'attempt-unconfigured'),
    ).rejects.toThrow('not configured');
    expect(mockedPost).not.toHaveBeenCalled();
    expect(
      window.sessionStorage.getItem(
        'ielts-student-client-session:v1:schedule-unconfigured:attempt:attempt-unconfigured',
      ),
    ).toBeNull();
  });
});
