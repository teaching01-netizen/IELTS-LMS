import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mapBackendStudentAttempt,
  resetStudentAttemptPendingMutationIndexedDbForTests,
  studentAttemptRepository,
} from '../studentAttemptRepository';
import type { StudentAttemptMutation } from '../../types/studentAttempt';

const originalFetch = global.fetch;

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function createDeferredResponse() {
  let resolve: ((value: Response) => void) | null = null;
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

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function jsonConflict(reason: string, message = 'Conflict') {
  return new Response(
    JSON.stringify({
      success: false,
      error: { code: 'CONFLICT', message, details: { reason } },
      metadata: { requestId: 'req-test', timestamp: '2026-01-01T00:00:00.000Z' },
    }),
    {
      status: 409,
      headers: { 'content-type': 'application/json' },
    },
  );
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

  it('submits the browser-local final answer snapshot with the terminal submit request', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          schedule: buildSchedule(),
          version: buildVersion(),
          runtime: null,
          attempt: buildBackendAttempt(),
          attemptCredential: buildAttemptCredential(),
          degradedLiveMode: false,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          attempt: buildBackendAttempt({
            phase: 'post-exam',
            answers: { q1: 'A' },
            writingAnswers: { task1: '<p>Draft</p>' },
            flags: { q1: true },
            finalSubmission: {
              submissionId: 'submission-1',
              submittedAt: '2026-01-01T10:00:00.000Z',
              answers: { q1: 'A' },
              writingAnswers: { task1: '<p>Draft</p>' },
              flags: { q1: true },
            },
            submittedAt: '2026-01-01T10:00:00.000Z',
            updatedAt: '2026-01-01T10:00:00.000Z',
            revision: 2,
          }),
          submissionId: 'submission-1',
          submittedAt: '2026-01-01T10:00:00.000Z',
          refreshedAttemptCredential: null,
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

    const localFinalAttempt = {
      ...attempt,
      answers: { q1: 'A' },
      writingAnswers: { task1: '<p>Draft</p>' },
      flags: { q1: true },
    };

    await studentAttemptRepository.submitAttempt(localFinalAttempt);

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/student/sessions/sched-1/submit',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      attemptId: attempt.id,
      lastSeenRevision: 1,
      submissionId: `student-submit-${attempt.id}`,
    });
  });

  it('flushes pending mutations through the backend before saving the local cache', async () => {
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
      jsonResponse({
        attempt: buildBackendAttempt({
          answers: { q1: 'A' },
          updatedAt: '2026-01-01T09:01:00.000Z',
          revision: 2,
        }),
        appliedMutationCount: 1,
        serverAcceptedThroughSeq: 1,
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

    const mutations: StudentAttemptMutation[] = [
      {
        id: 'mutation-1',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: '2026-01-01T09:00:30.000Z',
        type: 'answer',
        payload: { questionId: 'q1', value: 'A' },
      },
    ];

    await studentAttemptRepository.savePendingMutations(attempt.id, mutations);
    await studentAttemptRepository.saveAttempt({
      ...attempt,
      answers: { q1: 'A' },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/student/sessions/sched-1/mutations:batch',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual(
      expect.objectContaining({
        attemptId: attempt.id,
        mutations: [
          expect.objectContaining({
            mutationId: 'mutation-1',
            type: 'SetScalar',
            questionId: 'q1',
            value: 'A',
            baseRevision: 1,
          }),
        ],
      }),
    );
    expect(await studentAttemptRepository.getPendingMutations(attempt.id)).toEqual([]);

    await studentAttemptRepository.clearPendingMutations(attempt.id);
    const cachedAttempts = await studentAttemptRepository.getAttemptsByScheduleId('sched-1');
    expect(cachedAttempts[0]?.answers).toEqual({ q1: 'A' });
  });

  it('serializes concurrent saveAttempt flushes for the same attempt to avoid duplicate mutation batches', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    const deferredBatch = createDeferredResponse();
    let mutationBatchCallCount = 0;
    let resolveFirstBatchCall: (() => void) | null = null;
    const firstBatchCalled = new Promise<void>((resolve) => {
      resolveFirstBatchCall = resolve;
    });

    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/v1/student/sessions/sched-1/bootstrap') {
        return Promise.resolve(
          jsonResponse({
            schedule: buildSchedule(),
            version: buildVersion(),
            runtime: null,
            attempt: buildBackendAttempt(),
            attemptCredential: buildAttemptCredential(),
            degradedLiveMode: false,
          }),
        );
      }
      if (url === '/api/v1/student/sessions/sched-1/mutations:batch') {
        mutationBatchCallCount += 1;
        if (mutationBatchCallCount === 1) {
          resolveFirstBatchCall?.();
          return deferredBatch.promise;
        }
        return Promise.resolve(
          jsonResponse({
            attempt: buildBackendAttempt({
              answers: { q1: 'A' },
              updatedAt: '2026-01-01T09:01:00.000Z',
              revision: 2,
            }),
            appliedMutationCount: 1,
            serverAcceptedThroughSeq: 1,
          }),
        );
      }
      throw new Error(`Unexpected URL in test: ${url}`);
    });
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

    const firstSave = studentAttemptRepository.saveAttempt({
      ...attempt,
      answers: { q1: 'A' },
    });
    await firstBatchCalled;

    const secondSave = studentAttemptRepository.saveAttempt({
      ...attempt,
      answers: { q1: 'A' },
    });

    deferredBatch.resolve(
      jsonResponse({
        attempt: buildBackendAttempt({
          answers: { q1: 'A' },
          updatedAt: '2026-01-01T09:01:00.000Z',
          revision: 2,
        }),
        appliedMutationCount: 1,
        serverAcceptedThroughSeq: 1,
      }),
    );

    await Promise.all([firstSave, secondSave]);

    expect(mutationBatchCallCount).toBe(1);
    expect(await studentAttemptRepository.getPendingMutations(attempt.id)).toEqual([]);
  });

  it('maps an explicitly cleared slot to a ClearSlot command', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          schedule: buildSchedule(),
          version: buildVersion(),
          runtime: null,
          attempt: buildBackendAttempt(),
          attemptCredential: buildAttemptCredential(),
          degradedLiveMode: false,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          attempt: buildBackendAttempt({
            answers: { 'q-slot': ['cat', ''] },
            updatedAt: '2026-01-01T09:01:00.000Z',
            revision: 2,
          }),
          appliedMutationCount: 1,
          serverAcceptedThroughSeq: 1,
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

    await studentAttemptRepository.savePendingMutations(attempt.id, [
      {
        id: 'mutation-clear-slot',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: '2026-01-01T09:00:30.000Z',
        type: 'answer',
        payload: {
          questionId: 'q-slot',
          slotIndex: 1,
          value: ['cat', ''],
        },
      },
    ]);

    await studentAttemptRepository.saveAttempt({
      ...attempt,
      answers: { 'q-slot': ['cat', ''] },
    });

    const payload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(payload.mutations).toEqual([
      expect.objectContaining({
        mutationId: 'mutation-clear-slot',
        type: 'ClearSlot',
        questionId: 'q-slot',
        slotIndex: 1,
        baseRevision: 1,
      }),
    ]);
  });

  it('skips slot mutations when the targeted slot value is missing from payload', async () => {
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

    await studentAttemptRepository.savePendingMutations(attempt.id, [
      {
        id: 'mutation-missing-slot',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: '2026-01-01T09:00:30.000Z',
        type: 'answer',
        payload: {
          questionId: 'q-slot',
          slotIndex: 2,
          value: ['cat'],
        },
      },
    ]);

    await studentAttemptRepository.saveAttempt({
      ...attempt,
      answers: { 'q-slot': ['cat'] },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await studentAttemptRepository.getPendingMutations(attempt.id)).toEqual([]);
  });

  it('preserves local pending answers when an ack-only flush starts from a stale backend snapshot', async () => {
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
      jsonResponse({
        appliedMutationCount: 1,
        serverAcceptedThroughSeq: 1,
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

    await studentAttemptRepository.savePendingMutations(attempt.id, [
      {
        id: 'mutation-1',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: '2026-01-01T09:00:30.000Z',
        type: 'answer',
        payload: { questionId: 'q1', value: 'A' },
      },
    ]);

    await studentAttemptRepository.saveAttempt({
      ...attempt,
      answers: {},
      updatedAt: '2026-01-01T09:00:10.000Z',
    });

    expect(await studentAttemptRepository.getPendingMutations(attempt.id)).toEqual([]);
    const cachedAttempts = await studentAttemptRepository.getAttemptsByScheduleId('sched-1');
    expect(cachedAttempts[0]?.answers).toEqual({ q1: 'A' });
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

  it('drops stale objective mutations on SECTION_MISMATCH, retries flush, and records lastDroppedMutations', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    const metricEvents: Record<string, unknown>[] = [];
    const metricListener = (event: Event) => {
      const customEvent = event as CustomEvent<Record<string, unknown>>;
      metricEvents.push(customEvent.detail);
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          schedule: buildSchedule(),
          version: buildVersion(),
          runtime: null,
          attempt: buildBackendAttempt(),
          attemptCredential: buildAttemptCredential(),
          degradedLiveMode: false,
        }),
      )
      .mockResolvedValueOnce(jsonConflict('SECTION_MISMATCH', 'Mutation does not belong to the current section.'))
      .mockResolvedValueOnce(
        jsonResponse({
          schedule: buildSchedule(),
          version: buildVersion(),
          runtime: { status: 'live', currentSectionKey: 'reading' },
          attempt: buildBackendAttempt(),
          attemptCredential: buildAttemptCredential(),
          degradedLiveMode: false,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse({
          attempt: buildBackendAttempt({
            answers: { q1: 'A' },
            updatedAt: '2026-01-01T09:01:00.000Z',
            revision: 2,
          }),
          appliedMutationCount: 1,
          serverAcceptedThroughSeq: 1,
        }),
      );
    global.fetch = fetchMock as typeof fetch;
    window.addEventListener('student-observability-metric', metricListener as EventListener);

    try {
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

      await studentAttemptRepository.savePendingMutations(attempt.id, [
        {
          id: 'mutation-stale',
          attemptId: attempt.id,
          scheduleId: attempt.scheduleId,
          timestamp: '2026-01-01T09:00:10.000Z',
          type: 'answer',
          payload: { questionId: 'qOld', value: 'B', module: 'listening' },
        },
        {
          id: 'mutation-live',
          attemptId: attempt.id,
          scheduleId: attempt.scheduleId,
          timestamp: '2026-01-01T09:00:20.000Z',
          type: 'answer',
          payload: { questionId: 'q1', value: 'A', module: 'reading' },
        },
      ]);

      await studentAttemptRepository.saveAttempt(attempt);

      const firstBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
      expect(firstBody.mutations).toHaveLength(2);

      const secondBody = JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body));
      expect(secondBody.mutations).toHaveLength(1);
      expect(secondBody.mutations[0]).toMatchObject({
        type: 'SetScalar',
        questionId: 'q1',
        value: 'A',
      });

      const cachedAttempts = await studentAttemptRepository.getAttemptsByScheduleId('sched-1');
      const cached = cachedAttempts.find((candidate) => candidate.id === attempt.id) ?? null;
      expect(cached?.recovery.lastDroppedMutations).toMatchObject({
        count: 1,
        fromModule: 'listening',
        toModule: 'reading',
        reason: 'SECTION_MISMATCH',
      });

      const droppedMetric = metricEvents.find(
        (metric) => metric.name === 'student_attempt_dropped_mutation_total',
      );
      expect(droppedMetric).toMatchObject({
        scheduleId: 'sched-1',
        attemptId: 'attempt-1',
        endpoint: '/v1/student/sessions/sched-1/mutations:batch',
        statusCode: 409,
        reason: 'SECTION_MISMATCH',
      });
      expect(droppedMetric?.version).toEqual(expect.any(String));
      expect(droppedMetric?.syncState).toEqual(expect.any(String));
    } finally {
      window.removeEventListener('student-observability-metric', metricListener as EventListener);
    }
  });

  it('records dropped slot mutations as slot-scoped reconcile targets', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          schedule: buildSchedule(),
          version: buildVersion(),
          runtime: null,
          attempt: buildBackendAttempt(),
          attemptCredential: buildAttemptCredential(),
          degradedLiveMode: false,
        }),
      )
      .mockResolvedValueOnce(
        jsonConflict('SECTION_MISMATCH', 'Mutation does not belong to the current section.'),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          schedule: buildSchedule(),
          version: buildVersion(),
          runtime: { status: 'live', currentSectionKey: 'reading' },
          attempt: buildBackendAttempt(),
          attemptCredential: buildAttemptCredential(),
          degradedLiveMode: false,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse({
          attempt: buildBackendAttempt({
            answers: { 'q-slot': ['A', 'B'] },
            updatedAt: '2026-01-01T09:01:00.000Z',
            revision: 2,
          }),
          appliedMutationCount: 1,
          serverAcceptedThroughSeq: 1,
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

    await studentAttemptRepository.savePendingMutations(attempt.id, [
      {
        id: 'mutation-stale-slot',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: '2026-01-01T09:00:10.000Z',
        type: 'answer',
        payload: {
          questionId: 'q-slot',
          slotIndex: 1,
          value: ['A', 'LOCAL_SLOT_1'],
          module: 'listening',
        },
      },
      {
        id: 'mutation-live',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: '2026-01-01T09:00:20.000Z',
        type: 'answer',
        payload: { questionId: 'q1', value: 'A', module: 'reading' },
      },
    ]);

    await studentAttemptRepository.saveAttempt(attempt);

    const cachedAttempts = await studentAttemptRepository.getAttemptsByScheduleId('sched-1');
    const cached = cachedAttempts.find((candidate) => candidate.id === attempt.id) ?? null;

    expect(cached?.recovery.lastDroppedMutations).toMatchObject({
      count: 1,
      fromModule: 'listening',
      toModule: 'reading',
      reason: 'SECTION_MISMATCH',
      affectedAnswerSlots: [{ questionId: 'q-slot', slotIndex: 1 }],
    });
    expect(cached?.recovery.lastDroppedMutations?.affectedAnswers ?? []).not.toContain('q-slot');
  });

  it('marks the local attempt unsynced and preserves pending mutations on ACTIVE_SESSION_SUPERSEDED', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          schedule: buildSchedule(),
          version: buildVersion(),
          runtime: null,
          attempt: buildBackendAttempt(),
          attemptCredential: buildAttemptCredential(),
          degradedLiveMode: false,
        }),
      )
      .mockResolvedValueOnce(
        jsonConflict('ACTIVE_SESSION_SUPERSEDED', 'Another active session already holds write ownership.'),
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

    const pendingMutation: StudentAttemptMutation = {
      id: 'mutation-1',
      attemptId: attempt.id,
      scheduleId: attempt.scheduleId,
      timestamp: '2026-01-01T09:00:30.000Z',
      type: 'answer',
      payload: { questionId: 'q1', value: 'A' },
    };
    await studentAttemptRepository.savePendingMutations(attempt.id, [pendingMutation]);

    await expect(
      studentAttemptRepository.saveAttempt({
        ...attempt,
        answers: { q1: 'A' },
      }),
    ).rejects.toThrow();

    expect(await studentAttemptRepository.getPendingMutations(attempt.id)).toEqual([pendingMutation]);

    const cachedAttempts = await studentAttemptRepository.getAttemptsByScheduleId('sched-1');
    expect(cachedAttempts[0]?.recovery.syncState).toBe('error');
  });

  it('refreshes attempt credentials and retries once on 401 during mutation flush', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');

    const fetchMock = vi.fn()
      // bootstrap
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
              serverAcceptedThroughSeq: 0,
              clientSessionId: 'client-1',
              syncState: 'idle',
            },
          }),
          attemptCredential: buildAttemptCredential('attempt-token-1'),
          degradedLiveMode: false,
        }),
      )
      // first mutation flush attempt -> 401
      .mockResolvedValueOnce(jsonError(401, 'Unauthorized'))
      // credential refresh
      .mockResolvedValueOnce(
        jsonResponse({
          attempt: buildBackendAttempt(),
          attemptCredential: buildAttemptCredential('attempt-token-2'),
        }),
      )
      // retry mutation flush -> success
      .mockResolvedValueOnce(
        jsonResponse({
          attempt: buildBackendAttempt({
            answers: { q1: 'A' },
            updatedAt: '2026-01-01T09:01:00.000Z',
            revision: 2,
          }),
          appliedMutationCount: 1,
          serverAcceptedThroughSeq: 1,
          refreshedAttemptCredential: null,
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

    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calledUrls).toContain('/api/v1/student/sessions/sched-1/mutations:batch');
    expect(calledUrls.some((url) => url.includes('/api/v1/student/sessions/sched-1?'))).toBe(true);
  });

  it('keeps the browser-local clientSessionId when backend attempt payload conflicts', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');

    const clientSessionStorageKey = 'ielts-student-client-session:v1:sched-1:student-sched-1-alice';
    const localClientSessionId = 'local-client-1';
    sessionStorage.setItem(clientSessionStorageKey, localClientSessionId);

    let lastMutationBatchBody: any = null;
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
      )
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        lastMutationBatchBody = init?.body ? JSON.parse(String(init.body)) : null;
        return jsonResponse({
          attempt: buildBackendAttempt({
            updatedAt: '2026-01-01T09:01:00.000Z',
            revision: 2,
            recovery: {
              lastRecoveredAt: null,
              lastLocalMutationAt: null,
              lastPersistedAt: '2026-01-01T09:01:00.000Z',
              pendingMutationCount: 0,
              serverAcceptedThroughSeq: 6,
              clientSessionId: 'backend-client-1',
              syncState: 'saved',
            },
          }),
          appliedMutationCount: 1,
          serverAcceptedThroughSeq: 6,
          refreshedAttemptCredential: null,
        });
      });
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

    expect(lastMutationBatchBody.mutations[0].baseRevision).toBe(1);
  });

  it('resumes mutation sequences from stored browser watermarks after a module reload', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');

    const clientSessionStorageKey = 'ielts-student-client-session:v1:sched-1:student-sched-1-alice';
    const localClientSessionId = 'local-client-2';
    sessionStorage.setItem(clientSessionStorageKey, localClientSessionId);

    let callCount = 0;
    let firstMutationBody: any = null;
    let secondMutationBody: any = null;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      callCount += 1;

      if (callCount === 1) {
        return jsonResponse({
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
              clientSessionId: 'backend-client-2',
              syncState: 'idle',
            },
          }),
          attemptCredential: buildAttemptCredential('attempt-token-1'),
          degradedLiveMode: false,
        });
      }

      const parsedBody = init?.body ? JSON.parse(String(init.body)) : null;
      if (callCount === 2) {
        firstMutationBody = parsedBody;
        return jsonResponse({
          attempt: buildBackendAttempt({
            answers: { q1: 'A' },
            updatedAt: '2026-01-01T09:01:00.000Z',
            revision: 2,
            recovery: {
              lastRecoveredAt: null,
              lastLocalMutationAt: null,
              lastPersistedAt: '2026-01-01T09:01:00.000Z',
              pendingMutationCount: 0,
              serverAcceptedThroughSeq: 6,
              clientSessionId: 'backend-client-2',
              syncState: 'saved',
            },
          }),
          appliedMutationCount: 1,
          serverAcceptedThroughSeq: 6,
          refreshedAttemptCredential: null,
        });
      }

      if (callCount === 3) {
        secondMutationBody = parsedBody;
        return jsonResponse({
          attempt: buildBackendAttempt({
            answers: { q1: 'A', q2: 'B' },
            updatedAt: '2026-01-01T09:02:00.000Z',
            revision: 3,
            recovery: {
              lastRecoveredAt: null,
              lastLocalMutationAt: null,
              lastPersistedAt: '2026-01-01T09:02:00.000Z',
              pendingMutationCount: 0,
              serverAcceptedThroughSeq: 7,
              clientSessionId: 'backend-client-2',
              syncState: 'saved',
            },
          }),
          appliedMutationCount: 1,
          serverAcceptedThroughSeq: 7,
          refreshedAttemptCredential: null,
        });
      }

      throw new Error(`Unexpected fetch call ${callCount}`);
    });
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

    expect(firstMutationBody.mutations[0].baseRevision).toBe(1);
    expect(sessionStorage.getItem(
      `ielts-student-mutation-watermark:v1:${attempt.id}:${localClientSessionId}`,
    )).toBe('6');

    vi.resetModules();
    const reloadedModule = await import('../studentAttemptRepository');
    const reloadedRepo = reloadedModule.studentAttemptRepository;

    await reloadedRepo.savePendingMutations(attempt.id, [
      {
        id: 'mutation-2',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: '2026-01-01T09:01:30.000Z',
        type: 'answer',
        payload: { questionId: 'q2', value: 'B' },
      } satisfies StudentAttemptMutation,
    ]);
    await reloadedRepo.saveAttempt(attempt);

    expect(secondMutationBody.mutations[0].baseRevision).toBe(1);
  });

  it('starts mutation sequences from the backend recovery watermark', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
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
              serverAcceptedThroughSeq: 7,
              clientSessionId: 'client-1',
              syncState: 'idle',
            },
          }),
          attemptCredential: buildAttemptCredential(),
          degradedLiveMode: false,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          attempt: buildBackendAttempt({
            answers: { q1: 'A' },
            updatedAt: '2026-01-01T09:01:00.000Z',
            revision: 2,
          }),
          appliedMutationCount: 1,
          serverAcceptedThroughSeq: 8,
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

    await studentAttemptRepository.savePendingMutations(attempt.id, [
      {
        id: 'mutation-1',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: '2026-01-01T09:00:30.000Z',
        type: 'answer',
        payload: { questionId: 'q1', value: 'A' },
      },
    ]);

    await studentAttemptRepository.saveAttempt({
      ...attempt,
      answers: { q1: 'A' },
    });

    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(body.mutations[0]?.baseRevision).toBe(1);
  });

  it('sends the server-issued attempt bearer token on mutation and heartbeat calls, then rotates it from refresh responses', async () => {
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
            answers: { q1: 'A' },
            updatedAt: '2026-01-01T09:01:00.000Z',
            revision: 2,
          }),
          appliedMutationCount: 1,
          serverAcceptedThroughSeq: 1,
          refreshedAttemptCredential: {
            attemptToken: 'attempt-token-2',
            expiresAt: '2026-01-01T09:20:00.000Z',
          },
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
            attemptToken: 'attempt-token-3',
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

    await studentAttemptRepository.savePendingMutations(attempt.id, [
      {
        id: 'mutation-1',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: '2026-01-01T09:00:30.000Z',
        type: 'answer',
        payload: { questionId: 'q1', value: 'A' },
      },
    ]);
    await studentAttemptRepository.saveAttempt({
      ...attempt,
      answers: { q1: 'A' },
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
    expect(fetchMock.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer attempt-token-2',
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
