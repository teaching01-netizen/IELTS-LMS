import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthSessionProvider } from '../../../auth/authSession';
import { authService, type AuthSession } from '../../../../services/authService';
import { studentAttemptRepository } from '../../../../services/studentAttemptRepository';
import { useStudentSessionRouteData } from '../useStudentSessionRouteData';
import { queryKeys } from '../../../../app/data/queryClient';

const originalFetch = global.fetch;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthSessionProvider>{children}</AuthSessionProvider>
      </QueryClientProvider>
    );
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

function buildSessionContext(attempt: Record<string, unknown> | null) {
  return {
    schedule: {
      id: 'sched-1',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      publishedVersionId: 'ver-1',
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
      id: 'ver-1',
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
    runtime: {
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
    },
    attempt,
    degradedLiveMode: false,
  };
}

function buildAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attempt-1',
    scheduleId: 'sched-1',
    registrationId: null,
    studentKey: 'student-sched-1-W250334',
    organizationId: null,
    examId: 'exam-1',
    publishedVersionId: 'ver-1',
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
    ...overrides,
  };
}

function buildSubmittedAttempt() {
  return {
    ...buildAttempt(),
    submittedAt: '2026-01-01T11:00:00.000Z',
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

  it('hydrates schedule, runtime, and attempt snapshots through the backend delivery session API', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    vi.spyOn(authService, 'getSession').mockResolvedValue(buildAuthSession());
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        schedule: buildSessionContext(null).schedule,
        version: buildSessionContext(null).version,
        degradedLiveMode: false,
      }))
      .mockResolvedValueOnce(jsonResponse({
        runtime: buildSessionContext(null).runtime,
        attempt: null,
        degradedLiveMode: false,
      }))
      .mockResolvedValueOnce(jsonResponse(buildSessionContext(buildAttempt())))
      .mockResolvedValue(jsonResponse(buildSessionContext(buildAttempt())));
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
      .mockResolvedValueOnce(jsonResponse({
        schedule: buildSessionContext(null).schedule,
        version: buildSessionContext(null).version,
        degradedLiveMode: false,
      }))
      .mockResolvedValueOnce(jsonResponse({
        runtime: buildSessionContext(null).runtime,
        attempt: null,
        degradedLiveMode: false,
      }))
      .mockResolvedValueOnce(jsonResponse(buildSessionContext(buildAttempt())))
      .mockResolvedValue(jsonResponse({
        runtime: buildSessionContext(buildAttempt()).runtime,
        attempt: buildAttempt(),
        degradedLiveMode: false,
      }));
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

  it('separates cached backend student sessions by candidate id', () => {
    expect(queryKeys.students.staticSession('sched-1', 'W250334')).not.toEqual(
      queryKeys.students.staticSession('sched-1', 'W250335'),
    );
    expect(queryKeys.students.liveSession('sched-1', 'W250334')).not.toEqual(
      queryKeys.students.liveSession('sched-1', 'W250335'),
    );
  });

  it('refetches the live backend session snapshot on each runtime refresh', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    vi.spyOn(authService, 'getSession').mockResolvedValue(buildAuthSession());

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        schedule: buildSessionContext(null).schedule,
        version: buildSessionContext(null).version,
        degradedLiveMode: false,
      }))
      .mockResolvedValueOnce(jsonResponse({
        runtime: buildSessionContext(null).runtime,
        attempt: buildSubmittedAttempt(),
        degradedLiveMode: false,
      }))
      .mockImplementation(() => Promise.resolve(jsonResponse({
        runtime: buildSessionContext(buildSubmittedAttempt()).runtime,
        attempt: buildSubmittedAttempt(),
        degradedLiveMode: false,
      })));
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData('sched-1', 'W250334'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.attemptSnapshot).not.toBeNull();
    });

    const liveCallCountBeforeRefresh = fetchMock.mock.calls.filter(
      ([url]) => url === '/api/v1/student/sessions/sched-1/live?candidateId=W250334',
    ).length;

    await act(async () => {
      await result.current.refreshRuntime();
      await result.current.refreshRuntime();
    });

    const liveCallCountAfterRefresh = fetchMock.mock.calls.filter(
      ([url]) => url === '/api/v1/student/sessions/sched-1/live?candidateId=W250334',
    ).length;
    expect(liveCallCountAfterRefresh).toBe(liveCallCountBeforeRefresh + 2);
  });

  it('hydrates attempt snapshots from the reconciled local cache when live refresh is stale', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    vi.spyOn(authService, 'getSession').mockResolvedValue(buildAuthSession());

    sessionStorage.setItem(
      'ielts_student_attempt_credentials_v1',
      JSON.stringify([
        {
          attemptId: 'attempt-1',
          scheduleId: 'sched-1',
          attemptToken: 'attempt-token-1',
          expiresAt: '2026-01-01T09:15:00.000Z',
        },
      ]),
    );
    await studentAttemptRepository.savePendingMutations('attempt-1', [
      {
        id: 'mutation-1',
        attemptId: 'attempt-1',
        scheduleId: 'sched-1',
        timestamp: '2026-01-01T09:00:30.000Z',
        type: 'answer',
        payload: { questionId: 'q1', value: 'A' },
      },
    ]);

    const fetchMock = vi.fn((url: string | URL | Request) => {
      const endpoint = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;

      if (endpoint === '/api/v1/student/sessions/sched-1/static?candidateId=W250334') {
        return Promise.resolve(jsonResponse({
          schedule: buildSessionContext(null).schedule,
          version: buildSessionContext(null).version,
          degradedLiveMode: false,
        }));
      }

      if (endpoint === '/api/v1/student/sessions/sched-1/live?candidateId=W250334') {
        return Promise.resolve(jsonResponse({
          runtime: buildSessionContext(buildAttempt({ answers: {} })).runtime,
          attempt: buildAttempt({ answers: {} }),
          degradedLiveMode: false,
        }));
      }

      if (endpoint === '/api/v1/student/sessions/sched-1/mutations:batch') {
        return Promise.resolve(jsonResponse({
          appliedMutationCount: 1,
          serverAcceptedThroughSeq: 1,
        }));
      }

      throw new Error(`Unexpected fetch call: ${endpoint}`);
    });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useStudentSessionRouteData('sched-1', 'W250334'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.attemptSnapshot).not.toBeNull();
    });

    expect(result.current.attemptSnapshot?.answers).toEqual({ q1: 'A' });
  });
});
