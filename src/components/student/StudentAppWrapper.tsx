import React from 'react';
import type { ExamState } from '../../types';
import type { ExamSessionRuntime } from '../../types/domain';
import type { StudentAttempt } from '../../types/studentAttempt';
import type { StudentAnswerInvariantRollout } from '../../features/student/hooks/useStudentSessionRouteData';
import { StudentApp } from './StudentApp';
import { KeyboardProvider } from './providers/StudentKeyboardProvider';
import { StudentAttemptProvider } from './providers/StudentAttemptProvider';
import { StudentNetworkProvider } from './providers/StudentNetworkProvider';
import { ProctoringProvider } from './providers/StudentProctoringProvider';
import { StudentRuntimeProvider } from './providers/StudentRuntimeProvider';
import { StudentUIProvider } from './providers/StudentUIProvider';
import { StudentHighlightPersistenceProvider } from './highlightV2Persistence';

interface StudentAppWrapperProps {
  state: ExamState;
  onExit: () => void;
  scheduleId?: string | undefined;
  attemptSnapshot?: StudentAttempt | null;
  onRuntimeRefresh?: (() => Promise<void>) | undefined;
  runtimeSnapshot?: ExamSessionRuntime | null;
  answerInvariantRollout?: StudentAnswerInvariantRollout | undefined;
  showSubmitControls?: boolean | undefined;
  allowExitDuringExam?: boolean | undefined;
  persistenceEnabled?: boolean | undefined;
  enableMonitoring?: boolean | undefined;
  allowPreviewStart?: boolean | undefined;
}

export function StudentAppWrapper({
  state,
  onExit,
  scheduleId,
  attemptSnapshot = null,
  onRuntimeRefresh,
  runtimeSnapshot = null,
  answerInvariantRollout,
  showSubmitControls = true,
  allowExitDuringExam = false,
  persistenceEnabled = true,
  enableMonitoring = true,
  allowPreviewStart = false,
}: StudentAppWrapperProps) {
  const highlightPersistenceNamespace = `attempt:${
    attemptSnapshot?.id ??
    [
      attemptSnapshot?.studentKey ?? attemptSnapshot?.candidateId ?? 'preview',
      attemptSnapshot?.examId ?? state.title,
      scheduleId ?? 'unscheduled',
    ].join(':')
  }`;
  const app = (
    <StudentHighlightPersistenceProvider namespace={highlightPersistenceNamespace}>
      <StudentUIProvider>
        <KeyboardProvider>
          <StudentApp
            showSubmitControls={showSubmitControls}
            allowPreviewStart={allowPreviewStart}
            allowExitDuringExam={allowExitDuringExam}
          />
        </KeyboardProvider>
      </StudentUIProvider>
    </StudentHighlightPersistenceProvider>
  );

  return (
    <StudentRuntimeProvider
      state={state}
      onExit={onExit}
      attemptSnapshot={attemptSnapshot}
      answerInvariantEnabled={
        answerInvariantRollout
          ? answerInvariantRollout.enabled && !answerInvariantRollout.killSwitch
          : true
      }
      runtimeBacked={Boolean(runtimeSnapshot)}
      runtimeSnapshot={runtimeSnapshot}
    >
      <StudentAttemptProvider
        scheduleId={scheduleId}
        attemptSnapshot={attemptSnapshot}
        persistenceEnabled={persistenceEnabled}
      >
        <ProctoringProvider
          config={state.config}
          scheduleId={scheduleId}
          enabled={enableMonitoring}
        >
          {enableMonitoring ? (
            <StudentNetworkProvider
              config={state.config}
              scheduleId={scheduleId}
              onRefreshRuntime={onRuntimeRefresh}
            >
              {app}
            </StudentNetworkProvider>
          ) : (
            app
          )}
        </ProctoringProvider>
      </StudentAttemptProvider>
    </StudentRuntimeProvider>
  );
}

export function useStudentAppContext() {
  throw new Error('useStudentAppContext is deprecated. Use useStudentRuntime instead.');
}
