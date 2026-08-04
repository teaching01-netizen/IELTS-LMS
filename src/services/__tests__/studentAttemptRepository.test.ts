import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../backendBridge', () => ({
  backendGet: vi.fn(async () => {
    throw new Error('backendGet not configured for this test');
  }),
  backendPost: vi.fn(async () => {
    throw new Error('backendPost not configured for this test');
  }),
  rememberAttemptSchedule: vi.fn(),
}));

import type { ExamSchedule } from '../../types/domain';
import type { StudentAttempt, StudentAttemptMutation } from '../../types/studentAttempt';
import {
  buildPendingStudentSubmission,
  compactSubmittedAttempt,
  ensureClientSessionIdForAttempt,
  extractFrozenSubmitPayload,
  pruneStudentAttemptCache,
  resetStudentAttemptPendingMutationIndexedDbForTests,
  shouldInvalidateFrozenPayload,
  studentLocalCachePolicy,
  studentAttemptRepository,
} from '../studentAttemptRepository';
import * as studentObservabilityModule from '../../utils/studentObservability';
import { backendGet, backendPost } from '../backendBridge';

function nowIso(): string {
  return new Date('2026-01-10T09:00:00.000Z').toISOString();
}

function makeAttempt(overrides?: Partial<StudentAttempt>): StudentAttempt {
  const timestamp = nowIso();
  return {
    id: 'attempt-1',
    scheduleId: 'schedule-1',
    studentKey: 'student-schedule-1-alice',
    examId: 'exam-1',
    examTitle: 'Exam 1',
    candidateId: 'alice',
    candidateName: 'Alice Candidate',
    candidateEmail: 'alice@example.com',
    phase: 'exam',
    currentModule: 'listening',
    currentQuestionId: null,
    answers: {},
    writingAnswers: {},
    flags: {},
    violations: [],
    proctorStatus: 'active',
    proctorNote: null,
    proctorUpdatedAt: null,
    proctorUpdatedBy: null,
    lastWarningId: null,
    lastAcknowledgedWarningId: null,
    integrity: {
      preCheck: null,
      deviceFingerprintHash: null,
      clientSessionId: 'client-session-1',
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
      clientSessionId: 'client-session-1',
      syncState: 'idle',
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function storeAttemptCredential(attempt: Pick<StudentAttempt, 'id' | 'scheduleId'>): void {
  window.sessionStorage.setItem(
    'ielts_student_attempt_credentials_v1',
    JSON.stringify([
      {
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        attemptToken: 'attempt-token-1',
        expiresAt: new Date('2026-01-10T10:00:00.000Z').toISOString(),
      },
    ]),
  );
}

function seedCachedAttempts(attempts: StudentAttempt[]): void {
  window.localStorage.setItem('ielts_student_attempts_v1', JSON.stringify(attempts));
}

async function getCachedAttempt(
  attemptId: string,
  scheduleId = 'schedule-1',
): Promise<StudentAttempt | null> {
  const attempts = await studentAttemptRepository.getAttemptsByScheduleId(scheduleId);
  return attempts.find((attempt) => attempt.id === attemptId) ?? null;
}

describe('studentAttemptRepository', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    // resetAllMocks (not clearAllMocks) also drains leftover
    // mockResolvedValueOnce/mockRejectedValueOnce queues, so a failed test
    // can never leak its queue entries into the next test.
    vi.resetAllMocks();
    vi.mocked(backendGet).mockImplementation(async () => {
      throw new Error('backendGet not configured for this test');
    });
    vi.mocked(backendPost).mockImplementation(async () => {
      throw new Error('backendPost not configured for this test');
    });
    await resetStudentAttemptPendingMutationIndexedDbForTests();
  });

  it('prunes heartbeat events to a bounded ring buffer per attempt', async () => {
    const attemptId = 'attempt-1';
    const scheduleId = 'schedule-1';

    for (let index = 0; index < 205; index += 1) {
      await studentAttemptRepository.saveHeartbeatEvent({
        id: `event-${index}`,
        attemptId,
        scheduleId,
        timestamp: new Date(2026, 0, 10, 9, 0, index).toISOString(),
        type: 'heartbeat',
        payload: { index },
      });
    }

    const events = await studentAttemptRepository.getHeartbeatEvents(attemptId);
    expect(events).toHaveLength(200);
    expect(events[0].id).toBe('event-5');
    expect(events[199].id).toBe('event-204');
  });

  it('deletes a heartbeat event from storage after a successful POST', async () => {
    const attempt = makeAttempt();
    await studentAttemptRepository.saveAttempt(attempt);
    storeAttemptCredential(attempt);

    const post = vi.mocked(backendPost);
    post.mockImplementationOnce(async (_endpoint, _body) => ({
      attempt: {
        id: attempt.id,
        scheduleId: attempt.scheduleId,
        studentKey: attempt.studentKey,
        examId: attempt.examId,
        examTitle: attempt.examTitle,
        candidateId: attempt.candidateId,
        candidateName: attempt.candidateName,
        candidateEmail: attempt.candidateEmail,
        phase: attempt.phase,
        currentModule: attempt.currentModule,
        currentQuestionId: null,
        answers: attempt.answers,
        writingAnswers: attempt.writingAnswers,
        flags: attempt.flags,
        violationsSnapshot: [],
        integrity: attempt.integrity,
        recovery: attempt.recovery,
        createdAt: attempt.createdAt,
        updatedAt: attempt.updatedAt,
      },
    }));

    await studentAttemptRepository.saveHeartbeatEvent({
      id: 'hb-1',
      attemptId: attempt.id,
      scheduleId: attempt.scheduleId,
      timestamp: nowIso(),
      type: 'disconnect',
      payload: { reason: 'test' },
    });

    const stored = await studentAttemptRepository.getHeartbeatEvents(attempt.id);
    expect(stored).toHaveLength(0);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('flushes heartbeat backlog oldest→newest and stops on first failure', async () => {
    const attempt = makeAttempt();
    await studentAttemptRepository.saveAttempt(attempt);
    storeAttemptCredential(attempt);

    const post = vi.mocked(backendPost);
    post.mockImplementation(async () => {
      throw new Error('offline');
    });

    await studentAttemptRepository.saveHeartbeatEvent({
      id: 'hb-1',
      attemptId: attempt.id,
      scheduleId: attempt.scheduleId,
      timestamp: new Date('2026-01-10T09:00:01.000Z').toISOString(),
      type: 'disconnect',
    });
    await studentAttemptRepository.saveHeartbeatEvent({
      id: 'hb-2',
      attemptId: attempt.id,
      scheduleId: attempt.scheduleId,
      timestamp: new Date('2026-01-10T09:00:02.000Z').toISOString(),
      type: 'lost',
    });
    await studentAttemptRepository.saveHeartbeatEvent({
      id: 'hb-3',
      attemptId: attempt.id,
      scheduleId: attempt.scheduleId,
      timestamp: new Date('2026-01-10T09:00:03.000Z').toISOString(),
      type: 'reconnect',
    });

    post.mockReset();
    post.mockImplementationOnce(async (_endpoint, body) => ({
      attempt: {
        id: attempt.id,
        scheduleId: attempt.scheduleId,
        studentKey: attempt.studentKey,
        examId: attempt.examId,
        examTitle: attempt.examTitle,
        candidateId: attempt.candidateId,
        candidateName: attempt.candidateName,
        candidateEmail: attempt.candidateEmail,
        phase: attempt.phase,
        currentModule: attempt.currentModule,
        currentQuestionId: null,
        answers: attempt.answers,
        writingAnswers: attempt.writingAnswers,
        flags: attempt.flags,
        violationsSnapshot: [],
        integrity: attempt.integrity,
        recovery: attempt.recovery,
        createdAt: attempt.createdAt,
        updatedAt: attempt.updatedAt,
      },
      _echo: body,
    }));
    post.mockImplementationOnce(async () => {
      throw new Error('still offline');
    });

    const flushed = await studentAttemptRepository.flushHeartbeatEvents(attempt.id);
    expect(flushed).toBe(false);

    expect(post).toHaveBeenCalledTimes(2);
    const firstPayload = post.mock.calls[0]?.[1] as { clientTimestamp?: string } | undefined;
    expect(firstPayload?.clientTimestamp).toBe('2026-01-10T09:00:01.000Z');

    const remaining = await studentAttemptRepository.getHeartbeatEvents(attempt.id);
    expect(remaining.map((event) => event.id)).toEqual(['hb-2', 'hb-3']);
  });

  it('clears pending mutations after an ack-only backend response', async () => {
    const attempt = makeAttempt({
      answers: { q1: 'A' },
      recovery: { ...makeAttempt().recovery, clientSessionId: 'client-session-2' },
      integrity: { ...makeAttempt().integrity, clientSessionId: 'client-session-2' },
    });
    await studentAttemptRepository.saveAttempt(attempt);
    storeAttemptCredential(attempt);

    await studentAttemptRepository.savePendingMutations(attempt.id, [
      {
        id: 'mutation-1',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: '2026-01-10T09:00:01.000Z',
        type: 'answer',
        payload: { questionId: 'q1', value: 'A' },
      },
    ]);

    const post = vi.mocked(backendPost);
    post.mockResolvedValueOnce({
      appliedMutationCount: 1,
      serverAcceptedThroughSeq: 1,
      revision: 2,
    });

    await studentAttemptRepository.saveAttempt(attempt);

    expect(post).toHaveBeenCalledWith(
      '/v1/student/sessions/schedule-1/mutations:batch',
      expect.objectContaining({
        attemptId: attempt.id,
        mutations: [
          expect.objectContaining({
            mutationId: 'mutation-1',
            baseRevision: 0,
            type: 'SetScalar',
            questionId: 'q1',
            value: 'A',
          }),
        ],
      }),
      expect.any(Object),
    );
    expect(await studentAttemptRepository.getPendingMutations(attempt.id)).toEqual([]);
    const cachedAttempts = await studentAttemptRepository.getAttemptsByScheduleId(attempt.scheduleId);
    expect(cachedAttempts[0]?.answers).toEqual({ q1: 'A' });
    expect(cachedAttempts[0]?.recovery.serverAcceptedThroughSeq).toBe(1);
  });

  it('skips malformed answer mutations with undefined values instead of clearing server answers', async () => {
    const attempt = makeAttempt({
      answers: { q1: 'SERVER' },
      recovery: { ...makeAttempt().recovery, clientSessionId: 'client-session-2' },
      integrity: { ...makeAttempt().integrity, clientSessionId: 'client-session-2' },
    });
    await studentAttemptRepository.saveAttempt(attempt);
    storeAttemptCredential(attempt);

    await studentAttemptRepository.savePendingMutations(attempt.id, [
      {
        id: 'mutation-malformed',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: '2026-01-10T09:00:01.000Z',
        type: 'answer',
        payload: { questionId: 'q1', value: undefined } as unknown as StudentAttemptMutation['payload'],
      } as unknown as StudentAttemptMutation,
      {
        id: 'mutation-valid',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: '2026-01-10T09:00:02.000Z',
        type: 'answer',
        payload: { questionId: 'q2', value: 'A' },
      },
    ]);

    const post = vi.mocked(backendPost);
    post.mockResolvedValueOnce({
      appliedMutationCount: 1,
      serverAcceptedThroughSeq: 1,
      revision: 1,
    });

    await studentAttemptRepository.saveAttempt(attempt);

    expect(post).toHaveBeenCalledWith(
      '/v1/student/sessions/schedule-1/mutations:batch',
      expect.objectContaining({
        attemptId: attempt.id,
        mutations: [
          expect.objectContaining({
            mutationId: 'mutation-valid',
            baseRevision: 0,
            type: 'SetScalar',
            questionId: 'q2',
            value: 'A',
          }),
        ],
      }),
      expect.any(Object),
    );
  });

  it('preserves cached local answers when local accepted sequence is newer than incoming', async () => {
    const localAttempt = makeAttempt({
      answers: { q1: 'LOCAL' },
      updatedAt: '2026-01-10T09:40:00.000Z',
      recovery: {
        ...makeAttempt().recovery,
        lastPersistedAt: '2026-01-10T09:40:00.000Z',
        serverAcceptedThroughSeq: 10,
      },
    });
    const incomingAttempt = makeAttempt({
      answers: { q1: 'SERVER_OLD' },
      updatedAt: '2026-01-10T09:45:00.000Z',
      recovery: {
        ...makeAttempt().recovery,
        lastPersistedAt: '2026-01-10T09:45:00.000Z',
        serverAcceptedThroughSeq: 3,
      },
    });
    seedCachedAttempts([localAttempt]);

    await studentAttemptRepository.saveAttempt(incomingAttempt);

    const cached = await getCachedAttempt(localAttempt.id);
    expect(cached?.answers.q1).toBe('LOCAL');
    expect(cached?.recovery.serverAcceptedThroughSeq).toBe(10);
    expect(vi.mocked(backendPost)).not.toHaveBeenCalled();
  });

  it('prefers incoming answers when accepted sequence is tied even if local timestamps are newer', async () => {
    const localAttempt = makeAttempt({
      answers: { q1: 'LOCAL_TS' },
      updatedAt: '2026-01-10T09:50:00.000Z',
      recovery: {
        ...makeAttempt().recovery,
        lastPersistedAt: '2026-01-10T09:49:00.000Z',
        serverAcceptedThroughSeq: 7,
      },
    });
    const incomingAttempt = makeAttempt({
      answers: { q1: 'SERVER_TIED_SEQ' },
      updatedAt: '2026-01-10T09:00:00.000Z',
      recovery: {
        ...makeAttempt().recovery,
        lastPersistedAt: '2026-01-10T09:00:00.000Z',
        serverAcceptedThroughSeq: 7,
      },
    });
    seedCachedAttempts([localAttempt]);

    await studentAttemptRepository.saveAttempt(incomingAttempt);

    const cached = await getCachedAttempt(localAttempt.id);
    expect(cached?.answers.q1).toBe('SERVER_TIED_SEQ');
    expect(cached?.recovery.serverAcceptedThroughSeq).toBe(7);
  });

  it('accepts incoming answers when incoming snapshot is fresher than cached local state', async () => {
    const localAttempt = makeAttempt({
      answers: { q1: 'LOCAL_OLD' },
      updatedAt: '2026-01-10T09:00:00.000Z',
      recovery: {
        ...makeAttempt().recovery,
        lastPersistedAt: '2026-01-10T09:00:00.000Z',
        serverAcceptedThroughSeq: 7,
      },
    });
    const incomingAttempt = makeAttempt({
      answers: { q1: 'SERVER_FRESH' },
      updatedAt: '2099-01-01T00:00:00.000Z',
      recovery: {
        ...makeAttempt().recovery,
        lastPersistedAt: '2099-01-01T00:00:00.000Z',
        serverAcceptedThroughSeq: 7,
      },
    });
    seedCachedAttempts([localAttempt]);

    await studentAttemptRepository.saveAttempt(incomingAttempt);

    const cached = await getCachedAttempt(localAttempt.id);
    expect(cached?.answers.q1).toBe('SERVER_FRESH');
    expect(cached?.recovery.serverAcceptedThroughSeq).toBe(7);
  });

  it('prefers incoming answers when local and incoming freshness signals are equal', async () => {
    const localAttempt = makeAttempt({
      answers: { q1: 'LOCAL_EQUAL' },
      updatedAt: '2026-01-10T09:00:00.000Z',
      recovery: {
        ...makeAttempt().recovery,
        lastPersistedAt: '2026-01-10T09:00:00.000Z',
        serverAcceptedThroughSeq: 7,
      },
    });
    const incomingAttempt = makeAttempt({
      answers: { q1: 'SERVER_EQUAL' },
      updatedAt: '2026-01-10T09:00:00.000Z',
      recovery: {
        ...makeAttempt().recovery,
        lastPersistedAt: '2026-01-10T09:00:00.000Z',
        serverAcceptedThroughSeq: 7,
      },
    });
    seedCachedAttempts([localAttempt]);

    await studentAttemptRepository.saveAttempt(incomingAttempt);

    const cached = await getCachedAttempt(localAttempt.id);
    expect(cached?.answers.q1).toBe('SERVER_EQUAL');
    expect(cached?.recovery.serverAcceptedThroughSeq).toBe(7);
  });

  it('chunks pending mutation flushes to respect server caps', async () => {
    const attempt = makeAttempt({
      phase: 'exam',
      currentModule: 'listening',
      integrity: { ...makeAttempt().integrity, clientSessionId: 'client-session-2' },
      recovery: { ...makeAttempt().recovery, clientSessionId: 'client-session-2' },
    });
    await studentAttemptRepository.saveAttempt(attempt);
    storeAttemptCredential(attempt);

    const pending: StudentAttemptMutation[] = Array.from({ length: 205 }, (_value, index) => ({
      id: `m-${index + 1}`,
      attemptId: attempt.id,
      scheduleId: attempt.scheduleId,
      timestamp: new Date(2026, 0, 10, 9, 0, index).toISOString(),
      type: 'answer',
      payload: { questionId: 'q1', value: 'A' },
    }));
    await studentAttemptRepository.savePendingMutations(attempt.id, pending);

    const post = vi.mocked(backendPost);
    post.mockImplementation(async (_endpoint, body) => {
      const payload = body as { mutations: Array<{ seq: number }> };
      const lastSeq = payload.mutations[payload.mutations.length - 1]?.seq ?? 0;
      return {
        attempt: {
          id: attempt.id,
          scheduleId: attempt.scheduleId,
          studentKey: attempt.studentKey,
          examId: attempt.examId,
          examTitle: attempt.examTitle,
          candidateId: attempt.candidateId,
          candidateName: attempt.candidateName,
          candidateEmail: attempt.candidateEmail,
          phase: attempt.phase,
          currentModule: attempt.currentModule,
          currentQuestionId: null,
          answers: attempt.answers,
          writingAnswers: attempt.writingAnswers,
          flags: attempt.flags,
          violationsSnapshot: [],
          integrity: attempt.integrity,
          recovery: attempt.recovery,
          createdAt: attempt.createdAt,
          updatedAt: attempt.updatedAt,
        },
        appliedMutationCount: payload.mutations.length,
        serverAcceptedThroughSeq: lastSeq,
      };
    });

    await studentAttemptRepository.saveAttempt(attempt);

    const callSizes = post.mock.calls.map((call) => (call[1] as { mutations: unknown[] }).mutations.length);
    expect(callSizes).toEqual([100, 100, 5]);
  });

  it('retains distinct slot-index answer mutations when pending mutations are compacted', async () => {
    const attempt = makeAttempt();
    await studentAttemptRepository.saveAttempt(attempt);

    const max = studentLocalCachePolicy.maxPendingMutationsPerAttempt;
    const baselineMutations: StudentAttemptMutation[] = Array.from(
      { length: max },
      (_value, index) => ({
        id: `m-${index}`,
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: new Date(2026, 0, 10, 9, 0, index).toISOString(),
        type: 'answer',
        payload: { questionId: `q-${index}`, value: 'A' },
      }),
    );
    const slotMutations: StudentAttemptMutation[] = [
      {
        id: 'slot-0',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: new Date(2026, 0, 10, 10, 0, 1).toISOString(),
        type: 'answer',
        payload: {
          questionId: 'blk-af811567-c9aa-4a4d-8775-44b529b499fd',
          value: ['239', 'MODERN', 'LAMP', '', '', '', '', '', '', ''],
          slotIndex: 2,
        },
      },
      {
        id: 'slot-1',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: new Date(2026, 0, 10, 10, 0, 2).toISOString(),
        type: 'answer',
        payload: {
          questionId: 'blk-af811567-c9aa-4a4d-8775-44b529b499fd',
          value: ['239', 'MODERN', 'LAMP', 'AARON', '', '', '', '', '', ''],
          slotIndex: 3,
        },
      },
    ];

    await studentAttemptRepository.savePendingMutations(attempt.id, [
      ...baselineMutations,
      ...slotMutations,
    ]);

    const stored = await studentAttemptRepository.getPendingMutations(attempt.id);
    const storedSlotMutations = stored.filter(
      (mutation) =>
        mutation.type === 'answer' &&
        mutation.payload['questionId'] === 'blk-af811567-c9aa-4a4d-8775-44b529b499fd',
    );

    expect(stored.length).toBe(max);
    expect(storedSlotMutations).toHaveLength(2);
    expect(
      storedSlotMutations
        .map((mutation) => mutation.payload['slotIndex'])
        .sort((left, right) => Number(left) - Number(right)),
    ).toEqual([2, 3]);
  });

  it('persists pending mutations via IndexedDB fallback when localStorage write fails', async () => {
    const attempt = makeAttempt();
    await studentAttemptRepository.saveAttempt(attempt);

    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    const failingSetItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === 'ielts_student_attempt_pending_mutations_v1') {
        throw new Error('quota exceeded');
      }
      return originalSetItem(key, value);
    });

    const mutation: StudentAttemptMutation = {
      id: 'mutation-idb-fallback',
      attemptId: attempt.id,
      scheduleId: attempt.scheduleId,
      timestamp: '2026-01-10T09:00:01.000Z',
      type: 'answer',
      payload: { questionId: 'q1', value: 'A' },
    };

    try {
      await expect(
        studentAttemptRepository.savePendingMutations(attempt.id, [mutation]),
      ).resolves.toBeUndefined();

      const stored = await studentAttemptRepository.getPendingMutations(attempt.id);
      expect(stored).toHaveLength(1);
      expect(stored[0]?.id).toBe('mutation-idb-fallback');
    } finally {
      failingSetItem.mockRestore();
    }
  });

  it('retains pending mutations in memory when both localStorage and IndexedDB persistence fail', async () => {
    const attempt = makeAttempt({ id: 'attempt-fallback-memory' });
    await studentAttemptRepository.saveAttempt(attempt);

    const originalIndexedDb = (
      window as Window & {
        indexedDB?: IDBFactory;
      }
    ).indexedDB;
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: undefined,
    });

    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    const failingSetItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === 'ielts_student_attempt_pending_mutations_v1') {
        throw new Error('quota exceeded');
      }
      return originalSetItem(key, value);
    });

    const mutation: StudentAttemptMutation = {
      id: 'mutation-memory-fallback',
      attemptId: attempt.id,
      scheduleId: attempt.scheduleId,
      timestamp: '2026-01-10T09:00:02.000Z',
      type: 'answer',
      payload: { questionId: 'q2', value: 'B' },
    };

    try {
      await expect(
        studentAttemptRepository.savePendingMutations(attempt.id, [mutation]),
      ).resolves.toBeUndefined();

      const restored = await studentAttemptRepository.getPendingMutations(attempt.id);
      expect(restored).toHaveLength(1);
      expect(restored[0]?.id).toBe('mutation-memory-fallback');
    } finally {
      failingSetItem.mockRestore();
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        value: originalIndexedDb,
      });
    }
  });

  it('reuses a persisted client session id when sessionStorage is cleared on mobile resume', () => {
    const attempt = makeAttempt({
      integrity: {
        ...makeAttempt().integrity,
        clientSessionId: 'client-session-stable',
      },
      recovery: {
        ...makeAttempt().recovery,
        clientSessionId: 'client-session-stable',
      },
    });

    const storageKey = `ielts-student-client-session:v1:${attempt.scheduleId}:${attempt.studentKey}`;
    window.localStorage.setItem(storageKey, 'client-session-stable');
    window.sessionStorage.removeItem(storageKey);

    const resolved = ensureClientSessionIdForAttempt(attempt);

    expect(resolved).toBe('client-session-stable');
    expect(window.sessionStorage.getItem(storageKey)).toBe('client-session-stable');
  });

  it('compacts a submitted attempt to receipt metadata when no local queues remain', async () => {
    const submitted = {
      ...makeAttempt({
      phase: 'post-exam',
      answers: { q1: 'A' },
      writingAnswers: { task1: 'Essay text' },
      submittedAt: '2026-01-10T09:30:00.000Z',
      recovery: {
        ...makeAttempt().recovery,
        serverAcceptedThroughSeq: 12,
        pendingMutationCount: 0,
        syncState: 'saved',
      },
      }),
      finalSubmission: {
        submissionId: 'submission-1',
        submittedAt: '2026-01-10T09:30:00.000Z',
        answers: { q1: 'A' },
        writingAnswers: { task1: 'Essay text' },
        flags: {},
      },
    } as StudentAttempt;

    const receipt = compactSubmittedAttempt(submitted);

    expect(receipt).toEqual({
      attemptId: 'attempt-1',
      scheduleId: 'schedule-1',
      submittedAt: '2026-01-10T09:30:00.000Z',
      submissionId: 'submission-1',
      lastServerAcceptedSeq: 12,
      compactedAt: expect.any(String),
    });
    expect(JSON.stringify(receipt)).not.toContain('Essay text');
  });

  it('prunes submitted synced attempts to receipts and purges old receipts', async () => {
    const now = new Date('2026-01-11T10:00:00.000Z');
    const submitted = {
      ...makeAttempt({
      phase: 'post-exam',
      answers: { q1: 'A' },
      submittedAt: '2026-01-10T09:30:00.000Z',
      updatedAt: '2026-01-10T09:30:00.000Z',
      recovery: {
        ...makeAttempt().recovery,
        serverAcceptedThroughSeq: 12,
        pendingMutationCount: 0,
        syncState: 'saved',
      },
      }),
      finalSubmission: {
        submissionId: 'submission-1',
        submittedAt: '2026-01-10T09:30:00.000Z',
        answers: { q1: 'A' },
        writingAnswers: {},
        flags: {},
      },
    } as StudentAttempt;
    const active = makeAttempt({
      id: 'attempt-active',
      phase: 'exam',
      answers: { q2: 'B' },
    });

    window.localStorage.setItem('ielts_student_attempts_v1', JSON.stringify([submitted, active]));

    const result = await pruneStudentAttemptCache(now, () => null);
    const storedAttempts = JSON.parse(
      window.localStorage.getItem('ielts_student_attempts_v1') ?? '[]',
    ) as StudentAttempt[];

    expect(result.compactedAttempts).toBe(1);
    expect(result.purgedReceipts).toBe(0);
    expect(storedAttempts.map((attempt) => attempt.id)).toEqual(['attempt-active']);
    expect(window.localStorage.getItem('ielts_student_attempt_receipts_v1')).toContain('submission-1');

    const later = new Date('2026-01-12T10:00:01.000Z');
    const second = await pruneStudentAttemptCache(later, () => null);

    expect(second.purgedReceipts).toBe(1);
    expect(window.localStorage.getItem('ielts_student_attempt_receipts_v1')).toBe('[]');
  });

  it('keeps unsynced attempts but purges stale unfinished attempts after the recovery window', async () => {
    const unsynced = makeAttempt({
      id: 'attempt-unsynced',
      updatedAt: '2026-01-01T09:00:00.000Z',
      recovery: {
        ...makeAttempt().recovery,
        pendingMutationCount: 1,
        syncState: 'pending',
      },
    });
    const stale = makeAttempt({
      id: 'attempt-stale',
      updatedAt: '2026-01-01T09:00:00.000Z',
      recovery: {
        ...makeAttempt().recovery,
        pendingMutationCount: 0,
        syncState: 'saved',
      },
    });

    window.localStorage.setItem('ielts_student_attempts_v1', JSON.stringify([unsynced, stale]));
    await studentAttemptRepository.savePendingMutations(unsynced.id, [
      {
        id: 'mutation-unsynced',
        attemptId: unsynced.id,
        scheduleId: unsynced.scheduleId,
        timestamp: '2026-01-01T09:00:01.000Z',
        type: 'answer',
        payload: { questionId: 'q1', value: 'A' },
      },
    ]);

    const scheduleLookup = (): Pick<ExamSchedule, 'endTime'> => ({
      endTime: '2026-01-02T09:00:00.000Z',
    });
    const result = await pruneStudentAttemptCache(
      new Date('2026-01-10T09:00:01.000Z'),
      scheduleLookup,
    );
    const storedAttempts = JSON.parse(
      window.localStorage.getItem('ielts_student_attempts_v1') ?? '[]',
    ) as StudentAttempt[];

    expect(result.purgedAttempts).toBe(1);
    expect(storedAttempts.map((attempt) => attempt.id)).toEqual(['attempt-unsynced']);
  });

  it('extracts conflict reason from ApiClientError with backendDetails', async () => {
    const { ApiClientError } = await import('../../app/api/apiClient');
    const { backendConflictReason } = await import('../studentAttemptRepository');

    const error = new ApiClientError({
      message: 'Conflict',
      statusCode: 409,
      backendCode: 'CONFLICT',
      backendDetails: { reason: 'ATTEMPT_SUBMITTED' },
      backendRequestId: 'req-1',
    });

    expect(backendConflictReason(error)).toBe('ATTEMPT_SUBMITTED');
  });

  it('returns null for errors without conflict reason', async () => {
    const { ApiClientError } = await import('../../app/api/apiClient');
    const { backendConflictReason } = await import('../studentAttemptRepository');

    const error = new ApiClientError({
      message: 'Bad Request',
      statusCode: 400,
      backendCode: 'VALIDATION_ERROR',
      backendDetails: {},
      backendRequestId: 'req-1',
    });

    expect(backendConflictReason(error)).toBeNull();
  });

  it('extracts conflict reason from plain object with backendDetails', async () => {
    const { backendConflictReason } = await import('../studentAttemptRepository');

    const error = {
      backendDetails: { reason: 'FINAL_FLUSH_REQUIRED' },
    };

    expect(backendConflictReason(error)).toBe('FINAL_FLUSH_REQUIRED');
  });

  it('builds a pending submission with a deterministic identity and a frozen final snapshot', () => {
    const attempt = makeAttempt({
      answers: { q1: 'FINAL_ANSWER' },
      writingAnswers: { task1: 'FINAL DRAFT' },
      flags: { q1: true },
    });
    const startedAt = new Date('2026-01-10T09:00:00.000Z');
    const record = buildPendingStudentSubmission(attempt, startedAt);

    expect(record.attemptId).toBe('attempt-1');
    expect(record.submissionId).toBe('student-submit-attempt-1');
    expect(record.retryCount).toBe(0);
    expect(record.finalSnapshot.answers).toEqual({ q1: 'FINAL_ANSWER' });
    expect(record.finalSnapshot.writingAnswers).toEqual({ task1: 'FINAL DRAFT' });
    expect(record.finalSnapshot.flags).toEqual({ q1: true });
    expect(Date.parse(record.expiresAt) - Date.parse(record.startedAt)).toBe(
      60 * 60 * 1000,
    );
  });

  it('persists, replaces, and clears durable pending submissions per attempt', async () => {
    const first = buildPendingStudentSubmission(
      makeAttempt({ answers: { q1: 'V1' } }),
      new Date('2026-01-10T09:00:00.000Z'),
    );
    const replacement = buildPendingStudentSubmission(
      makeAttempt({ answers: { q1: 'V2' } }),
      new Date('2026-01-10T09:01:00.000Z'),
    );
    const other = buildPendingStudentSubmission(
      makeAttempt({ id: 'attempt-2', answers: { q2: 'OTHER' } }),
      new Date('2026-01-10T09:00:00.000Z'),
    );

    await studentAttemptRepository.savePendingSubmission(first);
    await studentAttemptRepository.savePendingSubmission(other);
    expect(await studentAttemptRepository.getPendingSubmissions()).toHaveLength(2);

    // Re-saving the same attempt replaces the record (keeps one per attempt).
    await studentAttemptRepository.savePendingSubmission(replacement);
    const records = await studentAttemptRepository.getPendingSubmissions();
    expect(records).toHaveLength(2);
    const forAttemptOne = records.find((record) => record.attemptId === 'attempt-1');
    expect(forAttemptOne?.finalSnapshot.answers).toEqual({ q1: 'V2' });

    await studentAttemptRepository.clearPendingSubmission('attempt-1');
    const remaining = await studentAttemptRepository.getPendingSubmissions();
    expect(remaining.map((record) => record.attemptId)).toEqual(['attempt-2']);
  });

  it('prunes expired pending submissions while keeping fresh ones', async () => {
    const now = new Date('2026-01-10T09:00:00.000Z');
    const expired = buildPendingStudentSubmission(
      makeAttempt({ id: 'attempt-old', answers: { q1: 'OLD' } }),
      new Date('2026-01-10T07:00:00.000Z'),
    );
    // Expire it by shifting expiresAt into the past.
    expired.expiresAt = '2026-01-10T08:00:00.000Z';
    const fresh = buildPendingStudentSubmission(
      makeAttempt({ id: 'attempt-fresh', answers: { q1: 'FRESH' } }),
      new Date('2026-01-10T08:59:00.000Z'),
    );
    await studentAttemptRepository.savePendingSubmission(expired);
    await studentAttemptRepository.savePendingSubmission(fresh);

    const result = await pruneStudentAttemptCache(now, () => null);

    expect(result.purgedPendingSubmissions).toBe(1);
    const remaining = await studentAttemptRepository.getPendingSubmissions();
    expect(remaining.map((record) => record.attemptId)).toEqual(['attempt-fresh']);
  });

  it('attaches the frozen payload on failure and replays the ORIGINAL payload-determining fields on retry (I1 drift)', async () => {
    const attempt = makeAttempt({
      revision: 3,
      answers: { q1: 'FINAL_ANSWER' },
      writingAnswers: { task1: 'FINAL DRAFT' },
      flags: { q1: true },
      recovery: { ...makeAttempt().recovery, serverAcceptedThroughSeq: 5 },
    });
    storeAttemptCredential(attempt);

    const post = vi.mocked(backendPost);
    post.mockRejectedValueOnce(new Error('response lost'));

    // First submit: request reaches the server but the response is lost.
    let firstError: unknown = null;
    try {
      await studentAttemptRepository.submitAttempt(attempt);
    } catch (error) {
      firstError = error;
    }
    expect(firstError).toBeInstanceOf(Error);
    expect((firstError as Error).message).toBe('response lost');
    expect(post).toHaveBeenCalledTimes(1);

    const frozen = extractFrozenSubmitPayload(firstError);
    const firstBody = post.mock.calls[0]?.[1] as {
      lastSeenRevision: number;
      clientFinalSeq?: number;
      serverAcceptedThroughSeq?: number;
    };
    expect(frozen).toBeDefined();
    expect(frozen?.lastSeenRevision).toBe(3);
    expect(frozen?.clientFinalSeq).toBe(firstBody.clientFinalSeq);
    expect(frozen?.serverAcceptedThroughSeq).toBe(5);

    // A later mutation-batch response advances revision/seq BEFORE the retry.
    const advanced = {
      ...attempt,
      revision: 9,
      recovery: { ...attempt.recovery, serverAcceptedThroughSeq: 8 },
    };
    // The retry candidate carries the ORIGINAL frozen snapshot (the provider
    // overlays pending.finalSnapshot before calling submitAttempt).
    const retryCandidate = {
      ...advanced,
      answers: attempt.answers,
      writingAnswers: attempt.writingAnswers,
      flags: attempt.flags,
    };
    post.mockRejectedValueOnce(new Error('still offline'));
    await expect(studentAttemptRepository.submitAttempt(retryCandidate, frozen)).rejects.toThrow(
      'still offline',
    );
    expect(post).toHaveBeenCalledTimes(2);

    // hash(retry) === hash(first request): the serialized body is identical.
    expect(post.mock.calls[1]?.[1]).toEqual(firstBody);
  });

  it('converges to the authoritative attempt on an idempotency CONFLICT instead of looping (I1)', async () => {
    const attempt = makeAttempt({ answers: { q1: 'FINAL' } });
    storeAttemptCredential(attempt);

    const { ApiClientError } = await import('../../app/api/apiClient');
    vi.mocked(backendPost).mockRejectedValueOnce(
      new ApiClientError({
        message: 'Idempotency-Key does not match the original request.',
        statusCode: 409,
        backendCode: 'CONFLICT',
        backendDetails: undefined,
        backendRequestId: 'req-1',
      }),
    );

    const get = vi.mocked(backendGet);
    get.mockResolvedValueOnce({
      attempt: {
        id: attempt.id,
        scheduleId: attempt.scheduleId,
        studentKey: attempt.studentKey,
        examId: attempt.examId,
        examTitle: attempt.examTitle,
        candidateId: attempt.candidateId,
        candidateName: attempt.candidateName,
        candidateEmail: attempt.candidateEmail,
        phase: 'post-exam',
        currentModule: attempt.currentModule,
        currentQuestionId: null,
        answers: attempt.answers,
        writingAnswers: attempt.writingAnswers,
        flags: attempt.flags,
        violationsSnapshot: [],
        integrity: attempt.integrity,
        recovery: attempt.recovery,
        submittedAt: '2026-01-10T09:05:00.000Z',
        createdAt: attempt.createdAt,
        updatedAt: attempt.updatedAt,
      },
    });

    const result = await studentAttemptRepository.submitAttempt(attempt);

    // The client converges to the authoritative submitted attempt instead of
    // rethrowing into the retry loop.
    expect(result.phase).toBe('post-exam');
    expect(result.submittedAt).toBe('2026-01-10T09:05:00.000Z');
    expect(get).toHaveBeenCalledTimes(1);
    expect(String(get.mock.calls[0]?.[0])).toContain('/v1/student/sessions/schedule-1');
  });

  it('abandons the frozen payload and resubmits with LIVE fields when a 409 disproves submission (I1-residual)', async () => {
    const attempt = makeAttempt({
      revision: 3,
      answers: { q1: 'FINAL' },
      recovery: { ...makeAttempt().recovery, serverAcceptedThroughSeq: 5 },
    });
    storeAttemptCredential(attempt);

    // First submit: the request is lost before reaching the server, so the
    // payload-determining fields are frozen for idempotent replay.
    vi.mocked(backendPost).mockRejectedValueOnce(new Error('response lost'));
    let firstError: unknown = null;
    try {
      await studentAttemptRepository.submitAttempt(attempt);
    } catch (error) {
      firstError = error;
    }
    const frozen = extractFrozenSubmitPayload(firstError);
    expect(frozen).toBeDefined();
    expect(frozen?.lastSeenRevision).toBe(3);

    // While the submit was in flight, the server ACCEPTED flushed mutations:
    // revision advanced on the live attempt.
    const advanced = {
      ...attempt,
      revision: 9,
      recovery: { ...attempt.recovery, serverAcceptedThroughSeq: 8 },
    };

    const metricSpy = vi.spyOn(studentObservabilityModule, 'emitStudentObservabilityMetric');
    const { ApiClientError } = await import('../../app/api/apiClient');
    const post = vi.mocked(backendPost);
    // The frozen retry is rejected: its revision is stale relative to the
    // server's accepted mutations.
    post.mockRejectedValueOnce(
      new ApiClientError({
        message: 'base revision mismatch',
        statusCode: 409,
        backendCode: 'CONFLICT',
        backendDetails: { reason: 'BASE_REVISION_MISMATCH' },
        backendRequestId: 'req-2',
      }),
    );
    // The converge fetch DISPROVES submission: the attempt is not submitted.
    const get = vi.mocked(backendGet);
    get.mockResolvedValueOnce({
      attempt: { ...attempt, phase: 'exam', submittedAt: null },
    });
    // The live-fields resubmit is accepted by the server.
    post.mockResolvedValueOnce({
      attempt: {
        ...attempt,
        phase: 'post-exam',
        submittedAt: '2026-01-10T09:05:00.000Z',
      },
    });

    const result = await studentAttemptRepository.submitAttempt(advanced, frozen);

    expect(result.phase).toBe('post-exam');
    expect(result.submittedAt).toBe('2026-01-10T09:05:00.000Z');
    // Original POST + frozen retry (409) + live resubmit (accepted).
    expect(post).toHaveBeenCalledTimes(3);
    const liveBody = post.mock.calls[2]?.[1] as {
      lastSeenRevision: number;
      serverAcceptedThroughSeq?: number;
    };
    // The frozen payload is abandoned: the resubmit carries LIVE fields
    // (fresh revision/seq from the current attempt state).
    expect(liveBody.lastSeenRevision).toBe(9);
    expect(liveBody.serverAcceptedThroughSeq).toBe(8);
    expect(metricSpy).toHaveBeenCalledWith(
      'student_submit_conflict_not_converged_total',
      expect.objectContaining({
        attemptId: 'attempt-1',
        statusCode: 409,
        reason: 'BASE_REVISION_MISMATCH',
      }),
    );
    metricSpy.mockRestore();
  });

  it('marks the error as invalidating the frozen payload when the live-fields resubmit also fails (I1-residual)', async () => {
    const attempt = makeAttempt({
      revision: 3,
      answers: { q1: 'FINAL' },
      recovery: { ...makeAttempt().recovery, serverAcceptedThroughSeq: 5 },
    });
    storeAttemptCredential(attempt);

    vi.mocked(backendPost).mockRejectedValueOnce(new Error('response lost'));
    let firstError: unknown = null;
    try {
      await studentAttemptRepository.submitAttempt(attempt);
    } catch (error) {
      firstError = error;
    }
    const frozen = extractFrozenSubmitPayload(firstError);
    expect(frozen).toBeDefined();

    const advanced = {
      ...attempt,
      revision: 9,
      recovery: { ...attempt.recovery, serverAcceptedThroughSeq: 8 },
    };

    const metricSpy = vi.spyOn(studentObservabilityModule, 'emitStudentObservabilityMetric');
    const { ApiClientError } = await import('../../app/api/apiClient');
    const post = vi.mocked(backendPost);
    post.mockRejectedValueOnce(
      new ApiClientError({
        message: 'base revision mismatch',
        statusCode: 409,
        backendCode: 'CONFLICT',
        backendDetails: { reason: 'BASE_REVISION_MISMATCH' },
        backendRequestId: 'req-2',
      }),
    );
    vi.mocked(backendGet).mockResolvedValueOnce({
      attempt: { ...attempt, phase: 'exam', submittedAt: null },
    });
    // The live-fields resubmit also fails (offline again).
    post.mockRejectedValueOnce(new Error('still offline'));

    let retryError: unknown = null;
    try {
      await studentAttemptRepository.submitAttempt(advanced, frozen);
    } catch (error) {
      retryError = error;
    }

    expect((retryError as Error).message).toBe('still offline');
    // The stale frozen payload must be abandoned: the carrier carries LIVE
    // values AND the invalidation marker for the durable record.
    expect(shouldInvalidateFrozenPayload(retryError)).toBe(true);
    const liveCarrier = extractFrozenSubmitPayload(retryError);
    expect(liveCarrier?.lastSeenRevision).toBe(9);
    expect(liveCarrier?.serverAcceptedThroughSeq).toBe(8);
    expect(metricSpy).toHaveBeenCalledWith(
      'student_submit_conflict_not_converged_total',
      expect.objectContaining({ attemptId: 'attempt-1' }),
    );
    metricSpy.mockRestore();
  });

  it('accepts legacy and v1 pending submission records but rejects unknown future schema versions (M6)', async () => {
    const legacy = buildPendingStudentSubmission(
      makeAttempt({ id: 'attempt-legacy' }),
      new Date('2026-01-10T08:00:00.000Z'),
    );
    delete (legacy as { schemaVersion?: number }).schemaVersion;
    const v1 = buildPendingStudentSubmission(
      makeAttempt({ id: 'attempt-v1' }),
      new Date('2026-01-10T08:01:00.000Z'),
    );
    const future = {
      ...buildPendingStudentSubmission(
        makeAttempt({ id: 'attempt-future' }),
        new Date('2026-01-10T08:02:00.000Z'),
      ),
      schemaVersion: 2,
    };
    window.localStorage.setItem(
      'ielts_student_attempt_pending_submissions_v1',
      JSON.stringify([legacy, v1, future]),
    );

    const records = await studentAttemptRepository.getPendingSubmissions();

    // Legacy (no schemaVersion) and v1 records survive; a future schema
    // version is rejected defensively instead of being replayed or purged.
    expect(records.map((record) => record.attemptId)).toEqual(['attempt-legacy', 'attempt-v1']);
  });

  it('emits the pending-submission retry metric only for actual retries (retryCount > 0) (M8)', async () => {
    const metricSpy = vi.spyOn(studentObservabilityModule, 'emitStudentObservabilityMetric');
    const attempt = makeAttempt();

    await studentAttemptRepository.savePendingSubmission(
      buildPendingStudentSubmission(attempt, new Date('2026-01-10T08:00:00.000Z')),
    );
    const retried = {
      ...buildPendingStudentSubmission(attempt, new Date('2026-01-10T08:05:00.000Z')),
      retryCount: 2,
    };
    await studentAttemptRepository.savePendingSubmission(retried);

    const retryMetricCalls = metricSpy.mock.calls.filter(
      ([name]) => name === 'student_pending_submission_retry_total',
    );
    // The FIRST save (retryCount 0) is the initial failure, not a retry.
    expect(retryMetricCalls).toHaveLength(1);
    expect(retryMetricCalls[0]?.[1]).toEqual(
      expect.objectContaining({ attemptId: 'attempt-1', retryCount: 2 }),
    );
    metricSpy.mockRestore();
  });
});
