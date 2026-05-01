import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthSessionProvider } from '../../../auth/authSession';
import { authService, type AuthSession } from '../../../../services/authService';
import {
  mapBackendStudentAttempt,
  studentAttemptRepository,
} from '../../../../services/studentAttemptRepository';
import { useStudentSessionRouteData } from '../useStudentSessionRouteData';

const originalFetch = global.fetch;

function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AuthSessionProvider>{children}</AuthSessionProvider>;
  };
}

function buildAuthSession(): AuthSession {
  return {
    user: {
      id: 'student-user-1',
      email: 'alice@example.com',
      displayName: 'Alice Roe',
      role: 'student',
      state: 'active',
    },
    csrfToken: 'csrf-1',
    expiresAt: '2026-01-01T12:00:00.000Z',
  };
}

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function createDeferredResponse() {
  let resolve: ((response: Response) => void) | null = null;
  const promise = new Promise<Response>((resolver) => {
    resolve = resolver;
  });

  return {
    promise,
    resolve(response: Response) {
      resolve?.(response);
    },
  };
}

function buildStaticSessionContext(versionId = 'ver-1') {
  return {
    schedule: {
      id: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      publishedVersionId: versionId,
      cohortName: 'Cohort A',
      institution: 'Center',
      startTime: '2026-01-01T09:00:00.000Z',
      endTime: '2026-01-01T12:00:00.000Z',
      plannedDurationMinutes: 180,
      deliveryMode: 'proctor_start',
      recurrenceType: 'none',
      recurrenceInterval: 1,
      autoStart: false,
      autoStop: false,
      status: 'live',
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: 'admin-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
      revision: 1,
    },
    version: {
      id: versionId,
      examId: 'exam-1',
      versionNumber: 1,
      parentVersionId: null,
      contentSnapshot: {
        title: 'Mock Exam',
        type: 'Academic',
        activeModule: 'reading',
        activePassageId: 'p1',
        activeListeningPartId: 'l1',
        config: {
          general: { preset: 'Academic' },
          sections: {
            listening: { enabled: true, order: 1, duration: 30, label: 'Listening', gapAfterMinutes: 0 },
            reading: { enabled: true, order: 2, duration: 60, label: 'Reading', gapAfterMinutes: 0 },
            writing: { enabled: true, order: 3, duration: 60, label: 'Writing', gapAfterMinutes: 0 },
            speaking: { enabled: true, order: 4, duration: 30, label: 'Speaking', gapAfterMinutes: 0 },
          },
          delivery: { allowedExtensionMinutes: [] },
        },
        reading: { passages: [] },
        listening: { parts: [] },
        writing: { task1Prompt: 'Task 1', task2Prompt: 'Task 2' },
        speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
      },
      configSnapshot: {
        general: { preset: 'Academic' },
        sections: {
          listening: { enabled: true, order: 1, duration: 30, label: 'Listening', gapAfterMinutes: 0 },
          reading: { enabled: true, order: 2, duration: 60, label: 'Reading', gapAfterMinutes: 0 },
          writing: { enabled: true, order: 3, duration: 60, label: 'Writing', gapAfterMinutes: 0 },
          speaking: { enabled: true, order: 4, duration: 30, label: 'Speaking', gapAfterMinutes: 0 },
        },
        delivery: { allowedExtensionMinutes: [] },
      },
      createdBy: 'owner-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      isDraft: false,
      isPublished: true,
      revision: 1,
    },
    degradedLiveMode: false,
  };
}

function buildRuntime() {
  return {
    id: 'runtime-1',
    scheduleId: 'sched-1',
    examId: 'exam-1',
    status: 'live',
    planSnapshot: [],
    actualStartAt: '2026-01-01T09:00:00.000Z',
    actualEndAt: null,
    activeSectionKey: 'reading',
    currentSectionKey: 'reading',
    currentSectionRemainingSeconds: 1200,
    waitingForNextSection: false,
    isOverrun: false,
    totalPausedSeconds: 0,
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt: '2026-01-01T09:00:00.000Z',
    revision: 1,
    sections: [
      {
        id: 'section-1',
        runtimeId: 'runtime-1',
        sectionKey: 'reading',
        label: 'Reading',
        sectionOrder: 2,
        plannedDurationMinutes: 60,
        gapAfterMinutes: 0,
        status: 'live',
        availableAt: '2026-01-01T09:00:00.000Z',
        actualStartAt: '2026-01-01T09:00:00.000Z',
        actualEndAt: null,
        pausedAt: null,
        accumulatedPausedSeconds: 0,
        extensionMinutes: 0,
        completionReason: null,
        projectedStartAt: '2026-01-01T09:00:00.000Z',
        projectedEndAt: '2026-01-01T10:00:00.000Z',
      },
    ],
  };
}

function buildAttempt(publishedVersionId = 'ver-1') {
  return {
    id: 'attempt-1',
    scheduleId: 'sched-1',
    registrationId: null,
    studentKey: 'student-sched-1-W250334',
    organizationId: null,
    examId: 'exam-1',
    publishedVersionId,
    examTitle: 'Mock Exam',
    candidateId: 'W250334',
    candidateName: 'Student One',
    candidateEmail: 'student@example.com',
    phase: 'exam',
    currentModule: 'reading',
    currentQuestionId: null,
    answers: {},
    writingAnswers: {},
    flags: {},
    violationsSnapshot: [],
    integrity: {
      preCheck: null,
      deviceFingerprintHash: null,
      lastDisconnectAt: null,
      lastReconnectAt: null,
      lastHeartbeatAt: null,
      lastHeartbeatStatus: 'idle',
    },
    recovery: {
      lastRecoveredAt: null,
      lastLocalMutationAt: null,
      lastPersistedAt: null,
      pendingMutationCount: 0,
      syncState: 'idle',
    },
    finalSubmission: null,
    submittedAt: null,
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt: '2026-01-01T09:00:00.000Z',
    revision: 1,
  };
}

function buildLiveSessionContext(
  attempt: Record<string, unknown> | null,
  publishedVersionId: string | null = 'ver-1',
  rollout: Record<string, unknown> | null = null,
) {
  return {
    runtime: buildRuntime(),
    attempt,
    publishedVersionId,
    rollout,
    degradedLiveMode: false,
  };
}

function buildBootstrapContext(attempt = buildAttempt()) {
  return {
    attempt,
    attemptCredential: {
      attemptToken: 'attempt-token-1',
      expiresAt: '2026-01-01T10:00:00.000Z',
    },
  };
}

describe('useStudentSessionRouteData backend mode', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('hydrates static exam payload once, then uses live session payload for runtime and attempt', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    vi.spyOn(authService, 'getSession').mockResolvedValue(buildAuthSession());
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(buildStaticSessionContext()))
      .mockResolvedValueOnce(jsonResponse(buildLiveSessionContext(null)))
      .mockResolvedValueOnce(jsonResponse(buildBootstrapContext(buildAttempt())))
      .mockResolvedValue(jsonResponse(buildLiveSessionContext(buildAttempt())));
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData('sched-1', 'W250334'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.attemptSnapshot).not.toBeNull();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.schedule).toMatchObject({
      id: 'sched-1',
      examTitle: 'Mock Exam',
      cohortName: 'Cohort A',
    });
    expect(result.current.state?.title).toBe('Mock Exam');
    expect(result.current.runtimeSnapshot).toMatchObject({
      scheduleId: 'sched-1',
      status: 'live',
      currentSectionKey: 'reading',
    });
    expect(result.current.attemptSnapshot).toMatchObject({
      id: 'attempt-1',
      candidateId: 'W250334',
      scheduleId: 'sched-1',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/student/sessions/sched-1/static?candidateId=W250334',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/student/sessions/sched-1/live?candidateId=W250334',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/student/sessions/sched-1/bootstrap',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(
      fetchMock.mock.calls.some(
        ([url]) => url === '/api/v1/student/sessions/sched-1?candidateId=W250334',
      ),
    ).toBe(false);
  });

  it('uses the reconciled cached attempt snapshot after saving a live backend attempt', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    vi.spyOn(authService, 'getSession').mockResolvedValue(buildAuthSession());

    const backendAttempt = buildAttempt('ver-1');
    backendAttempt.revision = 9;
    backendAttempt.answers = { q1: 'SERVER_RAW' };
    backendAttempt.updatedAt = '2026-01-01T09:10:00.000Z';
    const mappedAttempt = mapBackendStudentAttempt(backendAttempt);
    const reconciledAttempt = {
      ...mappedAttempt,
      answers: { q1: 'RECONCILED_LOCAL' },
      updatedAt: '2026-01-01T09:10:01.000Z',
    };

    vi.spyOn(studentAttemptRepository as any, 'saveAttempt').mockResolvedValue(undefined);
    vi.spyOn(studentAttemptRepository as any, 'getAttemptsByScheduleId').mockResolvedValue([
      reconciledAttempt,
    ]);

    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/student/sessions/sched-1/static?candidateId=W250334') {
        return Promise.resolve(jsonResponse(buildStaticSessionContext()));
      }
      if (url === '/api/v1/student/sessions/sched-1/live?candidateId=W250334') {
        return Promise.resolve(jsonResponse(buildLiveSessionContext(backendAttempt)));
      }
      return Promise.resolve(jsonResponse(buildBootstrapContext(buildAttempt())));
    });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData('sched-1', 'W250334'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await waitFor(() => {
      expect(result.current.attemptSnapshot?.answers.q1).toBe('RECONCILED_LOCAL');
      expect(result.current.attemptSnapshot?.revision).toBe(9);
    });
  });

  it('waits for auth session hydration before bootstrapping the backend student attempt', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');

    let resolveSession: ((session: AuthSession | null) => void) | null = null;
    vi.spyOn(authService, 'getSession').mockImplementation(
      () =>
        new Promise<AuthSession | null>((resolve) => {
          resolveSession = resolve;
        }),
    );

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(buildStaticSessionContext()))
      .mockResolvedValueOnce(jsonResponse(buildLiveSessionContext(null)))
      .mockResolvedValueOnce(jsonResponse(buildBootstrapContext(buildAttempt())))
      .mockResolvedValue(jsonResponse(buildLiveSessionContext(buildAttempt())));
    global.fetch = fetchMock as typeof fetch;

    renderHook(() => useStudentSessionRouteData('sched-1', 'W250334'), {
      wrapper: createWrapper(),
    });

    expect(fetchMock).not.toHaveBeenCalled();

    resolveSession?.(buildAuthSession());

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        '/api/v1/student/sessions/sched-1/static?candidateId=W250334',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/v1/student/sessions/sched-1/live?candidateId=W250334',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        '/api/v1/student/sessions/sched-1/bootstrap',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('discards stale out-of-order refresh responses and keeps the newest snapshot', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    vi.spyOn(authService, 'getSession').mockResolvedValue(buildAuthSession());
    const metricEvents: Record<string, unknown>[] = [];
    const metricListener = (event: Event) => {
      const customEvent = event as CustomEvent<Record<string, unknown>>;
      metricEvents.push(customEvent.detail);
    };
    let cachedAttempt: Record<string, unknown> | null = null;
    vi.spyOn(studentAttemptRepository as any, 'saveAttempt').mockImplementation(async (attempt) => {
      cachedAttempt = attempt as Record<string, unknown>;
    });
    vi.spyOn(studentAttemptRepository as any, 'getAttemptsByScheduleId').mockImplementation(async () => {
      return cachedAttempt ? [cachedAttempt] : [];
    });

    const buildAttemptRevision = (revision: number, answer: string, updatedAt: string) => ({
      ...buildAttempt('ver-1'),
      revision,
      answers: { q1: answer },
      updatedAt,
    });

    const olderRefresh = createDeferredResponse();
    const newerRefresh = createDeferredResponse();
    let liveCallCount = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/student/sessions/sched-1/static?candidateId=W250334') {
        return Promise.resolve(jsonResponse(buildStaticSessionContext()));
      }
      if (url === '/api/v1/student/sessions/sched-1/live?candidateId=W250334') {
        liveCallCount += 1;
        if (liveCallCount === 1) {
          return Promise.resolve(
            jsonResponse(
              buildLiveSessionContext(
                buildAttemptRevision(1, 'INITIAL', '2026-01-01T09:00:00.000Z'),
              ),
            ),
          );
        }
        if (liveCallCount === 2) {
          return olderRefresh.promise;
        }
        if (liveCallCount === 3) {
          return newerRefresh.promise;
        }
        return Promise.resolve(
          jsonResponse(
            buildLiveSessionContext(
              buildAttemptRevision(3, 'LATEST', '2026-01-01T09:00:03.000Z'),
            ),
          ),
        );
      }
      return Promise.resolve(jsonResponse(buildBootstrapContext(buildAttempt())));
    });
    global.fetch = fetchMock as typeof fetch;

    window.addEventListener('student-observability-metric', metricListener as EventListener);
    try {
      const { result } = renderHook(() => useStudentSessionRouteData('sched-1', 'W250334'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
        expect(result.current.attemptSnapshot?.revision).toBe(1);
      });

      const firstRefresh = result.current.refreshRuntime();
      const secondRefresh = result.current.refreshRuntime();

      newerRefresh.resolve(
        jsonResponse(
          buildLiveSessionContext(buildAttemptRevision(3, 'LATEST', '2026-01-01T09:00:03.000Z')),
        ),
      );
      await act(async () => {
        await secondRefresh;
      });

      olderRefresh.resolve(
        jsonResponse(
          buildLiveSessionContext(buildAttemptRevision(2, 'STALE', '2026-01-01T09:00:02.000Z')),
        ),
      );
      await act(async () => {
        await firstRefresh;
      });

      await waitFor(() => {
        expect(result.current.attemptSnapshot?.revision).toBe(3);
        expect(result.current.attemptSnapshot?.answers.q1).toBe('LATEST');
      });

      const staleDiscardMetric = metricEvents.find(
        (metric) =>
          metric.name === 'student_refresh_stale_discard_total' &&
          metric.reason === 'epoch_superseded',
      );
      expect(staleDiscardMetric).toMatchObject({
        scheduleId: 'sched-1',
        attemptId: 'attempt-1',
        endpoint: '/v1/student/sessions/sched-1/live',
        statusCode: 200,
        reason: 'epoch_superseded',
        syncState: 'idle',
      });
      expect(staleDiscardMetric?.version).toEqual(expect.any(String));
    } finally {
      window.removeEventListener('student-observability-metric', metricListener as EventListener);
    }
  });

  it('applies fresher attempt snapshots even when runtime freshness regresses', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    vi.spyOn(authService, 'getSession').mockResolvedValue(buildAuthSession());

    const initialAttempt = {
      ...buildAttempt('ver-1'),
      revision: 1,
      answers: { q1: 'INITIAL' },
      updatedAt: '2026-01-01T09:00:01.000Z',
    };
    const initialLive = buildLiveSessionContext(initialAttempt);
    initialLive.runtime = {
      ...buildRuntime(),
      revision: 10,
      updatedAt: '2026-01-01T09:00:10.000Z',
      currentSectionKey: 'reading',
      activeSectionKey: 'reading',
    };

    const fresherAttemptWithOlderRuntime = {
      ...buildAttempt('ver-1'),
      revision: 2,
      answers: { q1: 'SERVER_FRESH_ATTEMPT' },
      updatedAt: '2026-01-01T09:00:02.000Z',
    };
    const regressedRuntimeLive = buildLiveSessionContext(fresherAttemptWithOlderRuntime);
    regressedRuntimeLive.runtime = {
      ...buildRuntime(),
      revision: 9,
      updatedAt: '2026-01-01T09:00:09.000Z',
      currentSectionKey: 'writing',
      activeSectionKey: 'writing',
    };

    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/student/sessions/sched-1/static?candidateId=W250334') {
        return Promise.resolve(jsonResponse(buildStaticSessionContext()));
      }
      if (url === '/api/v1/student/sessions/sched-1/live?candidateId=W250334') {
        if (fetchMock.mock.calls.filter(([calledUrl]) => calledUrl === url).length <= 1) {
          return Promise.resolve(jsonResponse(initialLive));
        }
        return Promise.resolve(jsonResponse(regressedRuntimeLive));
      }
      return Promise.resolve(jsonResponse(buildBootstrapContext(buildAttempt())));
    });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData('sched-1', 'W250334'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await waitFor(() => {
      expect(result.current.attemptSnapshot?.revision).toBe(2);
      expect(result.current.attemptSnapshot?.answers.q1).toBe('SERVER_FRESH_ATTEMPT');
    });
    expect(result.current.runtimeSnapshot?.currentSectionKey).toBe('reading');
  });

  it('does not apply a revisionless attempt snapshot over an already-applied revisioned snapshot', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    vi.spyOn(authService, 'getSession').mockResolvedValue(buildAuthSession());

    const initialAttempt = {
      ...buildAttempt('ver-1'),
      revision: 10,
      answers: { q1: 'REVISION_10' },
      updatedAt: '2026-01-01T09:00:10.000Z',
    };

    const revisionlessAttempt = {
      ...buildAttempt('ver-1'),
      answers: { q1: 'REVISIONLESS_STALE' },
      updatedAt: '2026-01-01T09:00:20.000Z',
    };
    delete (revisionlessAttempt as { revision?: unknown }).revision;

    let liveCallCount = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/student/sessions/sched-1/static?candidateId=W250334') {
        return Promise.resolve(jsonResponse(buildStaticSessionContext()));
      }
      if (url === '/api/v1/student/sessions/sched-1/live?candidateId=W250334') {
        liveCallCount += 1;
        if (liveCallCount === 1) {
          return Promise.resolve(jsonResponse(buildLiveSessionContext(initialAttempt)));
        }
        return Promise.resolve(jsonResponse(buildLiveSessionContext(revisionlessAttempt)));
      }
      return Promise.resolve(jsonResponse(buildBootstrapContext(buildAttempt())));
    });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData('sched-1', 'W250334'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.attemptSnapshot?.answers.q1).toBe('REVISION_10');
      expect(result.current.attemptSnapshot?.revision).toBe(10);
    });

    await act(async () => {
      await result.current.refreshRuntime();
    });

    await waitFor(() => {
      expect(result.current.attemptSnapshot?.answers.q1).toBe('REVISION_10');
      expect(result.current.attemptSnapshot?.revision).toBe(10);
    });
  });

  it('uses cached local attempt when live payload temporarily omits attempt instead of immediately bootstrapping', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    vi.spyOn(authService, 'getSession').mockResolvedValue(buildAuthSession());

    const cachedAttempt = mapBackendStudentAttempt({
      ...buildAttempt('ver-1'),
      revision: 7,
      answers: { q1: 'CACHED_LOCAL' },
      updatedAt: '2026-01-01T09:07:00.000Z',
    });
    vi
      .spyOn(studentAttemptRepository as any, 'getAttemptsByScheduleId')
      .mockResolvedValue([cachedAttempt]);

    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/student/sessions/sched-1/static?candidateId=W250334') {
        return Promise.resolve(jsonResponse(buildStaticSessionContext()));
      }
      if (url === '/api/v1/student/sessions/sched-1/live?candidateId=W250334') {
        return Promise.resolve(jsonResponse(buildLiveSessionContext(null)));
      }
      return Promise.resolve(jsonResponse(buildBootstrapContext(buildAttempt())));
    });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData('sched-1', 'W250334'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.attemptSnapshot?.answers.q1).toBe('CACHED_LOCAL');
      expect(result.current.attemptSnapshot?.revision).toBe(7);
    });

    expect(
      fetchMock.mock.calls.some(([url, init]) => {
        return (
          url === '/api/v1/student/sessions/sched-1/bootstrap' &&
          (init as { method?: string } | undefined)?.method === 'POST'
        );
      }),
    ).toBe(false);
  });

  it('reads runtime-delivered rollout canary and kill-switch flags for answer invariant behavior', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    vi.spyOn(authService, 'getSession').mockResolvedValue(buildAuthSession());

    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/student/sessions/sched-1/static?candidateId=W250334') {
        return Promise.resolve(jsonResponse(buildStaticSessionContext()));
      }
      if (url === '/api/v1/student/sessions/sched-1/live?candidateId=W250334') {
        return Promise.resolve(
          jsonResponse(
            buildLiveSessionContext(buildAttempt('ver-1'), 'ver-1', {
              localWriterAnswerInvariantEnabled: false,
              localWriterAnswerInvariantKillSwitch: true,
              localWriterAnswerInvariantCohort: 'legacy-control',
              localWriterAnswerInvariantConfigFingerprint: 'cfg-legacy-control',
            }),
          ),
        );
      }
      return Promise.resolve(jsonResponse(buildBootstrapContext(buildAttempt())));
    });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData('sched-1', 'W250334'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.answerInvariantRollout).toMatchObject({
      enabled: false,
      killSwitch: true,
      cohort: 'legacy-control',
      configFingerprint: 'cfg-legacy-control',
      source: 'runtime',
    });
  });

  it('re-bootstrap static payload when live publishedVersionId changes', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    vi.spyOn(authService, 'getSession').mockResolvedValue(buildAuthSession());
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(buildStaticSessionContext('ver-1')))
      .mockResolvedValueOnce(jsonResponse(buildLiveSessionContext(buildAttempt('ver-2'), 'ver-2')))
      .mockResolvedValueOnce(jsonResponse(buildStaticSessionContext('ver-2')))
      .mockResolvedValueOnce(jsonResponse(buildLiveSessionContext(buildAttempt('ver-2'), 'ver-2')))
      .mockResolvedValue(jsonResponse(buildLiveSessionContext(buildAttempt('ver-2'), 'ver-2')));
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData('sched-1', 'W250334'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.attemptSnapshot?.publishedVersionId).toBe('ver-2');
    });

    const staticCalls = fetchMock.mock.calls.filter(
      ([url]) => url === '/api/v1/student/sessions/sched-1/static?candidateId=W250334',
    );
    const liveCalls = fetchMock.mock.calls.filter(
      ([url]) => url === '/api/v1/student/sessions/sched-1/live?candidateId=W250334',
    );

    expect(staticCalls.length).toBeGreaterThanOrEqual(2);
    expect(liveCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects non-wcode student ids and never calls the backend session API', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    vi.spyOn(authService, 'getSession').mockResolvedValue(buildAuthSession());
    const fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData('sched-1', 'alice'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toMatch(/invalid access code/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
