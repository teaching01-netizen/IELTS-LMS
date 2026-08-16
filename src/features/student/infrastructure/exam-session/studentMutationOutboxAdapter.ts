import type { StudentMutationOutbox } from '../../contracts/exam-session/StudentMutationOutbox';
import type { StudentAttemptMutation } from '../../../../types/studentAttempt';

export interface StudentMutationOutboxAdapterDependencies {
  enqueue(mutation: StudentAttemptMutation): void | Promise<void>;
  flush(): Promise<boolean>;
  pendingCount(): number;
}

export function createStudentMutationOutboxAdapter(
  dependencies: StudentMutationOutboxAdapterDependencies,
): StudentMutationOutbox {
  return {
    enqueue: (mutation) => dependencies.enqueue(mutation),
    flush: () => dependencies.flush(),
    pendingCount: () => dependencies.pendingCount(),
  };
}
