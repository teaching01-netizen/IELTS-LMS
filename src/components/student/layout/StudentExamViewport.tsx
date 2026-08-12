import type { ReactNode } from 'react';

interface StudentExamViewportProps {
  readonly children: ReactNode;
}

export function StudentExamViewport({ children }: StudentExamViewportProps) {
  return <div className="student-exam-viewport relative flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>;
}
