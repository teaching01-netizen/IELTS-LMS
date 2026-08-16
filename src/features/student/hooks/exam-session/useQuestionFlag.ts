import { useMemo } from 'react';
import { selectQuestionFlag } from '@student/application/exam-session/examSessionSelectors';
import { useStudentExamSession } from './StudentExamSessionProvider';

export function useQuestionFlag(questionId: string) {
  const selector = useMemo(() => selectQuestionFlag(questionId), [questionId]);
  return useStudentExamSession(selector);
}
