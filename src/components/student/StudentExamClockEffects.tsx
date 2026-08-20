import { useEffect, useRef } from 'react';
import type { ExamConfig, ModuleType } from '../../types';
import type { ExamSessionRuntime } from '../../types/domain';
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

  // Clock-bridge writes: per-tick work is coalesced through setRuntimeSnapshot
  // so Zustand subscribers keyed on other slices are not invalidated every second.
  // Phase/navigation/persistence are considered non-clock state and are synced outside
  // the per-second path; only blocking is compared via the snapshot/equality guard below
  // when its value actually changes. Ref-guarded effects avoid re-firing when actions
  // identity is stable but tick values propagate.
  const lastClockSnapshotRef = useRef<ExamSessionRuntime | null | undefined>(undefined);
  const lastClockDisplayRef = useRef<number | null | undefined>(undefined);
  const lastAttemptPersistenceRef = useRef<{
    syncState: typeof runtimeState.attemptSyncState;
    pendingMutationCount: number;
    acceptedThroughSeq: number;
  } | null>(null);
  const lastPhaseRef = useRef<string | null>(null);
  const lastNavigationRef = useRef<{ module: ModuleType; questionId: string | null } | null>(null);
  const lastBlockingRef = useRef<{
    active: boolean;
    reason: typeof runtimeState.blocking.reason;
    timeRemaining: number;
  } | null>(null);

  useEffect(() => {
    // Tick-path: coalesced single write. Store's setRuntimeSnapshot bails out via
    // reference+value equality when unchanged, so this is safe to call every second
    // and will not fan out unless snapshot/displayTimeRemaining actually change.
    const nextDisplay = displayTimeRemaining ?? null;
    if (
      lastClockSnapshotRef.current !== runtimeState.runtimeSnapshot ||
      lastClockDisplayRef.current !== nextDisplay
    ) {
      lastClockSnapshotRef.current = runtimeState.runtimeSnapshot;
      lastClockDisplayRef.current = nextDisplay;
      examSessionCommands.setRuntimeSnapshot(runtimeState.runtimeSnapshot, nextDisplay);
    }

    // Non-clock slices: only write when their inputs actually change (ref-guarded).
    // This prevents the previous pattern of 4 unconditional writes per tick.
    const nextPending = attemptState.attempt?.recovery.pendingMutationCount ?? 0;
    const nextAccepted = attemptState.attempt?.recovery.serverAcceptedThroughSeq ?? 0;
    const nextPersistence = {
      syncState: runtimeState.attemptSyncState,
      pendingMutationCount: nextPending,
      acceptedThroughSeq: nextAccepted,
    };
    if (
      !lastAttemptPersistenceRef.current ||
      lastAttemptPersistenceRef.current.syncState !== nextPersistence.syncState ||
      lastAttemptPersistenceRef.current.pendingMutationCount !== nextPersistence.pendingMutationCount ||
      lastAttemptPersistenceRef.current.acceptedThroughSeq !== nextPersistence.acceptedThroughSeq
    ) {
      lastAttemptPersistenceRef.current = nextPersistence;
      examSessionCommands.setPersistence(nextPersistence);
    }

    if (lastPhaseRef.current !== runtimeState.phase) {
      lastPhaseRef.current = runtimeState.phase;
      examSessionCommands.setPhase(runtimeState.phase);
    }

    const nextNav: { module: ModuleType; questionId: string | null } = {
      module: runtimeState.currentModule,
      questionId: runtimeState.currentQuestionId,
    };
    if (
      !lastNavigationRef.current ||
      lastNavigationRef.current.module !== nextNav.module ||
      lastNavigationRef.current.questionId !== nextNav.questionId
    ) {
      lastNavigationRef.current = nextNav;
      examSessionCommands.setNavigation(nextNav.module, nextNav.questionId);
    }

    const nextBlocking = {
      active: runtimeState.blocking.active,
      reason: runtimeState.blocking.reason,
      timeRemaining: runtimeState.blocking.timeRemaining,
    };
    if (
      !lastBlockingRef.current ||
      lastBlockingRef.current.active !== nextBlocking.active ||
      lastBlockingRef.current.reason !== nextBlocking.reason ||
      lastBlockingRef.current.timeRemaining !== nextBlocking.timeRemaining
    ) {
      lastBlockingRef.current = nextBlocking;
      examSessionCommands.setBlocking(nextBlocking);
    }
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
