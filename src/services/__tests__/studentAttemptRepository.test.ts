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
  compactSubmittedAttempt,
  pruneStudentAttemptCache,
  studentAttemptRepository,
} from '../studentAttemptRepository';
import { backendPost } from '../backendBridge';

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

describe('studentAttemptRepository', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.clearAllMocks();
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
        responseMode: 'ack',
        mutations: [
          expect.objectContaining({
            id: 'mutation-1',
            seq: 1,
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
});
