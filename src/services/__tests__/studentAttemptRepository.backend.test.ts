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

function appliedMutationResult(mutationId: string, serverSeq: number, appliedRevision: number) {
  return { mutationId, status: 'applied' as const, serverSeq, appliedRevision };
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

  it('builds submit payload with finalAnswerPatch and sequence metadata', async () => {
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
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual(
      expect.objectContaining({
        attemptId: attempt.id,
        lastSeenRevision: 1,
        submissionId: `student-submit-${attempt.id}`,
        clientFinalSeq: 0,
        serverAcceptedThroughSeq: 0,
        finalAnswerPatch: {
          answers: { q1: 'A' },
          writingAnswers: { task1: '<p>Draft</p>' },
          flags: { q1: true },
        },
        finalClientSnapshotHash: expect.any(String),
      }),
    );
  });

  it('hashes canonical finalAnswerPatch JSON before submit', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    const digestMock = vi.fn().mockResolvedValue(new Uint8Array(32).buffer);
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        randomUUID: () => '00000000-0000-4000-8000-000000000001',
        subtle: {
          digest: digestMock,
        },
      },
    });

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
            answers: { q2: 'B', q1: 'A' },
            writingAnswers: { task2: '<p>Task2</p>', task1: '<p>Task1</p>' },
            flags: { q2: false, q1: true },
            finalSubmission: {
              submissionId: 'submission-1',
              submittedAt: '2026-01-01T10:00:00.000Z',
              answers: { q2: 'B', q1: 'A' },
              writingAnswers: { task2: '<p>Task2</p>', task1: '<p>Task1</p>' },
              flags: { q2: false, q1: true },
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
      answers: { q2: 'B', q1: 'A' },
      writingAnswers: { task2: '<p>Task2</p>', task1: '<p>Task1</p>' },
      flags: { q2: false, q1: true },
    };

    await studentAttemptRepository.submitAttempt(localFinalAttempt);

    expect(digestMock).toHaveBeenCalledTimes(1);
    const digestInput = digestMock.mock.calls[0]?.[1] as ArrayBuffer;
    const canonicalJson = new TextDecoder().decode(digestInput);
    expect(canonicalJson).toBe(
      '{"answers":{"q1":"A","q2":"B"},"flags":{"q1":true,"q2":false},"writingAnswers":{"task1":"<p>Task1</p>","task2":"<p>Task2</p>"}}',
    );
  });

  it('omits finalClientSnapshotHash when SHA-256 is unavailable', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        randomUUID: () => '00000000-0000-4000-8000-000000000002',
      },
    });

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

    await studentAttemptRepository.submitAttempt({
      ...attempt,
      answers: { q1: 'A' },
      writingAnswers: { task1: '<p>Draft</p>' },
      flags: { q1: true },
    });

    const payload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(payload.finalClientSnapshotHash).toBeUndefined();
    expect(payload.finalAnswerPatch).toEqual({
      answers: { q1: 'A' },
      writingAnswers: { task1: '<p>Draft</p>' },
      flags: { q1: true },
    });
  });

  it('retries submit once when backend requires final flush metadata', async () => {
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
        jsonConflict(
          'FINAL_FLUSH_REQUIRED',
          'Submit requires final flush metadata (clientFinalSeq or finalAnswerPatch).',
        ),
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

    await studentAttemptRepository.submitAttempt({
      ...attempt,
      answers: { q1: 'A' },
      writingAnswers: { task1: '<p>Draft</p>' },
      flags: { q1: true },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/student/sessions/sched-1/submit',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/student/sessions/sched-1/submit',
      expect.objectContaining({ method: 'POST' }),
    );
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
        mutationResults: [appliedMutationResult('mutation-1', 1, 2)],
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
          }),
        ],
      }),
    );
    expect(await studentAttemptRepository.getPendingMutations(attempt.id)).toEqual([]);

    await studentAttemptRepository.clearPendingMutations(attempt.id);
    const cachedAttempts = await studentAttemptRepository.getAttemptsByScheduleId('sched-1');
    expect(cachedAttempts[0]?.answers).toEqual({ q1: 'A' });
  });

  it('persists flag and unflag mutations across later answer flushes and refresh hydration', async () => {
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
            flags: { q20: true },
            updatedAt: '2026-01-01T09:01:00.000Z',
            revision: 2,
          }),
          appliedMutationCount: 1,
          serverAcceptedThroughSeq: 1,
          mutationResults: [appliedMutationResult('mutation-flag-q20', 1, 2)],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          attempt: buildBackendAttempt({
            answers: { q12: 'A' },
            flags: { q20: true },
            updatedAt: '2026-01-01T09:02:00.000Z',
            revision: 3,
          }),
          appliedMutationCount: 1,
          serverAcceptedThroughSeq: 2,
          mutationResults: [appliedMutationResult('mutation-answer-q12', 2, 3)],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          attempt: buildBackendAttempt({
            answers: { q12: 'A' },
            flags: { q20: false },
            updatedAt: '2026-01-01T09:03:00.000Z',
            revision: 4,
          }),
          appliedMutationCount: 1,
          serverAcceptedThroughSeq: 3,
          mutationResults: [appliedMutationResult('mutation-unflag-q20', 3, 4)],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          attempt: buildBackendAttempt({
            answers: { q12: 'A' },
            flags: { q20: false },
            updatedAt: '2026-01-01T09:03:00.000Z',
            revision: 4,
          }),
          attemptCredential: buildAttemptCredential(),
          runtime: null,
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
        id: 'mutation-flag-q20',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: '2026-01-01T09:00:30.000Z',
        type: 'flag',
        payload: { questionId: 'q20', value: true },
      },
    ]);
    await studentAttemptRepository.saveAttempt({
      ...attempt,
      flags: { q20: true },
    });

    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).mutations).toEqual([
      {
        mutationId: 'mutation-flag-q20',
        type: 'SetFlag',
        questionId: 'q20',
        value: true,
      },
    ]);
    let cachedAttempt = (await studentAttemptRepository.getAttemptsByScheduleId('sched-1'))[0];
    expect(cachedAttempt?.flags.q20).toBe(true);

    await studentAttemptRepository.savePendingMutations(attempt.id, [
      {
        id: 'mutation-answer-q12',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: '2026-01-01T09:01:30.000Z',
        type: 'answer',
        payload: { questionId: 'q12', value: 'A' },
      },
    ]);
    await studentAttemptRepository.saveAttempt({
      ...cachedAttempt!,
      answers: { q12: 'A' },
    });

    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)).mutations).toEqual([
      {
        mutationId: 'mutation-answer-q12',
        type: 'SetScalar',
        questionId: 'q12',
        value: 'A',
      },
    ]);
    cachedAttempt = (await studentAttemptRepository.getAttemptsByScheduleId('sched-1'))[0];
    expect(cachedAttempt?.recovery.serverAcceptedThroughSeq).toBe(2);
    expect(cachedAttempt?.flags.q20).toBe(true);

    await studentAttemptRepository.savePendingMutations(attempt.id, [
      {
        id: 'mutation-unflag-q20',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: '2026-01-01T09:02:30.000Z',
        type: 'flag',
        payload: { questionId: 'q20', value: false },
      },
    ]);
    await studentAttemptRepository.saveAttempt({
      ...cachedAttempt!,
      flags: { q20: false },
    });

    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)).mutations).toEqual([
      {
        mutationId: 'mutation-unflag-q20',
        type: 'SetFlag',
        questionId: 'q20',
        value: false,
      },
    ]);

    const refreshedAttempt = await studentAttemptRepository.getAttemptByScheduleId(
      'sched-1',
      'student-sched-1-alice',
    );
    expect(refreshedAttempt?.flags.q20).toBe(false);

    cachedAttempt = (await studentAttemptRepository.getAttemptsByScheduleId('sched-1'))[0];
    expect(cachedAttempt?.flags.q20).toBe(false);
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
            mutationResults: [appliedMutationResult('mutation-1', 1, 2)],
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
        mutationResults: [appliedMutationResult('mutation-1', 1, 2)],
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
          mutationResults: [appliedMutationResult('mutation-clear-slot', 1, 2)],
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
      }),
    ]);
  });

  it('keeps an unencodable slot answer durable instead of pretending it was saved', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      schedule: buildSchedule(), version: buildVersion(), runtime: null,
      attempt: buildBackendAttempt(), attemptCredential: buildAttemptCredential(), degradedLiveMode: false,
    }));
    global.fetch = fetchMock as typeof fetch;

    const attempt = await studentAttemptRepository.createAttempt({
      scheduleId: 'sched-1', studentKey: 'student-sched-1-alice', examId: 'exam-1', examTitle: 'Mock Exam',
      candidateId: 'alice', candidateName: 'Alice Roe', candidateEmail: 'alice@example.com', currentModule: 'reading',
    });
    const mutation: StudentAttemptMutation = {
      id: 'mutation-missing-slot', attemptId: attempt.id, scheduleId: attempt.scheduleId,
      timestamp: '2026-01-01T09:00:30.000Z', type: 'answer',
      payload: { questionId: 'q-slot', slotIndex: 2, value: ['cat'] },
    };
    await studentAttemptRepository.savePendingMutations(attempt.id, [mutation]);

    await expect(studentAttemptRepository.saveAttempt({ ...attempt, answers: { 'q-slot': ['cat'] } }))
      .rejects.toThrow('durable queue was preserved');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await studentAttemptRepository.getPendingMutations(attempt.id)).toEqual([mutation]);
  });

  it('preserves the durable answer when the server omits per-mutation acknowledgement', async () => {
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

    await expect(studentAttemptRepository.saveAttempt({
      ...attempt,
      answers: {},
      updatedAt: '2026-01-01T09:00:10.000Z',
    })).rejects.toThrow('was not acknowledged by the server');

    expect((await studentAttemptRepository.getPendingMutations(attempt.id)).map((mutation) => mutation.id))
      .toEqual(['mutation-1']);
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

  it('preserves every pending answer when the proctor advances sections before acknowledgement', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        schedule: buildSchedule(), version: buildVersion(), runtime: null,
        attempt: buildBackendAttempt(), attemptCredential: buildAttemptCredential(), degradedLiveMode: false,
      }))
      .mockResolvedValueOnce(jsonConflict('SECTION_MISMATCH', 'Mutation does not belong to the current section.'));
    global.fetch = fetchMock as typeof fetch;

    const attempt = await studentAttemptRepository.createAttempt({
      scheduleId: 'sched-1', studentKey: 'student-sched-1-alice', examId: 'exam-1', examTitle: 'Mock Exam',
      candidateId: 'alice', candidateName: 'Alice Roe', candidateEmail: 'alice@example.com', currentModule: 'reading',
    });
    const pending: StudentAttemptMutation[] = [
      { id: 'mutation-stale', attemptId: attempt.id, scheduleId: attempt.scheduleId, timestamp: '2026-01-01T09:00:10.000Z', type: 'answer', payload: { questionId: 'qOld', value: 'B', module: 'listening' } },
      { id: 'mutation-live', attemptId: attempt.id, scheduleId: attempt.scheduleId, timestamp: '2026-01-01T09:00:20.000Z', type: 'answer', payload: { questionId: 'q1', value: 'A', module: 'reading' } },
    ];
    await studentAttemptRepository.savePendingMutations(attempt.id, pending);

    await expect(studentAttemptRepository.saveAttempt(attempt)).rejects.toMatchObject({ statusCode: 409 });
    expect(await studentAttemptRepository.getPendingMutations(attempt.id)).toEqual(pending);
    const cached = (await studentAttemptRepository.getAttemptsByScheduleId('sched-1'))[0];
    expect(cached?.answers).toMatchObject({ qOld: 'B', q1: 'A' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('drops only server-proven stale section mutations and continues flushing the live section', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        schedule: buildSchedule(), version: buildVersion(), runtime: null,
        attempt: buildBackendAttempt(), attemptCredential: buildAttemptCredential(), degradedLiveMode: false,
      }))
      .mockResolvedValueOnce(jsonConflict('SECTION_MISMATCH', 'Mutation does not belong to the current section.'))
      .mockResolvedValueOnce(jsonResponse({
        schedule: buildSchedule(), version: buildVersion(),
        runtime: { status: 'live', currentSectionKey: 'reading' },
        attempt: buildBackendAttempt({ answers: { qOld: 'SERVER' }, revision: 2 }),
        attemptCredential: buildAttemptCredential(), degradedLiveMode: false,
      }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({
        attempt: buildBackendAttempt({ answers: { qOld: 'SERVER', q1: 'A' }, revision: 3 }),
        appliedMutationCount: 1,
        serverAcceptedThroughSeq: 1,
        mutationResults: [appliedMutationResult('mutation-live', 1, 3)],
      }));
    global.fetch = fetchMock as typeof fetch;

    const attempt = await studentAttemptRepository.createAttempt({
      scheduleId: 'sched-1', studentKey: 'student-sched-1-alice', examId: 'exam-1', examTitle: 'Mock Exam',
      candidateId: 'alice', candidateName: 'Alice Roe', candidateEmail: 'alice@example.com', currentModule: 'reading',
    });
    const pending: StudentAttemptMutation[] = [
      { id: 'mutation-stale', attemptId: attempt.id, scheduleId: attempt.scheduleId, timestamp: '2026-01-01T09:00:10.000Z', type: 'answer', payload: { questionId: 'qOld', value: 'LOCAL', module: 'listening' } },
      { id: 'mutation-live', attemptId: attempt.id, scheduleId: attempt.scheduleId, timestamp: '2026-01-01T09:00:20.000Z', type: 'answer', payload: { questionId: 'q1', value: 'A', module: 'reading' } },
    ];
    await studentAttemptRepository.savePendingMutations(attempt.id, pending);

    await expect(studentAttemptRepository.saveAttempt(attempt)).resolves.toBeUndefined();
    expect(await studentAttemptRepository.getPendingMutations(attempt.id)).toEqual([]);
    const cached = (await studentAttemptRepository.getAttemptsByScheduleId('sched-1'))[0];
    expect(cached?.answers.qOld).toBe('SERVER');
    expect(cached?.answers.q1).toBe('A');
    expect(cached?.recovery.lastDroppedMutations).toMatchObject({
      count: 1,
      fromModule: 'listening',
      toModule: 'reading',
      reason: 'SECTION_ADVANCED',
      affectedAnswers: ['qOld'],
    });
    const mutationBatchCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url) === '/api/v1/student/sessions/sched-1/mutations:batch',
    );
    expect(mutationBatchCalls).toHaveLength(2);
  });

  it('does not infer permission to delete answers when a section mismatch has no runtime hint', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        schedule: buildSchedule(), version: buildVersion(), runtime: null,
        attempt: buildBackendAttempt(), attemptCredential: buildAttemptCredential(), degradedLiveMode: false,
      }))
      .mockResolvedValueOnce(jsonConflict('SECTION_MISMATCH', 'Mutation does not belong to the current section.'));
    global.fetch = fetchMock as typeof fetch;

    const attempt = await studentAttemptRepository.createAttempt({
      scheduleId: 'sched-1', studentKey: 'student-sched-1-alice', examId: 'exam-1', examTitle: 'Mock Exam',
      candidateId: 'alice', candidateName: 'Alice Roe', candidateEmail: 'alice@example.com', currentModule: 'reading',
    });
    const pending: StudentAttemptMutation[] = [
      { id: 'mutation-stale-runtime-null', attemptId: attempt.id, scheduleId: attempt.scheduleId, timestamp: '2026-01-01T09:00:10.000Z', type: 'answer', payload: { questionId: 'qOld', value: 'B', module: 'listening' } },
      { id: 'mutation-live-runtime-null', attemptId: attempt.id, scheduleId: attempt.scheduleId, timestamp: '2026-01-01T09:00:20.000Z', type: 'answer', payload: { questionId: 'q1', value: 'A', module: 'reading' } },
    ];
    await studentAttemptRepository.savePendingMutations(attempt.id, pending);

    await expect(studentAttemptRepository.saveAttempt(attempt)).rejects.toMatchObject({ statusCode: 409 });
    expect(await studentAttemptRepository.getPendingMutations(attempt.id)).toEqual(pending);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('preserves a slot-level answer exactly when section advancement rejects its write', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_DELIVERY', 'true');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        schedule: buildSchedule(), version: buildVersion(), runtime: null,
        attempt: buildBackendAttempt(), attemptCredential: buildAttemptCredential(), degradedLiveMode: false,
      }))
      .mockResolvedValueOnce(jsonConflict('SECTION_MISMATCH', 'Mutation does not belong to the current section.'));
    global.fetch = fetchMock as typeof fetch;

    const attempt = await studentAttemptRepository.createAttempt({
      scheduleId: 'sched-1', studentKey: 'student-sched-1-alice', examId: 'exam-1', examTitle: 'Mock Exam',
      candidateId: 'alice', candidateName: 'Alice Roe', candidateEmail: 'alice@example.com', currentModule: 'reading',
    });
    const pending: StudentAttemptMutation[] = [
      { id: 'mutation-stale-slot', attemptId: attempt.id, scheduleId: attempt.scheduleId, timestamp: '2026-01-01T09:00:10.000Z', type: 'answer', payload: { questionId: 'q-slot', slotIndex: 1, value: ['A', 'LOCAL_SLOT_1'], module: 'listening' } },
      { id: 'mutation-live', attemptId: attempt.id, scheduleId: attempt.scheduleId, timestamp: '2026-01-01T09:00:20.000Z', type: 'answer', payload: { questionId: 'q1', value: 'A', module: 'reading' } },
    ];
    await studentAttemptRepository.savePendingMutations(attempt.id, pending);

    await expect(studentAttemptRepository.saveAttempt(attempt)).rejects.toMatchObject({ statusCode: 409 });
    expect(await studentAttemptRepository.getPendingMutations(attempt.id)).toEqual(pending);
    const cached = (await studentAttemptRepository.getAttemptsByScheduleId('sched-1'))[0];
    expect(cached?.answers['q-slot']).toEqual(['A', 'LOCAL_SLOT_1']);
  });

  it('preserves pending mutations and local values when backend returns OBJECTIVE_LOCKED', async () => {
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
        jsonConflict('OBJECTIVE_LOCKED', 'Mutation does not belong to the current section.'),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          schedule: buildSchedule(),
          version: buildVersion(),
          runtime: { status: 'live', currentSectionKey: 'reading' },
          attempt: buildBackendAttempt({
            answers: { qOld: null },
            writingAnswers: { taskOld: '' },
            flags: { qFlagOld: false },
          }),
          attemptCredential: buildAttemptCredential(),
          degradedLiveMode: false,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(
        jsonResponse({
          attempt: buildBackendAttempt({
            answers: { qOld: null, q1: 'A' },
            writingAnswers: { taskOld: '', task1: 'live' },
            flags: { qFlagOld: false, q1: true },
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
        id: 'mutation-stale-answer',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: '2026-01-01T09:00:10.000Z',
        type: 'answer',
        payload: { questionId: 'qOld', value: 'LOCAL', module: 'listening' },
      },
      {
        id: 'mutation-stale-writing',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: '2026-01-01T09:00:11.000Z',
        type: 'writing_answer',
        payload: { taskId: 'taskOld', value: 'LOCAL_DRAFT', module: 'listening' },
      },
      {
        id: 'mutation-stale-flag',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: '2026-01-01T09:00:12.000Z',
        type: 'flag',
        payload: { questionId: 'qFlagOld', value: true, module: 'listening' },
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

    await expect(studentAttemptRepository.saveAttempt(attempt)).rejects.toThrow();

    const cachedAttempts = await studentAttemptRepository.getAttemptsByScheduleId('sched-1');
    const cached = cachedAttempts.find((candidate) => candidate.id === attempt.id) ?? null;
    expect(cached?.answers.qOld).toBe('LOCAL');
    expect(cached?.writingAnswers.taskOld).toBe('LOCAL_DRAFT');
    expect(cached?.flags.qFlagOld).toBe(true);
    expect(cached?.answers.q1).toBe('A');
    expect(cached?.recovery.lastDroppedMutations).toBeNull();

    const pending = await studentAttemptRepository.getPendingMutations(attempt.id);
    expect(pending.map((mutation) => mutation.id)).toEqual([
      'mutation-stale-answer',
      'mutation-stale-writing',
      'mutation-stale-flag',
      'mutation-live',
    ]);

    const mutationBatchCalls = fetchMock.mock.calls.filter(
      ([url]) => String(url) === '/api/v1/student/sessions/sched-1/mutations:batch',
    );
    expect(mutationBatchCalls).toHaveLength(1);
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
          mutationResults: [appliedMutationResult('mutation-1', 1, 2)],
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
          mutationResults: [appliedMutationResult('mutation-1', 6, 2)],
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
          mutationResults: [appliedMutationResult('mutation-1', 6, 2)],
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
          mutationResults: [appliedMutationResult('mutation-2', 7, 3)],
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
          mutationResults: [appliedMutationResult('mutation-1', 8, 2)],
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
          mutationResults: [appliedMutationResult('mutation-1', 1, 2)],
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
