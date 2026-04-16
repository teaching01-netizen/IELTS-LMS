import { beforeEach, describe, expect, it } from 'vitest';
import { LocalStorageStudentAttemptRepository } from '../studentAttemptRepository';
import type { StudentAttemptMutation, StudentHeartbeatEvent } from '../../types/studentAttempt';

describe('LocalStorageStudentAttemptRepository', () => {
  let repository: LocalStorageStudentAttemptRepository;

  beforeEach(() => {
    localStorage.clear();
    repository = new LocalStorageStudentAttemptRepository();
  });

  it('creates and loads attempts by schedule id and student key', async () => {
    const attempt = await repository.createAttempt({
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1',
      examId: 'exam-1',
      examTitle: 'Mock IELTS',
      currentModule: 'writing',
    });

    const loaded = await repository.getAttemptByScheduleId('sched-1', 'student-sched-1');
    expect(loaded).toMatchObject({
      ...attempt,
      updatedAt: expect.any(String),
    });
  });

  it('persists pending mutations and heartbeat events', async () => {
    const attempt = await repository.createAttempt({
      scheduleId: 'sched-1',
      studentKey: 'student-sched-1',
      examId: 'exam-1',
      examTitle: 'Mock IELTS',
    });

    const mutations: StudentAttemptMutation[] = [
      {
        id: 'mutation-1',
        attemptId: attempt.id,
        scheduleId: attempt.scheduleId,
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'answer',
        payload: { questionId: 'q1', value: 'A' },
      },
    ];
    const heartbeatEvent: StudentHeartbeatEvent = {
      id: 'heartbeat-1',
      attemptId: attempt.id,
      scheduleId: attempt.scheduleId,
      timestamp: '2026-01-01T00:01:00.000Z',
      type: 'heartbeat',
    };

    await repository.savePendingMutations(attempt.id, mutations);
    await repository.saveHeartbeatEvent(heartbeatEvent);

    expect(await repository.getPendingMutations(attempt.id)).toEqual(mutations);
    expect(await repository.getHeartbeatEvents(attempt.id)).toEqual([heartbeatEvent]);

    await repository.clearPendingMutations(attempt.id);
    expect(await repository.getPendingMutations(attempt.id)).toEqual([]);
  });
});
