import React from 'react';
import { SubmitConfirmation } from './SubmitConfirmation';
import { useStudentRuntimeClock } from './providers/StudentRuntimeProvider';

interface StudentExamTimeRemainingProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  answeredCount: number;
  totalQuestions: number;
  flaggedCount: number;
  unansweredSubmissionPolicy: 'allow' | 'confirm' | 'block';
}

export const StudentExamTimeRemaining = React.memo(function StudentExamTimeRemaining({
  isOpen,
  onClose,
  onConfirm,
  answeredCount,
  totalQuestions,
  flaggedCount,
  unansweredSubmissionPolicy,
}: StudentExamTimeRemainingProps) {
  const timeRemaining = useStudentRuntimeClock();
  return (
    <SubmitConfirmation
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      answeredCount={answeredCount}
      totalQuestions={totalQuestions}
      flaggedCount={flaggedCount}
      timeRemaining={timeRemaining}
      unansweredSubmissionPolicy={unansweredSubmissionPolicy}
    />
  );
});
