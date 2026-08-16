import { selectPhase } from '@student/application/exam-session/examSessionSelectors';
import { useStudentExamSession } from './StudentExamSessionProvider';

export function useExamPhase() {
  return useStudentExamSession(selectPhase);
}
