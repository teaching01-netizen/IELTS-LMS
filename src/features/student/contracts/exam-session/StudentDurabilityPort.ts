import type { StudentAttempt, StudentAttemptMutation } from '../../../../types/studentAttempt';

export interface StudentDurabilityPort {
  readPendingMutations(attemptId: string): Promise<readonly StudentAttemptMutation[]>;
  persistPendingMutations(
    attemptId: string,
    mutations: readonly StudentAttemptMutation[],
  ): Promise<void>;
  persistAttempt(attempt: StudentAttempt): Promise<void>;
  flushPendingMutations(attemptId: string): Promise<boolean>;
}
