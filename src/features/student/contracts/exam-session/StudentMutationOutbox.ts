import type { StudentAttemptMutation } from '../../../../types/studentAttempt';

export interface StudentMutationOutbox {
  enqueue(mutation: StudentAttemptMutation): void | Promise<void>;
  flush(): Promise<boolean>;
  pendingCount(): number;
}
