import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ExamState } from '../../types';
import type { StudentExamPhase } from '@student/domain/exam-session/studentExamPhase';
import { Lobby } from './Lobby';
import { PreCheck } from './PreCheck';
import { StudentPostExamView } from './StudentPostExamView';
import { useStudentAttempt } from './providers/StudentAttemptProvider';
import { useStudentRuntime, useStudentRuntimeSession } from './providers/StudentRuntimeProvider';
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
  const { state: runtimeState, actions: runtimeActions } = useStudentRuntimeSession();
  const [preCheckError, setPreCheckError] = useState<string | null>(null);
  // S1-C13: move focus into the new phase on every phase change (WCAG 2.4.3)
  // and announce it via the sr-only live region so SR users know the exam
  // step changed even though the route URL does not.
  const phaseHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const [phaseAnnouncement, setPhaseAnnouncement] = useState('');
  useEffect(() => {
    phaseHeadingRef.current?.focus();
    setPhaseAnnouncement(
      phase === 'pre-check'
        ? 'Pre-check step. Verify your setup, then continue.'
        : phase === 'lobby'
          ? 'Lobby. Review the exam details, then start when ready.'
          : 'Exam submitted. Your completion summary is shown.',
    );
  }, [phase, shouldRenderPostExam]);

  if (!shouldRenderPostExam && phase === 'pre-check') {
    return (
      <div className="flex flex-col h-screen w-full bg-gray-50 font-sans text-gray-900" style={shellStyle}>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <span className="sr-only" role="status" aria-live="polite">{phaseAnnouncement}</span>
        <main id="main-content" role="main">
          <h1 ref={phaseHeadingRef} tabIndex={-1} className="sr-only">Exam pre-check</h1>
          <PreCheck
            config={examState.config}
            examTitle={attemptState.attempt?.examTitle ?? examState.title}
            candidateName={attemptState.attempt?.candidateName}
            candidateId={attemptState.attempt?.candidateId}
            onComplete={async (result) => {
              setPreCheckError(null);
              try {
                await attemptActions.recordPreCheckResult(result);
              } catch (error) {
                setPreCheckError(
                  error instanceof Error ? error.message : 'Could not save the pre-check. Try again.',
                );
                return;
              }
              runtimeActions.setPhase('lobby');
            }}
          />
          {preCheckError ? (
            <p role="alert" className="mx-auto mt-4 max-w-xl px-4 text-sm font-semibold text-red-700">
              {preCheckError}
            </p>
          ) : null}
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
        <span className="sr-only" role="status" aria-live="polite">{phaseAnnouncement}</span>
        <main id="main-content" role="main">
          <h1 ref={phaseHeadingRef} tabIndex={-1} className="sr-only">Exam lobby</h1>
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
