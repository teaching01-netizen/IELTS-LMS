import { useEffect, useRef } from 'react';
import type { ExamConfig } from '../../types';
import { useExamCommands } from '@student/hooks/exam-session/useExamCommands';
import { useStudentAttempt } from './providers/StudentAttemptProvider';
import { useStudentRuntimeClock, useStudentRuntimeState } from './providers/StudentRuntimeProvider';
import { useStudentUI } from './providers/StudentUIProvider';
import { useStudentAutoSubmitBoundary } from './useStudentAutoSubmitBoundary';
import { shouldOfferTimeExtension } from './timeExtensionPolicy';

interface StudentExamClockEffectsProps {
  effectivePhase: 'pre-check' | 'lobby' | 'exam' | 'post-exam' | 'submitted';
  autoSubmitEnabled: boolean;
  config: Pick<ExamConfig, 'delivery'>;
  flushAndSubmitCurrentModuleWithRetry: (fingerprint: string) => Promise<void>;
}

export function StudentExamClockEffects({
  effectivePhase,
  autoSubmitEnabled,
  config,
  flushAndSubmitCurrentModuleWithRetry,
}: StudentExamClockEffectsProps) {
  const displayTimeRemaining = useStudentRuntimeClock();
  const runtimeState = useStudentRuntimeState();
  const { state: attemptState } = useStudentAttempt();
  const examSessionCommands = useExamCommands();
  const { actions: uiActions } = useStudentUI();
  const timeExtensionOfferFiredRef = useRef(false);

  useEffect(() => {
    examSessionCommands.setPhase(runtimeState.phase);
    examSessionCommands.setNavigation(runtimeState.currentModule, runtimeState.currentQuestionId);
    examSessionCommands.setRuntimeSnapshot(
      runtimeState.runtimeSnapshot,
      displayTimeRemaining ?? null,
    );
    examSessionCommands.setPersistence({
      syncState: runtimeState.attemptSyncState,
      pendingMutationCount: attemptState.attempt?.recovery.pendingMutationCount ?? 0,
      acceptedThroughSeq: attemptState.attempt?.recovery.serverAcceptedThroughSeq ?? 0,
    });
    examSessionCommands.setBlocking({
      active: runtimeState.blocking.active,
      reason: runtimeState.blocking.reason,
      timeRemaining: runtimeState.blocking.timeRemaining,
    });
  }, [
    attemptState.attempt?.recovery.pendingMutationCount,
    attemptState.attempt?.recovery.serverAcceptedThroughSeq,
    displayTimeRemaining,
    examSessionCommands,
    runtimeState.attemptSyncState,
    runtimeState.blocking.active,
    runtimeState.blocking.reason,
    runtimeState.blocking.timeRemaining,
    runtimeState.currentModule,
    runtimeState.currentQuestionId,
    runtimeState.phase,
    runtimeState.runtimeSnapshot,
  ]);

  useStudentAutoSubmitBoundary({
    effectivePhase,
    autoSubmitEnabled,
    runtimeState: {
      blockingActive: runtimeState.blocking.active,
      displayTimeRemaining: displayTimeRemaining ?? null,
      runtimeBacked: runtimeState.runtimeBacked,
      runtimeStatus: runtimeState.runtimeStatus,
      currentModule: runtimeState.currentModule,
      runtimeSnapshot: runtimeState.runtimeSnapshot,
    },
    flushAndSubmitCurrentModuleWithRetry,
  });

  useEffect(() => {
    if (shouldOfferTimeExtension({
      config,
      phase: effectivePhase,
      runtimeBacked: runtimeState.runtimeBacked,
      displayTimeRemaining,
    })) {
      if (!timeExtensionOfferFiredRef.current) {
        timeExtensionOfferFiredRef.current = true;
        uiActions.setShowTimeExtensionRequest(true);
      }
    } else {
      timeExtensionOfferFiredRef.current = false;
    }
  }, [config, displayTimeRemaining, effectivePhase, runtimeState.runtimeBacked, uiActions]);

  return null;
}
