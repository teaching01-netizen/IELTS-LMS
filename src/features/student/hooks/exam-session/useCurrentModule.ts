import { selectCurrentModule } from '@student/application/exam-session/examSessionSelectors';
import { useStudentExamSession } from './StudentExamSessionProvider';

export function useCurrentModule() {
  return useStudentExamSession(selectCurrentModule);
}
