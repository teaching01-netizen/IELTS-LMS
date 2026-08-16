import type { StudentExamStore } from './studentExamStore';
import type { StudentDurabilityPort } from '../../contracts/exam-session/StudentDurabilityPort';
import type { StudentMutationOutbox } from '../../contracts/exam-session/StudentMutationOutbox';
import type { StudentAttemptMutation } from '../../../../types/studentAttempt';

export interface StudentAttemptController {
  enqueue(mutation: StudentAttemptMutation): Promise<void>;
  flushPending(): Promise<boolean>;
}

export function createStudentAttemptController(input: {
  readonly store: StudentExamStore;
  readonly durability: StudentDurabilityPort;
  readonly outbox: StudentMutationOutbox;
}): StudentAttemptController {
  return {
    async enqueue(mutation) {
      await input.outbox.enqueue(mutation);
      input.store.getState().actions.setPersistence({
        pendingMutationCount: input.outbox.pendingCount(),
        syncState: 'saving',
      });
    },
    async flushPending() {
      const attemptId = input.store.getState().identity.attemptId;
      if (!attemptId) {
        return false;
      }

      const durable = await input.durability.flushPendingMutations(attemptId);
      if (!durable) {
        input.store.getState().actions.setPersistence({ syncState: 'error' });
        return false;
      }

      const flushed = await input.outbox.flush();
      input.store.getState().actions.setPersistence({
        pendingMutationCount: input.outbox.pendingCount(),
        syncState: flushed ? 'saved' : 'error',
      });
      return flushed;
    },
  };
}
