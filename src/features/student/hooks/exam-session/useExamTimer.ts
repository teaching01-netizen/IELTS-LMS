import { selectDisplayTimeRemaining } from '@student/application/exam-session/examSessionSelectors';
import { useStudentExamSession } from './StudentExamSessionProvider';

export function useExamTimer() {
  return useStudentExamSession(selectDisplayTimeRemaining);
}
