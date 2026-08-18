import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModuleType } from '../../types';
import type { RuntimeStatus } from '../../types/domain';
import type { StudentSubmissionCommands } from '@student/application/exam-session/submissionCommands';

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
  finalSubmissionPending: boolean;
  runtimeCompletionVerified: boolean;
  shouldRenderPostExam: boolean;
  reconcileLiveAnswerCacheNow: () => void;
  commitWritingDraft: () => void;
  attemptActions: {
    flushPending: () => Promise<boolean>;
    submitAttempt: () => Promise<boolean>;
  };
  submissionCommands?: StudentSubmissionCommands;
  runtimeActions: {
    transitionBlocking: (reason: 'syncing_reconnect' | 'offline', active: boolean) => void;
    submitModule: () => void;
  };
}

function waitForRetry(signal: AbortSignal, delayMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    let timerId: number | null = null;
    const onAbort = () => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
      signal.removeEventListener('abort', onAbort);
      resolve(false);
    };

    timerId = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      timerId = null;
      resolve(true);
    }, delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
export function useStudentSubmissionOrchestration({
  runtimeState,
  runtimeStateRef,
  attemptId,
  finalSubmissionPending,
  runtimeCompletionVerified,
  shouldRenderPostExam,
  reconcileLiveAnswerCacheNow,
  commitWritingDraft,
  attemptActions,
  runtimeActions,
  submissionCommands,
}: UseStudentSubmissionOrchestrationOptions) {
  const moduleSubmitInFlightRef = useRef<Promise<void> | null>(null);
  const moduleSubmitFingerprintRef = useRef<string | null>(null);
  const runtimeFinalSubmitRef = useRef<string | null>(null);
  const finalSubmitInFlightRef = useRef<Promise<void> | null>(null);
  const cancellationControllerRef = useRef(new AbortController());
  const cancellationSignal = cancellationControllerRef.current.signal;
  const [finalSubmitStatus, setFinalSubmitStatus] = useState<
    'idle' | 'submitting' | 'retrying' | 'failed'
  >('idle');

  useEffect(() => {
    return () => {
      cancellationControllerRef.current.abort();
    };
  }, []);

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
          if (cancellationSignal.aborted) {
            return;
          }

          const latestState = runtimeStateRef.current;
          if (latestState.phase !== 'exam' || latestState.currentModule !== moduleKey) {
            return;
          }

          let flushed: boolean;
          if (submissionCommands) {
            const barrierResult = await submissionCommands.flushBarrier();
            if (cancellationSignal.aborted) {
              return;
            }
            flushed = barrierResult.kind === 'ready';
          } else {
            reconcileLiveAnswerCacheNow();
            commitWritingDraft();
            if (cancellationSignal.aborted) {
              return;
            }
            flushed = await attemptActions.flushPending();
            if (cancellationSignal.aborted) {
              return;
            }
          }

          if (flushed) {
            runtimeActions.transitionBlocking('syncing_reconnect', false);
            runtimeActions.transitionBlocking('offline', false);
            if (cancellationSignal.aborted) {
              return;
            }
            runtimeActions.submitModule();
            return;
          }

          if (cancellationSignal.aborted) {
            return;
          }
          if (!navigator.onLine) {
            runtimeActions.transitionBlocking('offline', true);
          } else {
            runtimeActions.transitionBlocking('syncing_reconnect', true);
          }

          const backoffMs = Math.min(30_000, 1_000 * 2 ** attemptIndex);
          attemptIndex += 1;
          if (!(await waitForRetry(cancellationSignal, backoffMs))) {
            return;
          }
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
      cancellationSignal,
      commitWritingDraft,
      reconcileLiveAnswerCacheNow,
      runtimeActions,
      runtimeStateRef,
      submissionCommands,
    ],
  );

  const runFinalSubmitLoop = useCallback(() => {
    if (finalSubmitInFlightRef.current) {
      return;
    }

    const promise = (async () => {
      const maxAttempts = 6;
      for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
        if (cancellationSignal.aborted) {
          return;
        }
        setFinalSubmitStatus(attemptIndex === 0 ? 'submitting' : 'retrying');

        try {
          const submitted = submissionCommands
            ? (await submissionCommands.requestSubmit()).kind === 'submitted'
            : await (async () => {
                reconcileLiveAnswerCacheNow();
                commitWritingDraft();
                if (cancellationSignal.aborted) {
                  return false;
                }
                return attemptActions.submitAttempt();
              })();
          if (cancellationSignal.aborted) {
            return;
          }
          if (submitted) {
            runtimeFinalSubmitRef.current = attemptId;
            setFinalSubmitStatus('idle');
            return;
          }
        } catch {
          if (cancellationSignal.aborted) {
            return;
          }
        }

        const backoffMs = Math.min(30_000, 1_000 * 2 ** attemptIndex);
        if (!(await waitForRetry(cancellationSignal, backoffMs))) {
          return;
        }
      }

      if (!cancellationSignal.aborted) {
        setFinalSubmitStatus('failed');
      }
    })();

    finalSubmitInFlightRef.current = promise;
    void promise.finally(() => {
      if (finalSubmitInFlightRef.current === promise) {
        finalSubmitInFlightRef.current = null;
      }
    });
  }, [
    attemptActions,
    attemptId,
    cancellationSignal,
    commitWritingDraft,
    reconcileLiveAnswerCacheNow,
    submissionCommands,
  ]);

  useEffect(() => {
    if (cancellationSignal.aborted) {
      return;
    }

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

    if ((!finalSubmissionPending && shouldRenderPostExam) || !attemptId) {
      return;
    }

    if (runtimeFinalSubmitRef.current === attemptId) {
      return;
    }

    runFinalSubmitLoop();
  }, [
    attemptId,
    cancellationSignal,
    finalSubmissionPending,
    runFinalSubmitLoop,
    runtimeCompletionVerified,
    runtimeState.runtimeBacked,
    runtimeState.runtimeStatus,
    shouldRenderPostExam,
  ]);

  const retryFinalSubmit = useCallback(() => {
    if (runtimeFinalSubmitRef.current || finalSubmitInFlightRef.current) {
      return;
    }
    runFinalSubmitLoop();
  }, [runFinalSubmitLoop]);

  return {
    finalSubmitStatus,
    flushAndSubmitCurrentModuleWithRetry,
    retryFinalSubmit,
  };
}
