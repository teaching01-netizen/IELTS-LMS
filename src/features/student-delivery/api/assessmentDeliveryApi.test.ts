import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../infrastructure/assessmentDeliveryBackendGateway', () => ({
  backendPatch: vi.fn(),
  backendPost: vi.fn(),
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
} from './assessmentDeliveryApi';

const mockedPatch = vi.mocked(backendPatch);
const mockedPost = vi.mocked(backendPost);
const mockedAuthHeader = vi.mocked(tryBuildAttemptAuthorizationHeader);
const mockedExpiring = vi.mocked(isAttemptCredentialExpiringWithin);
const mockedRefresh = vi.mocked(refreshAttemptCredential);
const mockedStore = vi.mocked(storeAttemptCredential);

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
  it('stores a rotated attempt credential returned by heartbeat', async () => {
    const refreshedAttemptCredential = {
      attemptToken: 'rotated-token',
      expiresAt: '2026-08-30T05:00:00Z',
    };
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
    expect(window.sessionStorage.getItem('sat-client-session:schedule-401:attempt-401'))
      .toBe(mockedRefresh.mock.calls[0]?.[1]);
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
});
