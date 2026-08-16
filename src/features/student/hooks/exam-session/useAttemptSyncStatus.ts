import { selectAttemptSyncState } from '@student/application/exam-session/examSessionSelectors';
import { useStudentExamSession } from './StudentExamSessionProvider';

export function useAttemptSyncStatus() {
  return useStudentExamSession(selectAttemptSyncState);
}
