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
  isFinalModule?: ((module: ModuleType) => boolean) | undefined;
  flushAndSubmitCurrentModuleWithRetry: (fingerprint: string) => Promise<void>;
}

export function useStudentAutoSubmitBoundary({
  effectivePhase,
  autoSubmitEnabled,
  runtimeState,
  isFinalModule,
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
      const finalModuleDeadlineReached =
        runtimeState.displayTimeRemaining === 0 && isFinalModule?.(runtimeState.currentModule) === true;

      // The derived display clock is anchored to the server's section deadline. The final
      // module may submit at that local boundary so students do not wait for the worker's
      // closing-grace reconciliation; the server write gate remains authoritative. Intermediate
      // IELTS sections still require a server-confirmed boundary or section transition.
      if (!serverConfirmedZero && !serverSectionChanged && !finalModuleDeadlineReached) {
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
    isFinalModule,
  ]);
}
