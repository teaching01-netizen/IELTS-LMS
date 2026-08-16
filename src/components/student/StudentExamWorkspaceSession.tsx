import React from 'react';
import { useStudentExamSession } from '@student/hooks/exam-session/StudentExamSessionProvider';
import {
  selectAnswers,
  selectCurrentModule,
  selectCurrentQuestionId,
  selectDisplayTimeRemaining,
  selectFlags,
  selectWritingAnswers,
} from '@student/application/exam-session/examSessionSelectors';
import {
  StudentExamWorkspace,
  type StudentExamWorkspaceProps,
} from './StudentExamWorkspace';

export type StudentExamWorkspaceSessionProps = Omit<
  StudentExamWorkspaceProps,
  | 'currentModule'
  | 'currentQuestionId'
  | 'answers'
  | 'writingAnswers'
  | 'flags'
  | 'displayTimeRemaining'
>;

export const StudentExamWorkspaceSession = React.memo(function StudentExamWorkspaceSession(
  props: StudentExamWorkspaceSessionProps,
) {
  const currentModule = useStudentExamSession(selectCurrentModule);
  const currentQuestionId = useStudentExamSession(selectCurrentQuestionId);
  const answers = useStudentExamSession(selectAnswers);
  const writingAnswers = useStudentExamSession(selectWritingAnswers);
  const flags = useStudentExamSession(selectFlags);
  const displayTimeRemaining = useStudentExamSession(selectDisplayTimeRemaining);

  return (
    <StudentExamWorkspace
      {...props}
      currentModule={currentModule}
      currentQuestionId={currentQuestionId}
      answers={answers}
      writingAnswers={writingAnswers}
      flags={flags}
      displayTimeRemaining={displayTimeRemaining ?? undefined}
    />
  );
});
