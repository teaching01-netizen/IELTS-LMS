import type { StudentAttempt } from '../../../../types/studentAttempt';

export interface StudentSessionTransport {
  loadStaticSession(scheduleId: string, candidateId: string): Promise<unknown>;
  loadLiveSession(scheduleId: string, candidateId: string): Promise<unknown>;
  flushMutations(attempt: StudentAttempt): Promise<StudentAttempt>;
  submitAttempt(attempt: StudentAttempt): Promise<StudentAttempt>;
}
