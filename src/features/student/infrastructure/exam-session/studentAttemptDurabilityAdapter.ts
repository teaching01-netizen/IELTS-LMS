import { studentAttemptRepository } from '../studentAttemptGateway';
import type { StudentDurabilityPort } from '../../contracts/exam-session/StudentDurabilityPort';
import type { StudentAttempt, StudentAttemptMutation } from '../../../../types/studentAttempt';

export interface StudentAttemptDurabilityAdapterDependencies {
  readonly repository?: Pick<
    typeof studentAttemptRepository,
    | 'getPendingMutations'
    | 'savePendingMutations'
    | 'saveAttempt'
  >;
}

export function createStudentAttemptDurabilityAdapter(
  dependencies: StudentAttemptDurabilityAdapterDependencies = {},
): StudentDurabilityPort {
  const repository = dependencies.repository ?? studentAttemptRepository;

  return {
    readPendingMutations(attemptId) {
      return repository.getPendingMutations(attemptId);
    },
    persistPendingMutations(attemptId, mutations) {
      return repository.savePendingMutations(attemptId, [...mutations]);
    },
    persistAttempt(attempt) {
      return repository.saveAttempt(attempt);
    },
    async flushPendingMutations(attemptId) {
      await repository.getPendingMutations(attemptId);
      return true;
    },
  } satisfies StudentDurabilityPort;
}

export type { StudentAttempt, StudentAttemptMutation };
