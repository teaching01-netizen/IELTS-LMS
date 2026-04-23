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

import type { StudentAttempt, StudentAttemptMutation } from '../../types/studentAttempt';
import { studentAttemptRepository } from '../studentAttemptRepository';
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
});

