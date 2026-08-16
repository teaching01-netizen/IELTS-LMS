import { selectBlocking } from '@student/application/exam-session/examSessionSelectors';
import { useStudentExamSession } from './StudentExamSessionProvider';

export function useExamBlocking() {
  return useStudentExamSession(selectBlocking);
}
