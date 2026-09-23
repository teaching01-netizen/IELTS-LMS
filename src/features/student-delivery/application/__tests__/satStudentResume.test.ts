import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveSatResumeLocator, loadSatResumeLocator } from '../../infrastructure/satResumeLocator';

const mocks = vi.hoisted(() => ({
  backendGet: vi.fn(),
  storeAttemptCredential: vi.fn(),
  refreshAttemptCredentialForAttempt: vi.fn(),
  ensureClientSessionIdForStudentKey: vi.fn(),
  restoreClientSessionIdForStudentKey: vi.fn(),
  mapBackendStudentAttempt: vi.fn(),
}));

vi.mock('@services/backendBridge', () => ({
  backendGet: mocks.backendGet,
  hasBackendStatusCode: (error: unknown, code: number) =>
    typeof error === 'object' && error !== null &&
    ((error as { status?: number }).status === code || (error as { statusCode?: number }).statusCode === code),
}));

vi.mock('@services/studentAttemptRepository', () => ({
  ensureClientSessionIdForStudentKey: mocks.ensureClientSessionIdForStudentKey,
  restoreClientSessionIdForStudentKey: mocks.restoreClientSessionIdForStudentKey,
  satWriterStudentKey: (scheduleId: string, candidateId: string) => `student-${scheduleId}-${candidateId}`,
  mapBackendStudentAttempt: mocks.mapBackendStudentAttempt,
  refreshAttemptCredentialForAttempt: mocks.refreshAttemptCredentialForAttempt,
}));

vi.mock('@services/attemptCredentialAdapter', () => ({
  storeAttemptCredential: mocks.storeAttemptCredential,
}));

vi.mock('@services/studentSessionTransport', () => ({
  studentSessionTransport: { paths: { resume: (scheduleId: string, clientSessionId?: string) => {
    const params = new URLSearchParams({ refreshAttemptCredential: 'true' });
    if (clientSessionId) params.set('clientSessionId', clientSessionId);
    return `/v1/student/sessions/${scheduleId}?${params.toString()}`;
  } } },
}));

import { resumeSatStudentSession } from '../satStudentResume';

const activeAttempt = {
  id: 'attempt-canonical',
  scheduleId: 'schedule-1',
  candidateId: 'CANONICAL-CANDIDATE',
  studentKey: 'student-schedule-1-CANONICAL-CANDIDATE',
  phase: 'exam',
  submittedAt: null,
  proctorStatus: 'active',
  deliveryStatus: 'running',
  integrity: { clientSessionId: null },
  recovery: { clientSessionId: null },
} as never;

describe('resumeSatStudentSession', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.localStorage.clear();
    mocks.ensureClientSessionIdForStudentKey.mockImplementation((_schedule: string, key: string) => `writer:${key}`);
    mocks.restoreClientSessionIdForStudentKey.mockImplementation((_schedule: string, _key: string, writerId: string) => writerId);
    mocks.mapBackendStudentAttempt.mockImplementation((attempt: unknown) => ({
      ...activeAttempt,
      ...(attempt as object),
    }));
    mocks.refreshAttemptCredentialForAttempt.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves the authenticated user attempt and stores a matching refreshed credential', async () => {
    mocks.backendGet.mockResolvedValue({
      attempt: { ...activeAttempt },
      attemptCredential: { attemptToken: 'server-token', expiresAt: '2026-10-01T00:00:00Z' },
      clientSessionId: 'writer:student-schedule-1-CANONICAL-CANDIDATE',
      runtime: { status: 'live' },
    });
    const result = await resumeSatStudentSession({
      scheduleId: 'schedule-1',
      locator: {
        version: 1,
        providerKey: 'sat',
        scheduleId: 'schedule-1',
        candidateId: 'CANONICAL-CANDIDATE',
        attemptId: 'tampered-attempt',
        updatedAt: new Date().toISOString(),
      },
    });

    expect(mocks.backendGet).toHaveBeenCalledWith(
      '/v1/student/sessions/schedule-1?refreshAttemptCredential=true',
      { retries: 0, timeout: 8_000 },
    );
    expect(mocks.restoreClientSessionIdForStudentKey).toHaveBeenCalledWith(
      'schedule-1',
      'student-schedule-1-CANONICAL-CANDIDATE',
      'writer:student-schedule-1-CANONICAL-CANDIDATE',
    );
    expect(mocks.storeAttemptCredential).toHaveBeenCalledWith(activeAttempt, {
      attemptToken: 'server-token',
      expiresAt: '2026-10-01T00:00:00Z',
    });
    expect(result).toMatchObject({
      kind: 'resumed',
      route: '/student/schedule-1/CANONICAL-CANDIDATE',
      attempt: { id: 'attempt-canonical', candidateId: 'CANONICAL-CANDIDATE' },
    });
  });

  it('ignores a tampered stored candidate and restores the server writer identity', async () => {
    mocks.backendGet.mockResolvedValue({
      attempt: { ...activeAttempt },
      attemptCredential: { attemptToken: 'wrong-writer-token', expiresAt: '2026-10-01T00:00:00Z' },
      clientSessionId: 'writer:student-schedule-1-CANONICAL-CANDIDATE',
      runtime: { status: 'live' },
    });

    const result = await resumeSatStudentSession({
      scheduleId: 'schedule-1',
      locator: {
        version: 1,
        providerKey: 'sat',
        scheduleId: 'schedule-1',
        candidateId: 'wrong-candidate',
        updatedAt: new Date().toISOString(),
      },
    });

    expect(mocks.backendGet.mock.calls[0]?.[0]).not.toContain('candidateId');
    expect(mocks.backendGet.mock.calls[0]?.[0]).not.toContain('clientSessionId');
    expect(result).toMatchObject({ route: '/student/schedule-1/CANONICAL-CANDIDATE' });
    expect(mocks.restoreClientSessionIdForStudentKey).toHaveBeenCalledWith(
      'schedule-1',
      'student-schedule-1-CANONICAL-CANDIDATE',
      'writer:student-schedule-1-CANONICAL-CANDIDATE',
    );
    expect(mocks.refreshAttemptCredentialForAttempt).not.toHaveBeenCalled();
    expect(mocks.storeAttemptCredential).toHaveBeenCalled();
  });

  it('clears a locator only after the authenticated server reports no attempt', async () => {
    saveSatResumeLocator({ scheduleId: 'schedule-1', candidateId: 'W001', attemptId: 'a1' });
    mocks.backendGet.mockResolvedValue({ attempt: null });

    await expect(resumeSatStudentSession({ scheduleId: 'schedule-1', locator: loadSatResumeLocator() }))
      .resolves.toEqual({ kind: 'no-attempt' });
    expect(loadSatResumeLocator()).toBeNull();
  });

  it('retains a locator after auth failure or transient network/server errors', async () => {
    saveSatResumeLocator({ scheduleId: 'schedule-1', candidateId: 'W001', attemptId: 'a1' });
    mocks.backendGet.mockRejectedValueOnce({ status: 401 });
    await expect(resumeSatStudentSession({ scheduleId: 'schedule-1', locator: loadSatResumeLocator() }))
      .resolves.toEqual({ kind: 'unauthenticated' });
    expect(loadSatResumeLocator()).not.toBeNull();

    mocks.backendGet.mockRejectedValueOnce({ status: 503 });
    await expect(resumeSatStudentSession({ scheduleId: 'schedule-1', locator: loadSatResumeLocator() }))
      .resolves.toEqual({ kind: 'transient-error', reason: 'server_error' });
    expect(loadSatResumeLocator()).not.toBeNull();

    mocks.backendGet.mockRejectedValueOnce(new Error('offline'));
    await expect(resumeSatStudentSession({ scheduleId: 'schedule-1', locator: loadSatResumeLocator() }))
      .resolves.toEqual({ kind: 'transient-error', reason: 'network' });
    expect(loadSatResumeLocator()).not.toBeNull();
  });

  it('clears terminal sessions without persisting a writer credential', async () => {
    saveSatResumeLocator({ scheduleId: 'schedule-1', candidateId: 'W001', attemptId: 'a1' });
    mocks.backendGet.mockResolvedValue({
      attempt: { ...activeAttempt, submittedAt: '2026-09-23T00:00:00Z', phase: 'submitted' },
      attemptCredential: { attemptToken: 'terminal-token', expiresAt: '2026-10-01T00:00:00Z' },
      clientSessionId: 'writer:student-schedule-1-CANONICAL-CANDIDATE',
      runtime: { status: 'completed' },
    });

    await expect(resumeSatStudentSession({ scheduleId: 'schedule-1', locator: loadSatResumeLocator() }))
      .resolves.toMatchObject({ kind: 'resumed', terminal: true });
    expect(loadSatResumeLocator()).toBeNull();
    expect(mocks.storeAttemptCredential).not.toHaveBeenCalled();
    expect(mocks.refreshAttemptCredentialForAttempt).not.toHaveBeenCalled();
  });
});
