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
  shouldRenderPostExam: boolean;
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
  shouldRenderPostExam,
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

          flushDomAnswerControlsNow();
          reconcileLiveAnswerCacheNow();
          commitWritingDraft();
          const flushed = await attemptActions.flushPending();
          if (flushed) {
            runtimeActions.transitionBlocking('syncing_reconnect', false);
            runtimeActions.transitionBlocking('offline', false);
            runtimeActions.submitModule();
            return;
          }

          if (!navigator.onLine) {
            runtimeActions.transitionBlocking('offline', true);
          } else {
            runtimeActions.transitionBlocking('syncing_reconnect', true);
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
      reconcileLiveAnswerCacheNow,
      runtimeActions,
      runtimeStateRef,
    ],
  );

  useEffect(() => {
    if (!runtimeState.runtimeBacked) {
      runtimeFinalSubmitRef.current = null;
      finalSubmitInFlightRef.current = null;
      setFinalSubmitStatus('idle');
      return;
    }

    if (runtimeState.runtimeStatus !== 'completed' || !runtimeCompletionVerified) {
      runtimeFinalSubmitRef.current = null;
      finalSubmitInFlightRef.current = null;
      setFinalSubmitStatus('idle');
      return;
    }

    if (shouldRenderPostExam) {
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
    attemptId,
    commitWritingDraft,
    flushDomAnswerControlsNow,
    reconcileLiveAnswerCacheNow,
    runtimeCompletionVerified,
    runtimeState.runtimeBacked,
    runtimeState.runtimeStatus,
    shouldRenderPostExam,
  ]);

  return {
    finalSubmitStatus,
    flushAndSubmitCurrentModuleWithRetry,
  };
}
