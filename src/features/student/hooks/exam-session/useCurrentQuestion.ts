import { selectCurrentQuestionId } from '@student/application/exam-session/examSessionSelectors';
import { useStudentExamSession } from './StudentExamSessionProvider';

export function useCurrentQuestion() {
  return useStudentExamSession(selectCurrentQuestionId);
}
