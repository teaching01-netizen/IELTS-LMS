import type { StudentAttempt, StudentAttemptMutation } from '../../../../types/studentAttempt';

export interface StudentAttemptStore {
  readAttempt(attemptId: string): Promise<StudentAttempt | null>;
  persistAttempt(attempt: StudentAttempt): Promise<void>;
  readPendingMutations(attemptId: string): Promise<readonly StudentAttemptMutation[]>;
  persistPendingMutations(
    attemptId: string,
    mutations: readonly StudentAttemptMutation[],
  ): Promise<void>;
  clearPendingMutations(attemptId: string): Promise<void>;
}
