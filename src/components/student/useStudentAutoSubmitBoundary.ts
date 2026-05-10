import { useEffect, useRef } from 'react';
import type { ModuleType } from '../../types';
import type { ExamSessionRuntime, RuntimeStatus } from '../../types/domain';

interface UseStudentAutoSubmitBoundaryOptions {
  effectivePhase: 'pre-check' | 'lobby' | 'exam' | 'post-exam' | 'submitted';
  autoSubmitEnabled: boolean;
  runtimeState: {
    blockingActive: boolean;
    displayTimeRemaining: number | null;
    runtimeBacked: boolean;
    runtimeStatus: RuntimeStatus | null;
    currentModule: ModuleType;
    runtimeSnapshot: ExamSessionRuntime | null;
  };
  flushAndSubmitCurrentModuleWithRetry: (fingerprint: string) => Promise<void>;
}

export function useStudentAutoSubmitBoundary({
  effectivePhase,
  autoSubmitEnabled,
  runtimeState,
  flushAndSubmitCurrentModuleWithRetry,
}: UseStudentAutoSubmitBoundaryOptions) {
  const autoSubmitFingerprintRef = useRef<string | null>(null);
  const priorTimeRemainingRef = useRef<number | null>(null);

  useEffect(() => {
    const priorTimeRemaining = priorTimeRemainingRef.current;
    priorTimeRemainingRef.current =
      typeof runtimeState.displayTimeRemaining === 'number'
        ? runtimeState.displayTimeRemaining
        : null;

    if (!autoSubmitEnabled) {
      autoSubmitFingerprintRef.current = null;
      return;
    }

    if (effectivePhase !== 'exam') {
      autoSubmitFingerprintRef.current = null;
      return;
    }

    if (runtimeState.blockingActive) {
      return;
    }

    if (typeof runtimeState.displayTimeRemaining !== 'number') {
      return;
    }

    if (runtimeState.runtimeBacked) {
      if (runtimeState.runtimeStatus !== 'live') {
        return;
      }

      const reachedZero = runtimeState.displayTimeRemaining === 0;
      const transitionedToZero =
        reachedZero && typeof priorTimeRemaining === 'number' && priorTimeRemaining > 0;

      const serverSectionKey = runtimeState.runtimeSnapshot?.currentSectionKey ?? null;
      const serverRemaining = runtimeState.runtimeSnapshot?.currentSectionRemainingSeconds;
      const serverConfirmedBoundary =
        serverSectionKey !== runtimeState.currentModule || serverRemaining === 0;

      if (!transitionedToZero && !serverConfirmedBoundary) {
        return;
      }

      if (!serverConfirmedBoundary) {
        return;
      }
    } else if (runtimeState.displayTimeRemaining !== 0) {
      return;
    }

    const fingerprint = `${runtimeState.runtimeBacked ? 'runtime' : 'self'}:${runtimeState.currentModule}`;
    if (autoSubmitFingerprintRef.current === fingerprint) {
      return;
    }

    autoSubmitFingerprintRef.current = fingerprint;
    void flushAndSubmitCurrentModuleWithRetry(fingerprint);
  }, [
    autoSubmitEnabled,
    effectivePhase,
    flushAndSubmitCurrentModuleWithRetry,
    runtimeState.blockingActive,
    runtimeState.currentModule,
    runtimeState.displayTimeRemaining,
    runtimeState.runtimeBacked,
    runtimeState.runtimeSnapshot,
    runtimeState.runtimeStatus,
  ]);
}
