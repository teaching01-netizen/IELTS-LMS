import { useMemo } from 'react';
import { selectQuestionAnswer } from '@student/application/exam-session/examSessionSelectors';
import { useStudentExamSession } from './StudentExamSessionProvider';

export function useQuestionAnswer(questionId: string) {
  const selector = useMemo(() => selectQuestionAnswer(questionId), [questionId]);
  return useStudentExamSession(selector);
}
