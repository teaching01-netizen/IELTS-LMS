import React from 'react';
import type { ExamState } from '../../types';
import type { ExamSessionRuntime } from '../../types/domain';
import type { StudentAttempt } from '../../types/studentAttempt';
import { StudentApp } from './StudentApp';
import { KeyboardProvider } from './providers/StudentKeyboardProvider';
import { StudentAttemptProvider } from './providers/StudentAttemptProvider';
import { StudentNetworkProvider } from './providers/StudentNetworkProvider';
import { ProctoringProvider } from './providers/StudentProctoringProvider';
import { StudentRuntimeProvider } from './providers/StudentRuntimeProvider';
import { StudentUIProvider } from './providers/StudentUIProvider';

interface StudentAppWrapperProps {
  state: ExamState;
  onExit: () => void;
  scheduleId?: string | undefined;
  attemptSnapshot?: StudentAttempt | null;
  onRuntimeRefresh?: (() => Promise<void>) | undefined;
  runtimeSnapshot?: ExamSessionRuntime | null;
}

export function StudentAppWrapper({
  state,
  onExit,
  scheduleId,
  attemptSnapshot = null,
  onRuntimeRefresh,
  runtimeSnapshot = null,
}: StudentAppWrapperProps) {
  return (
    <StudentRuntimeProvider
      state={state}
      onExit={onExit}
      attemptSnapshot={attemptSnapshot}
      runtimeBacked={Boolean(runtimeSnapshot)}
      runtimeSnapshot={runtimeSnapshot}
    >
      <StudentAttemptProvider scheduleId={scheduleId} attemptSnapshot={attemptSnapshot}>
        <StudentNetworkProvider
          config={state.config}
          scheduleId={scheduleId}
          onRefreshRuntime={onRuntimeRefresh}
        >
          <ProctoringProvider config={state.config} scheduleId={scheduleId}>
            <StudentUIProvider>
              <KeyboardProvider>
                <StudentApp />
              </KeyboardProvider>
            </StudentUIProvider>
          </ProctoringProvider>
        </StudentNetworkProvider>
      </StudentAttemptProvider>
    </StudentRuntimeProvider>
  );
}

export function useStudentAppContext() {
  throw new Error('useStudentAppContext is deprecated. Use useStudentRuntime instead.');
}
