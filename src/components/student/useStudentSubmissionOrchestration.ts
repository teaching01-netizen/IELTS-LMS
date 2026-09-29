import { useCallback, useEffect, useRef, useState } from "react";
import type { ModuleType } from "../../types";
import type { RuntimeStatus } from "../../types/domain";
import type { StudentSubmissionCommands } from "@student/application/exam-session/submissionCommands";

interface RuntimeStateSnapshot {
  runtimeBacked: boolean;
  runtimeStatus: RuntimeStatus | null;
  currentModule: ModuleType;
}

interface RuntimeStateRefValue {
  phase: "pre-check" | "lobby" | "exam" | "post-exam" | "submitted";
  currentModule: ModuleType;
}

interface UseStudentSubmissionOrchestrationOptions {
  runtimeState: RuntimeStateSnapshot;
  runtimeStateRef: { current: RuntimeStateRefValue };
  attemptId: string | null;
  runtimeCompletionVerified: boolean;
  shouldRenderPostExam: boolean;
  isFinalModule?: (module: ModuleType) => boolean;
  reconcileLiveAnswerCacheNow: () => void;
  commitWritingDraft: () => void;
  attemptActions: {
    flushPending: () => Promise<boolean>;
    submitAttempt: () => Promise<boolean>;
    submitAttemptAfterBarrier?: () => Promise<boolean>;
  };
  submissionCommands?: StudentSubmissionCommands;
  runtimeActions: {
    transitionBlocking: (reason: "syncing_reconnect" | "offline", active: boolean) => void;
    submitModule: () => void;
  };
}

/** Cap module-submit retries so a persistently failing flush surfaces an error
 *  instead of retrying forever (backoff continues to ~30s between attempts). */
export const STUDENT_MODULE_SUBMIT_MAX_RETRIES = 10;

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
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    };

    timerId = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      timerId = null;
      resolve(true);
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
export function useStudentSubmissionOrchestration({
  runtimeState,
  runtimeStateRef,
  attemptId,
  runtimeCompletionVerified,
  shouldRenderPostExam,
  isFinalModule,
  reconcileLiveAnswerCacheNow,
  commitWritingDraft,
  attemptActions,
  runtimeActions,
  submissionCommands,
}: UseStudentSubmissionOrchestrationOptions) {
  const moduleSubmitInFlightRef = useRef<Promise<void> | null>(null);
  const moduleSubmitFingerprintRef = useRef<string | null>(null);
  const [moduleSubmitStatus, setModuleSubmitStatus] = useState<"idle" | "submitting" | "failed">(
    "idle"
  );
  const [moduleSubmitError, setModuleSubmitError] = useState<string | null>(null);
  const runtimeFinalSubmitRef = useRef<string | null>(null);
  const finalSubmitInFlightRef = useRef<Promise<void> | null>(null);
  const cancellationControllerRef = useRef(new AbortController());
  const cancellationSignal = cancellationControllerRef.current.signal;
  const [finalSubmitStatus, setFinalSubmitStatus] = useState<
    "idle" | "submitting" | "retrying" | "failed"
  >("idle");
  const finalSubmitGenerationRef = useRef(0);

  useEffect(() => {
    return () => {
      cancellationControllerRef.current.abort();
    };
  }, []);

  const flushAndSubmitCurrentModuleWithRetry = useCallback(
    async (fingerprint: string) => {
      // Manual submit (`manual:<module>`) and auto-submit (`self|runtime:<module>`)
      // share one dedupe namespace per module so a double trigger (keyboard +
      // button, timer + boundary) cannot fan out into duplicate submissions.
      const canonicalFingerprint = fingerprint.replace(/^(manual|auto|self|runtime):/, "submit:");
      if (
        moduleSubmitInFlightRef.current &&
        moduleSubmitFingerprintRef.current === canonicalFingerprint
      ) {
        await moduleSubmitInFlightRef.current;
        return;
      }

      const moduleKey = runtimeStateRef.current.currentModule;
      moduleSubmitFingerprintRef.current = canonicalFingerprint;
      setModuleSubmitStatus("submitting");
      setModuleSubmitError(null);

      const promise = (async () => {
        let attemptIndex = 0;

        while (attemptIndex <= STUDENT_MODULE_SUBMIT_MAX_RETRIES) {
          if (cancellationSignal.aborted) {
            return;
          }

          const latestState = runtimeStateRef.current;
          if (latestState.phase !== "exam" || latestState.currentModule !== moduleKey) {
            setModuleSubmitStatus("idle");
            return;
          }

          let flushed: boolean;
          if (submissionCommands) {
            const barrierResult = await submissionCommands.flushBarrier();
            if (cancellationSignal.aborted) {
              return;
            }
            flushed = barrierResult.kind === "ready";
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
            runtimeActions.transitionBlocking("syncing_reconnect", false);
            runtimeActions.transitionBlocking("offline", false);
            if (cancellationSignal.aborted) {
              return;
            }
            const shouldFinalizeAttempt =
              fingerprint.startsWith("runtime:") &&
              runtimeState.runtimeBacked &&
              isFinalModule?.(moduleKey) === true;
            if (shouldFinalizeAttempt) {
              const submitted = submissionCommands
                ? (await submissionCommands.submitAfterBarrier()).kind === "submitted"
                : await (
                    attemptActions.submitAttemptAfterBarrier?.() ?? attemptActions.submitAttempt()
                  );
              if (submitted) {
                setModuleSubmitStatus("idle");
                return;
              }
            } else {
              runtimeActions.submitModule();
              setModuleSubmitStatus("idle");
              return;
            }
          }

          if (attemptIndex >= STUDENT_MODULE_SUBMIT_MAX_RETRIES) {
            break;
          }

          if (cancellationSignal.aborted) {
            return;
          }
          if (!navigator.onLine) {
            runtimeActions.transitionBlocking("offline", true);
          } else {
            runtimeActions.transitionBlocking("syncing_reconnect", true);
          }

          const backoffMs = Math.min(30_000, 1_000 * 2 ** attemptIndex);
          attemptIndex += 1;
          if (!(await waitForRetry(cancellationSignal, backoffMs))) {
            return;
          }
        }

        if (!cancellationSignal.aborted) {
          setModuleSubmitStatus("failed");
          setModuleSubmitError(
            "Could not save your answers after several tries. Stay on this page and check your connection."
          );
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
      runtimeState.runtimeBacked,
      isFinalModule,
      submissionCommands,
    ]
  );

  const runFinalSubmitLoop = useCallback(() => {
    if (finalSubmitInFlightRef.current) {
      return;
    }

    const promise = (async () => {
      const maxAttempts = 6;
      const generation = finalSubmitGenerationRef.current;
      const isActive = () =>
        !cancellationSignal.aborted && finalSubmitGenerationRef.current === generation;
      for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
        if (!isActive()) {
          return;
        }
        setFinalSubmitStatus(attemptIndex === 0 ? "submitting" : "retrying");

        try {
          const submitted = submissionCommands
            ? (await submissionCommands.requestSubmit()).kind === "submitted"
            : await (async () => {
                reconcileLiveAnswerCacheNow();
                commitWritingDraft();
                if (!isActive()) {
                  return false;
                }
                return attemptActions.submitAttempt();
              })();
          if (!isActive()) {
            return;
          }
          if (submitted) {
            runtimeFinalSubmitRef.current = attemptId;
            setFinalSubmitStatus("idle");
            return;
          }
        } catch {
          if (!isActive()) {
            return;
          }
        }

        const backoffMs = Math.min(30_000, 1_000 * 2 ** attemptIndex);
        if (!(await waitForRetry(cancellationSignal, backoffMs)) || !isActive()) {
          return;
        }
      }

      if (isActive()) {
        setFinalSubmitStatus("failed");
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
      finalSubmitGenerationRef.current += 1;
      runtimeFinalSubmitRef.current = null;
      finalSubmitInFlightRef.current = null;
      setFinalSubmitStatus("idle");
      return;
    }

    if (runtimeState.runtimeStatus !== "completed" || !runtimeCompletionVerified) {
      finalSubmitGenerationRef.current += 1;
      runtimeFinalSubmitRef.current = null;
      finalSubmitInFlightRef.current = null;
      setFinalSubmitStatus("idle");
      return;
    }

    if (shouldRenderPostExam || !attemptId) {
      finalSubmitGenerationRef.current += 1;
      finalSubmitInFlightRef.current = null;
      setFinalSubmitStatus("idle");
      return;
    }

    if (runtimeFinalSubmitRef.current === attemptId) {
      return;
    }

    runFinalSubmitLoop();
  }, [
    attemptId,
    cancellationSignal,
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

  const retryModuleSubmit = useCallback(
    async (fingerprint: string) => {
      if (moduleSubmitInFlightRef.current) {
        return;
      }
      setModuleSubmitStatus("idle");
      setModuleSubmitError(null);
      await flushAndSubmitCurrentModuleWithRetry(fingerprint);
    },
    [flushAndSubmitCurrentModuleWithRetry]
  );

  return {
    finalSubmitStatus,
    flushAndSubmitCurrentModuleWithRetry,
    retryFinalSubmit,
    moduleSubmitStatus,
    moduleSubmitError,
    retryModuleSubmit,
  };
}
