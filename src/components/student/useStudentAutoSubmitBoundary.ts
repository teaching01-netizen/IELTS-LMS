import { useEffect, useRef } from 'react';
import type { ModuleType } from '../../types';
import type { ExamSessionRuntime, RuntimeStatus } from '../../types/domain';
import type { StudentBlockingReason } from '@student/domain/exam-session/blockingPolicy';

interface UseStudentAutoSubmitBoundaryOptions {
  effectivePhase: 'pre-check' | 'lobby' | 'exam' | 'post-exam' | 'submitted';
  autoSubmitEnabled: boolean;
  runtimeState: {
    blockingActive: boolean;
    blockingReason: StudentBlockingReason;
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
  useEffect(() => {
    if (!autoSubmitEnabled) {
      autoSubmitFingerprintRef.current = null;
      return;
    }

    if (effectivePhase !== 'exam') {
      autoSubmitFingerprintRef.current = null;
      return;
    }

    if (runtimeState.blockingActive && runtimeState.blockingReason !== 'time_expired') {
      return;
    }

    if (typeof runtimeState.displayTimeRemaining !== 'number') {
      return;
    }

    if (runtimeState.runtimeBacked) {
      if (runtimeState.runtimeStatus !== 'live') {
        return;
      }

      const serverSectionChanged =
        runtimeState.runtimeSnapshot?.currentSectionKey !== runtimeState.currentModule;
      const serverConfirmedZero =
        runtimeState.runtimeSnapshot?.currentSectionRemainingSeconds === 0;

      // The local countdown may reach zero before the next authoritative runtime poll.
      // It can drive UI urgency, but only a server-confirmed zero or section transition may
      // finalize a runtime-backed module. This prevents client clock skew or stale offsets
      // from submitting while the server still admits work.
      if (!serverConfirmedZero && !serverSectionChanged) {
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
    runtimeState.blockingReason,
    runtimeState.currentModule,
    runtimeState.displayTimeRemaining,
    runtimeState.runtimeBacked,
    runtimeState.runtimeSnapshot,
    runtimeState.runtimeStatus,
  ]);
}
