import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModuleType } from '../../types';
import type { RuntimeStatus } from '../../types/domain';

interface RuntimeStateSnapshot {
  runtimeBacked: boolean;
  runtimeStatus: RuntimeStatus | null;
  currentModule: ModuleType;
}

interface RuntimeStateRefValue {
  phase: 'pre-check' | 'lobby' | 'exam' | 'post-exam' | 'submitted';
  currentModule: ModuleType;
}

interface UseStudentSubmissionOrchestrationOptions {
  runtimeState: RuntimeStateSnapshot;
  runtimeStateRef: { current: RuntimeStateRefValue };
  attemptId: string | null;
  runtimeCompletionVerified: boolean;
  /**
   * FEX-050: the attempt is already authoritatively finalized
   * (attempt.submittedAt != null || attempt.proctorStatus === 'terminated').
   * A structurally-complete runtime with an un-finalized attempt MUST fire
   * the final-submit pipeline; a finalized attempt must never fire it again.
   */
  attemptFinalized: boolean;
  /**
   * FEX-051: a durable pending submission exists, so the provider's
   * background retry loop owns the submission identity (same frozen
   * snapshot). The pipeline must not double-drive it.
   */
  pendingSubmissionActive: boolean;
  flushDomAnswerControlsNow: () => void;
  reconcileLiveAnswerCacheNow: () => void;
  commitWritingDraft: () => void;
  attemptActions: {
    flushPending: () => Promise<boolean>;
    submitAttempt: () => Promise<boolean>;
  };
  runtimeActions: {
    transitionBlocking: (reason: 'syncing_reconnect' | 'offline', active: boolean) => void;
    submitModule: () => void;
  };
}

export function useStudentSubmissionOrchestration({
  runtimeState,
  runtimeStateRef,
  attemptId,
  runtimeCompletionVerified,
  attemptFinalized,
  pendingSubmissionActive,
  flushDomAnswerControlsNow,
  reconcileLiveAnswerCacheNow,
  commitWritingDraft,
  attemptActions,
  runtimeActions,
}: UseStudentSubmissionOrchestrationOptions) {
  const moduleSubmitInFlightRef = useRef<Promise<void> | null>(null);
  const moduleSubmitFingerprintRef = useRef<string | null>(null);
  const runtimeFinalSubmitRef = useRef<string | null>(null);
  const finalSubmitInFlightRef = useRef<Promise<void> | null>(null);
  const [finalSubmitStatus, setFinalSubmitStatus] = useState<
    'idle' | 'submitting' | 'retrying' | 'failed'
  >('idle');

  const flushPendingAnswers = useCallback(async () => {
    flushDomAnswerControlsNow();
    reconcileLiveAnswerCacheNow();
    commitWritingDraft();

    const flushed = await attemptActions.flushPending();
    if (flushed) {
      runtimeActions.transitionBlocking('syncing_reconnect', false);
      runtimeActions.transitionBlocking('offline', false);
    } else if (!navigator.onLine) {
      runtimeActions.transitionBlocking('offline', true);
    } else {
      runtimeActions.transitionBlocking('syncing_reconnect', true);
    }
    return flushed;
  }, [
    attemptActions,
    commitWritingDraft,
    flushDomAnswerControlsNow,
    reconcileLiveAnswerCacheNow,
    runtimeActions,
  ]);

  const flushAndSubmitCurrentModuleWithRetry = useCallback(
    async (fingerprint: string) => {
      if (
        moduleSubmitInFlightRef.current
        && moduleSubmitFingerprintRef.current === fingerprint
      ) {
        await moduleSubmitInFlightRef.current;
        return;
      }

      const moduleKey = runtimeStateRef.current.currentModule;
      moduleSubmitFingerprintRef.current = fingerprint;

      const promise = (async () => {
        let attemptIndex = 0;

        while (true) {
          const latestState = runtimeStateRef.current;
          if (latestState.phase !== 'exam') {
            return;
          }

          if (latestState.currentModule !== moduleKey) {
            return;
          }

          const flushed = await flushPendingAnswers();
          if (flushed) {
            runtimeActions.submitModule();
            return;
          }

          const backoffMs = Math.min(30_000, 1_000 * 2 ** attemptIndex);
          attemptIndex += 1;

          await new Promise<void>((resolve) => {
            window.setTimeout(() => resolve(), backoffMs);
          });
        }
      })();

      moduleSubmitInFlightRef.current = promise;
      try {
        await promise;
      } finally {
        if (moduleSubmitInFlightRef.current === promise) {
          moduleSubmitInFlightRef.current = null;
        }
      }
    },
    [
      attemptActions,
      commitWritingDraft,
      flushDomAnswerControlsNow,
      flushPendingAnswers,
      reconcileLiveAnswerCacheNow,
      runtimeActions,
      runtimeStateRef,
    ],
  );

  useEffect(() => {
    // FEX-052: a running pipeline must never be torn down by a stale runtime
    // re-delivery (e.g. a nonterminal snapshot arriving mid-flight). While
    // finalSubmitInFlightRef is set, leave the refs and the visible status
    // untouched so the running pipeline finishes: its success sets
    // runtimeFinalSubmitRef (blocking future pipelines), its failure leaves
    // 'failed' (a later re-completed runtime may legitimately retry — that is
    // the retry contract, not a duplicate).
    const finalSubmitInFlight = finalSubmitInFlightRef.current != null;

    if (!runtimeState.runtimeBacked) {
      if (!finalSubmitInFlight) {
        runtimeFinalSubmitRef.current = null;
        setFinalSubmitStatus('idle');
      }
      return;
    }

    if (runtimeState.runtimeStatus !== 'completed' || !runtimeCompletionVerified) {
      if (!finalSubmitInFlight) {
        runtimeFinalSubmitRef.current = null;
        setFinalSubmitStatus('idle');
      }
      return;
    }

    // FEX-050: a structurally-complete runtime with an un-finalized attempt
    // must fire the pipeline. Authoritative end states (submittedAt,
    // proctor-terminated) and an active durable pending submission (whose
    // retry loop owns the submission identity) must not.
    //
    // 'failed' is terminal for the current completion episode: the effect
    // re-runs on every re-render (the app passes fresh action objects), so
    // without this guard a re-render right after the sixth failed attempt
    // would start a SECOND six-attempt pipeline (FEX-052 duplicate retry
    // loops). Only the reset branches (runtime leaving 'completed' or
    // un-verified, i.e. a later re-completed runtime) clear the status and
    // legitimately allow a fresh retry.
    if (attemptFinalized || pendingSubmissionActive || finalSubmitStatus === 'failed') {
      return;
    }

    if (!attemptId) {
      return;
    }

    if (runtimeFinalSubmitRef.current === attemptId) {
      return;
    }

    if (finalSubmitInFlightRef.current) {
      return;
    }

    finalSubmitInFlightRef.current = (async () => {
      const maxAttempts = 6;
      for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
        setFinalSubmitStatus(attemptIndex === 0 ? 'submitting' : 'retrying');

        try {
          flushDomAnswerControlsNow();
          reconcileLiveAnswerCacheNow();
          commitWritingDraft();
          const submitted = await attemptActions.submitAttempt();
          if (submitted) {
            runtimeFinalSubmitRef.current = attemptId;
            setFinalSubmitStatus('idle');
            return;
          }
        } catch {
          // ignore and retry
        }

        const backoffMs = Math.min(30_000, 1_000 * 2 ** attemptIndex);
        await new Promise<void>((resolve) => {
          window.setTimeout(() => resolve(), backoffMs);
        });
      }

      setFinalSubmitStatus('failed');
    })();

    void finalSubmitInFlightRef.current.finally(() => {
      finalSubmitInFlightRef.current = null;
    });
  }, [
    attemptActions,
    attemptFinalized,
    attemptId,
    commitWritingDraft,
    finalSubmitStatus,
    flushDomAnswerControlsNow,
    pendingSubmissionActive,
    reconcileLiveAnswerCacheNow,
    runtimeCompletionVerified,
    runtimeState.runtimeBacked,
    runtimeState.runtimeStatus,
  ]);

  return {
    finalSubmitStatus,
    flushAndSubmitCurrentModuleWithRetry,
    flushPendingAnswers,
  };
}
