import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mapBackendStudentAttempt,
  resetStudentAttemptPendingMutationIndexedDbForTests,
  studentAttemptRepository,
} from '../studentAttemptRepository';
import type { StudentAttemptMutation } from '../../types/studentAttempt';

const originalFetch = global.fetch;
const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function buildSchedule() {
  return {
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
    status: 'scheduled',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'admin-1',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 1,
  };
}

function buildVersion() {
  return {
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
  };
}

function buildBackendAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attempt-1',
    scheduleId: 'sched-1',
    registrationId: null,
    studentKey: 'student-sched-1-alice',
    organizationId: null,
    examId: 'exam-1',
    publishedVersionId: 'ver-1',
    examTitle: 'Mock Exam',
    candidateId: 'alice',
    candidateName: 'Alice Roe',
    candidateEmail: 'alice@example.com',
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
      clientSessionId: null,
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
      serverAcceptedThroughSeq: 0,
      clientSessionId: null,
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

function buildAttemptCredential(token = 'attempt-token-1') {
  return {
    attemptToken: token,
    expiresAt: '2026-01-01T09:15:00.000Z',
  };
}

describe('studentAttemptRepository backend mode', () => {
  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await resetStudentAttemptPendingMutationIndexedDbForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
    }
  });

  it('bootstraps a student attempt through the backend and caches it locally', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        schedule: buildSchedule(),
        version: buildVersion(),
        runtime: null,
        attempt: buildBackendAttempt(),
        attemptCredential: buildAttemptCredential(),
        degradedLiveMode: false,
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    const attempt = await studentAttemptRepository.createAttempt({
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      currentModule: 'reading',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/student/sessions/sched-1/bootstrap',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(attempt).toMatchObject({
      id: 'attempt-1',
      scheduleId: 'sched-1',
      candidateId: 'alice',
      currentModule: 'reading',
    });

    const cachedAttempts = await studentAttemptRepository.getAttemptsByScheduleId('sched-1');
    expect(cachedAttempts).toEqual([expect.objectContaining({ id: 'attempt-1' })]);
  });

  it('hydrates answers from finalSubmission when backend omits answers', () => {
    const mapped = mapBackendStudentAttempt(
      buildBackendAttempt({
        phase: 'post-exam',
        answers: null,
        writingAnswers: null,
        flags: null,
        finalSubmission: {
          submissionId: 'submission-1',
          submittedAt: '2026-01-01T10:00:00.000Z',
          answers: { q1: 'A' },
          writingAnswers: { task1: '<p>Draft</p>' },
          flags: { q1: true },
        },
        submittedAt: '2026-01-01T10:00:00.000Z',
      }),
    );

    expect(mapped.answers).toEqual({ q1: 'A' });
    expect(mapped.writingAnswers).toEqual({ task1: '<p>Draft</p>' });
    expect(mapped.flags).toEqual({ q1: true });
  });

  it('preserves newer accepted local navigation when a stale backend snapshot is saved', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        schedule: buildSchedule(),
        version: buildVersion(),
        runtime: null,
        attempt: buildBackendAttempt(),
        attemptCredential: buildAttemptCredential(),
        degradedLiveMode: false,
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    const attempt = await studentAttemptRepository.createAttempt({
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      currentModule: 'reading',
    });

    const newerAcceptedAttempt = {
      ...attempt,
      phase: 'exam' as const,
      currentModule: 'writing' as const,
      currentQuestionId: 'task1',
      answers: { q1: 'A' },
      writingAnswers: { task1: '<p>Draft</p>' },
      recovery: {
        ...attempt.recovery,
        pendingMutationCount: 0,
        serverAcceptedThroughSeq: 2,
        syncState: 'saved' as const,
      },
    };
    await studentAttemptRepository.saveAttempt(newerAcceptedAttempt);

    await studentAttemptRepository.saveAttempt({
      ...attempt,
      phase: 'lobby',
      currentModule: 'reading',
      currentQuestionId: 'q1',
      answers: {},
      writingAnswers: {},
      recovery: {
        ...attempt.recovery,
        serverAcceptedThroughSeq: 1,
      },
    });

    const cachedAttempts = await studentAttemptRepository.getAttemptsByScheduleId('sched-1');
    expect(cachedAttempts[0]).toMatchObject({
      phase: 'exam',
      currentModule: 'writing',
      currentQuestionId: 'task1',
      answers: { q1: 'A' },
      writingAnswers: { task1: '<p>Draft</p>' },
      recovery: expect.objectContaining({
        serverAcceptedThroughSeq: 2,
      }),
    });
  });

  it('keeps the browser-local clientSessionId when backend attempt payload conflicts', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');

    const clientSessionStorageKey = 'ielts-student-client-session:v1:sched-1:student-sched-1-alice';
    const localClientSessionId = 'local-client-1';
    sessionStorage.setItem(clientSessionStorageKey, localClientSessionId);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          schedule: buildSchedule(),
          version: buildVersion(),
          runtime: null,
          attempt: buildBackendAttempt({
            recovery: {
              lastRecoveredAt: null,
              lastLocalMutationAt: null,
              lastPersistedAt: null,
              pendingMutationCount: 0,
              serverAcceptedThroughSeq: 5,
              clientSessionId: 'backend-client-1',
              syncState: 'idle',
            },
          }),
          attemptCredential: buildAttemptCredential('attempt-token-1'),
          degradedLiveMode: false,
        }),
      );
    global.fetch = fetchMock as typeof fetch;

    const attempt = await studentAttemptRepository.createAttempt({
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      currentModule: 'reading',
    });

    expect(sessionStorage.getItem(clientSessionStorageKey)).toBe(localClientSessionId);

    await studentAttemptRepository.savePendingMutations(attempt.id, [
      {
        id: 'mutation-1',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: '2026-01-01T09:00:30.000Z',
        type: 'answer',
        payload: { questionId: 'q1', value: 'A' },
      } satisfies StudentAttemptMutation,
    ]);
    await studentAttemptRepository.saveAttempt(attempt);
  });

  it('sends the server-issued attempt bearer token on heartbeat calls, then rotates it from refresh responses', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          schedule: buildSchedule(),
          version: buildVersion(),
          runtime: null,
          attempt: buildBackendAttempt(),
          attemptCredential: {
            attemptToken: 'attempt-token-1',
            expiresAt: '2026-01-01T09:15:00.000Z',
          },
          degradedLiveMode: false,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          attempt: buildBackendAttempt({
            integrity: {
              preCheck: null,
              deviceFingerprintHash: null,
              lastDisconnectAt: null,
              lastReconnectAt: null,
              lastHeartbeatAt: '2026-01-01T09:02:00.000Z',
              lastHeartbeatStatus: 'ok',
            },
            updatedAt: '2026-01-01T09:02:00.000Z',
            revision: 3,
          }),
          refreshedAttemptCredential: {
            attemptToken: 'attempt-token-2',
            expiresAt: '2026-01-01T09:25:00.000Z',
          },
        }),
      );
    global.fetch = fetchMock as typeof fetch;

    const attempt = await studentAttemptRepository.createAttempt({
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      currentModule: 'reading',
    });

    await studentAttemptRepository.saveHeartbeatEvent({
      id: 'heartbeat-1',
      attemptId: attempt.id,
      scheduleId: attempt.scheduleId,
      timestamp: '2026-01-01T09:02:00.000Z',
      type: 'heartbeat',
    });

    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer attempt-token-1',
        }),
      }),
    );
  });

  it('sends heartbeat events through the backend when delivery mode is enabled', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        schedule: buildSchedule(),
        version: buildVersion(),
        runtime: null,
        attempt: buildBackendAttempt(),
        attemptCredential: buildAttemptCredential(),
        degradedLiveMode: false,
      }),
    ).mockResolvedValueOnce(
      jsonResponse(
        {
          attempt: buildBackendAttempt({
            integrity: {
              preCheck: null,
              deviceFingerprintHash: null,
              lastDisconnectAt: null,
              lastReconnectAt: null,
              lastHeartbeatAt: '2026-01-01T09:02:00.000Z',
              lastHeartbeatStatus: 'ok',
            },
            updatedAt: '2026-01-01T09:02:00.000Z',
          }),
        },
      ),
    );
    global.fetch = fetchMock as typeof fetch;

    const attempt = await studentAttemptRepository.createAttempt({
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1-alice',
      examId: 'exam-1',
      examTitle: 'Mock Exam',
      candidateId: 'alice',
      candidateName: 'Alice Roe',
      candidateEmail: 'alice@example.com',
      currentModule: 'reading',
    });

    await studentAttemptRepository.saveHeartbeatEvent({
      id: 'heartbeat-1',
      attemptId: attempt.id,
      scheduleId: attempt.scheduleId,
      timestamp: '2026-01-01T09:02:00.000Z',
      type: 'heartbeat',
      payload: { latencyMs: 120 },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/student/sessions/sched-1/heartbeat?responseMode=ack',
      expect.objectContaining({ method: 'POST' }),
    );
    const storedEvents = await studentAttemptRepository.getHeartbeatEvents(attempt.id);
    expect(storedEvents).toEqual([]);
  });

  it('surfaces backend bootstrap failures instead of silently creating a local attempt', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'delivery offline' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    ) as typeof fetch;

    await expect(
      studentAttemptRepository.createAttempt({
        scheduleId: 'sched-1',
        studentKey: 'student-sched-1-alice',
        examId: 'exam-1',
        examTitle: 'Mock Exam',
        candidateId: 'alice',
        candidateName: 'Alice Roe',
        candidateEmail: 'alice@example.com',
        currentModule: 'reading',
      }),
    ).rejects.toThrow('delivery offline');

    expect(await studentAttemptRepository.getAttemptsByScheduleId('sched-1')).toEqual([]);
  });
});
