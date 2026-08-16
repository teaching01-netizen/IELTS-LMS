import type { CSSProperties, ReactNode } from 'react';
import type { ExamState } from '../../types';
import type { StudentExamPhase } from '@student/domain/exam-session/studentExamPhase';
import { Lobby } from './Lobby';
import { PreCheck } from './PreCheck';
import { StudentPostExamView } from './StudentPostExamView';
import { useStudentAttempt } from './providers/StudentAttemptProvider';
import { useStudentRuntime } from './providers/StudentRuntimeProvider';
import { isVerifiedTerminalStudentState } from './providers/verifiedTerminalState';

interface StudentExamPhaseRendererProps {
  readonly phase: StudentExamPhase;
  readonly shouldRenderPostExam: boolean;
  readonly examState: ExamState;
  readonly allowPreviewStart: boolean;
  readonly shellStyle: CSSProperties;
  readonly verifiedTerminalState: ReturnType<typeof isVerifiedTerminalStudentState>;
  readonly finalSubmitOverlay: ReactNode;
  readonly onExit: () => void;
}

export function StudentExamPhaseRenderer({
  phase,
  shouldRenderPostExam,
  examState,
  allowPreviewStart,
  shellStyle,
  verifiedTerminalState,
  finalSubmitOverlay,
  onExit,
}: StudentExamPhaseRendererProps) {
  const { state: attemptState, actions: attemptActions } = useStudentAttempt();
  const { state: runtimeState, actions: runtimeActions } = useStudentRuntime();

  if (!shouldRenderPostExam && phase === 'pre-check') {
    return (
      <div className="flex flex-col h-screen w-full bg-gray-50 font-sans text-gray-900" style={shellStyle}>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <main id="main-content" role="main">
          <PreCheck
            config={examState.config}
            examTitle={attemptState.attempt?.examTitle ?? examState.title}
            candidateName={attemptState.attempt?.candidateName}
            candidateId={attemptState.attempt?.candidateId}
            onComplete={async (result) => {
              await attemptActions.recordPreCheckResult(result);
              runtimeActions.setPhase('lobby');
            }}
          />
        </main>
        {finalSubmitOverlay}
      </div>
    );
  }

  if (!shouldRenderPostExam && phase === 'lobby') {
    return (
      <div className="flex flex-col h-screen w-full bg-gray-50 font-sans text-gray-900" style={shellStyle}>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <main id="main-content" role="main">
          <Lobby
            state={examState}
            candidateName={attemptState.attempt?.candidateName}
            candidateId={attemptState.attempt?.candidateId}
            onPreviewStart={allowPreviewStart ? runtimeActions.startExam : undefined}
          />
        </main>
        {finalSubmitOverlay}
      </div>
    );
  }

  if (shouldRenderPostExam) {
    const studentInfo = [
      { label: 'Student Name', value: attemptState.attempt?.candidateName },
      { label: 'Student ID', value: attemptState.attempt?.candidateId },
      { label: 'Email', value: attemptState.attempt?.candidateEmail },
      { label: 'Exam', value: attemptState.attempt?.examTitle ?? examState.title },
    ].filter((item): item is { label: string; value: string } => Boolean(item.value));

    return (
      <StudentPostExamView
        isProctorTerminated={verifiedTerminalState === 'terminated'}
        proctorNote={runtimeState.proctorNote}
        studentInfo={studentInfo}
        onExit={onExit}
        finalSubmitOverlay={finalSubmitOverlay}
      />
    );
  }

  return null;
}
