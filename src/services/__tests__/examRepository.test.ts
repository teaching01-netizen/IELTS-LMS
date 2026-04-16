import { beforeEach, describe, expect, it } from 'vitest';
import { LocalStorageExamRepository } from '../examRepository';
import { ExamSessionRuntime, CohortControlEvent } from '../../types/domain';

describe('LocalStorageExamRepository runtime storage', () => {
  let repository: LocalStorageExamRepository;

  beforeEach(() => {
    localStorage.clear();
    repository = new LocalStorageExamRepository();
  });

  it('persists and deletes runtimes by schedule id', async () => {
    const runtime: ExamSessionRuntime = {
      id: 'runtime-1',
      scheduleId: 'sched-1',
      examId: 'exam-1',
      examTitle: 'IELTS Mock',
      cohortName: 'Cohort A',
      deliveryMode: 'proctor_start',
      status: 'live',
      actualStartAt: '2026-01-01T00:00:00.000Z',
      actualEndAt: null,
      activeSectionKey: 'reading',
      currentSectionKey: 'reading',
      currentSectionRemainingSeconds: 1200,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      sections: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };

    await repository.saveRuntime(runtime);
    const loaded = await repository.getRuntimeByScheduleId('sched-1');
    expect(loaded).toEqual(runtime);

    await repository.deleteRuntime('sched-1');
    const deleted = await repository.getRuntimeByScheduleId('sched-1');
    expect(deleted).toBeNull();
  });

  it('persists control events and returns them in time order', async () => {
    const events: CohortControlEvent[] = [
      {
        id: 'evt-2',
        scheduleId: 'sched-1',
        runtimeId: 'runtime-1',
        examId: 'exam-1',
        actor: 'Proctor',
        action: 'pause_runtime',
        timestamp: '2026-01-01T00:05:00.000Z'
      },
      {
        id: 'evt-1',
        scheduleId: 'sched-1',
        runtimeId: 'runtime-1',
        examId: 'exam-1',
        actor: 'Proctor',
        action: 'start_runtime',
        timestamp: '2026-01-01T00:00:00.000Z'
      }
    ];

    await repository.saveControlEvent(events[0]);
    await repository.saveControlEvent(events[1]);

    const loaded = await repository.getControlEventsByScheduleId('sched-1');
    expect(loaded.map(event => event.id)).toEqual(['evt-1', 'evt-2']);
  });
});
