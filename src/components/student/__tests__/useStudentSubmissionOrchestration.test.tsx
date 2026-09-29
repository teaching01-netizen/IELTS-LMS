import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useStudentSubmissionOrchestration } from "../useStudentSubmissionOrchestration";

describe("useStudentSubmissionOrchestration", () => {
  it("flushes and submits current module when pending mutations are persisted", async () => {
    const reconcileLiveAnswerCacheNow = vi.fn();
    const commitWritingDraft = vi.fn();
    const flushPending = vi.fn().mockResolvedValue(true);
    const transitionBlocking = vi.fn();
    const submitModule = vi.fn();

    const runtimeStateRef = {
      current: {
        phase: "exam" as const,
        currentModule: "reading" as const,
      },
    };

    const { result } = renderHook(() =>
      useStudentSubmissionOrchestration({
        runtimeState: {
          runtimeBacked: false,
          runtimeStatus: null,
          currentModule: "reading",
        },
        runtimeStateRef,
        attemptId: null,
        runtimeCompletionVerified: false,
        shouldRenderPostExam: false,
        reconcileLiveAnswerCacheNow,
        commitWritingDraft,
        attemptActions: {
          flushPending,
          submitAttempt: vi.fn(),
        },
        runtimeActions: {
          transitionBlocking,
          submitModule,
        },
      })
    );

    await act(async () => {
      await result.current.flushAndSubmitCurrentModuleWithRetry("manual:reading");
    });

    expect(reconcileLiveAnswerCacheNow).toHaveBeenCalledTimes(1);
    expect(commitWritingDraft).toHaveBeenCalledTimes(1);
    expect(flushPending).toHaveBeenCalledTimes(1);
    expect(transitionBlocking).toHaveBeenCalledWith("syncing_reconnect", false);
    expect(transitionBlocking).toHaveBeenCalledWith("offline", false);
    expect(submitModule).toHaveBeenCalledTimes(1);
  });

  it("finalizes the attempt immediately when the runtime deadline closes the final module", async () => {
    const submitAttempt = vi.fn().mockResolvedValue(true);
    const submitModule = vi.fn();

    const { result } = renderHook(() =>
      useStudentSubmissionOrchestration({
        runtimeState: {
          runtimeBacked: true,
          runtimeStatus: "live",
          currentModule: "science",
        },
        runtimeStateRef: {
          current: {
            phase: "exam",
            currentModule: "science",
          },
        },
        attemptId: "attempt-final-deadline",
        runtimeCompletionVerified: false,
        shouldRenderPostExam: false,
        isFinalModule: () => true,
        reconcileLiveAnswerCacheNow: vi.fn(),
        commitWritingDraft: vi.fn(),
        attemptActions: {
          flushPending: vi.fn().mockResolvedValue(true),
          submitAttempt,
        },
        runtimeActions: {
          transitionBlocking: vi.fn(),
          submitModule,
        },
      })
    );

    await act(async () => {
      await result.current.flushAndSubmitCurrentModuleWithRetry("runtime:science");
    });

    expect(submitAttempt).toHaveBeenCalledTimes(1);
    expect(submitModule).not.toHaveBeenCalled();
  });

  it("uses the application submission coordinator for a final runtime module", async () => {
    const requestSubmit = vi.fn().mockResolvedValue({ kind: "submitted" as const });
    const flushBarrier = vi.fn().mockResolvedValue({ kind: "ready" as const });
    const submitModule = vi.fn();

    const { result } = renderHook(() =>
      useStudentSubmissionOrchestration({
        runtimeState: {
          runtimeBacked: true,
          runtimeStatus: "live",
          currentModule: "reading",
        },
        runtimeStateRef: {
          current: {
            phase: "exam",
            currentModule: "reading",
          },
        },
        attemptId: "attempt-final-coordinator",
        runtimeCompletionVerified: false,
        shouldRenderPostExam: false,
        isFinalModule: () => true,
        reconcileLiveAnswerCacheNow: vi.fn(),
        commitWritingDraft: vi.fn(),
        attemptActions: {
          flushPending: vi.fn().mockResolvedValue(true),
          submitAttempt: vi.fn(),
        },
        submissionCommands: {
          flushBarrier,
          requestSubmit,
          submitAfterBarrier: requestSubmit,
        },
        runtimeActions: {
          transitionBlocking: vi.fn(),
          submitModule,
        },
      })
    );

    await act(async () => {
      await result.current.flushAndSubmitCurrentModuleWithRetry("runtime:reading");
    });

    expect(flushBarrier).toHaveBeenCalledTimes(1);
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    expect(submitModule).not.toHaveBeenCalled();
  });

  it("advances an intermediate runtime module instead of finalizing the attempt", async () => {
    const submitAttempt = vi.fn().mockResolvedValue(true);
    const submitModule = vi.fn();

    const { result } = renderHook(() =>
      useStudentSubmissionOrchestration({
        runtimeState: {
          runtimeBacked: true,
          runtimeStatus: "live",
          currentModule: "reading",
        },
        runtimeStateRef: {
          current: {
            phase: "exam",
            currentModule: "reading",
          },
        },
        attemptId: "attempt-intermediate-runtime",
        runtimeCompletionVerified: false,
        shouldRenderPostExam: false,
        isFinalModule: () => false,
        reconcileLiveAnswerCacheNow: vi.fn(),
        commitWritingDraft: vi.fn(),
        attemptActions: {
          flushPending: vi.fn().mockResolvedValue(true),
          submitAttempt,
        },
        runtimeActions: {
          transitionBlocking: vi.fn(),
          submitModule,
        },
      })
    );

    await act(async () => {
      await result.current.flushAndSubmitCurrentModuleWithRetry("runtime:reading");
    });

    expect(submitModule).toHaveBeenCalledTimes(1);
    expect(submitAttempt).not.toHaveBeenCalled();
  });

  it("triggers runtime final-submit pipeline when runtime is completed", async () => {
    const submitAttempt = vi.fn().mockResolvedValue(true);

    const { result } = renderHook(() =>
      useStudentSubmissionOrchestration({
        runtimeState: {
          runtimeBacked: true,
          runtimeStatus: "completed",
          currentModule: "reading",
        },
        runtimeStateRef: {
          current: {
            phase: "exam",
            currentModule: "reading",
          },
        },
        attemptId: "attempt-1",
        runtimeCompletionVerified: true,
        shouldRenderPostExam: false,
        reconcileLiveAnswerCacheNow: vi.fn(),
        commitWritingDraft: vi.fn(),
        attemptActions: {
          flushPending: vi.fn().mockResolvedValue(true),
          submitAttempt,
        },
        runtimeActions: {
          transitionBlocking: vi.fn(),
          submitModule: vi.fn(),
        },
      })
    );

    await waitFor(() => {
      expect(submitAttempt).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(result.current.finalSubmitStatus).toBe("idle");
    });
  });

  it("does not retry a submission that is already terminal", async () => {
    const submitAttempt = vi.fn().mockResolvedValue(true);

    const { result } = renderHook(() =>
      useStudentSubmissionOrchestration({
        runtimeState: {
          runtimeBacked: true,
          runtimeStatus: "completed",
          currentModule: "reading",
        },
        runtimeStateRef: {
          current: {
            phase: "post-exam",
            currentModule: "reading",
          },
        },
        attemptId: "attempt-terminal",
        runtimeCompletionVerified: true,
        shouldRenderPostExam: true,
        reconcileLiveAnswerCacheNow: vi.fn(),
        commitWritingDraft: vi.fn(),
        attemptActions: {
          flushPending: vi.fn().mockResolvedValue(true),
          submitAttempt,
        },
        runtimeActions: {
          transitionBlocking: vi.fn(),
          submitModule: vi.fn(),
        },
      })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(submitAttempt).not.toHaveBeenCalled();
    expect(result.current.finalSubmitStatus).toBe("idle");
  });

  it("suppresses a stale final-submit loop after terminal state is confirmed", async () => {
    let resolveSubmit: ((value: boolean) => void) | undefined;
    const submitAttempt = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSubmit = resolve;
        })
    );
    const runtimeState = {
      runtimeBacked: true,
      runtimeStatus: "completed" as const,
      currentModule: "reading" as const,
    };
    const runtimeStateRef = {
      current: {
        phase: "exam" as const,
        currentModule: "reading" as const,
      },
    };

    const { result, rerender } = renderHook(
      ({ shouldRenderPostExam }) =>
        useStudentSubmissionOrchestration({
          runtimeState,
          runtimeStateRef,
          attemptId: "attempt-race",
          runtimeCompletionVerified: true,
          shouldRenderPostExam,
          reconcileLiveAnswerCacheNow: vi.fn(),
          commitWritingDraft: vi.fn(),
          attemptActions: {
            flushPending: vi.fn().mockResolvedValue(true),
            submitAttempt,
          },
          runtimeActions: {
            transitionBlocking: vi.fn(),
            submitModule: vi.fn(),
          },
        }),
      { initialProps: { shouldRenderPostExam: false } }
    );

    await waitFor(() => {
      expect(submitAttempt).toHaveBeenCalledTimes(1);
      expect(result.current.finalSubmitStatus).toBe("submitting");
    });

    rerender({ shouldRenderPostExam: true });
    await waitFor(() => {
      expect(result.current.finalSubmitStatus).toBe("idle");
    });

    await act(async () => {
      resolveSubmit?.(false);
      await Promise.resolve();
    });
    expect(result.current.finalSubmitStatus).toBe("idle");
  });

  it("cancels module retries after unmount", async () => {
    vi.useFakeTimers();
    const flushPending = vi.fn().mockResolvedValue(false);
    const transitionBlocking = vi.fn();
    const submitModule = vi.fn();
    const runtimeStateRef = {
      current: {
        phase: "exam" as const,
        currentModule: "reading" as const,
      },
    };

    const { result, unmount } = renderHook(() =>
      useStudentSubmissionOrchestration({
        runtimeState: {
          runtimeBacked: false,
          runtimeStatus: null,
          currentModule: "reading",
        },
        runtimeStateRef,
        attemptId: null,
        runtimeCompletionVerified: false,
        shouldRenderPostExam: false,
        reconcileLiveAnswerCacheNow: vi.fn(),
        commitWritingDraft: vi.fn(),
        attemptActions: {
          flushPending,
          submitAttempt: vi.fn(),
        },
        runtimeActions: {
          transitionBlocking,
          submitModule,
        },
      })
    );

    let retryPromise: Promise<void> | undefined;
    await act(async () => {
      retryPromise = result.current.flushAndSubmitCurrentModuleWithRetry("auto:reading");
      await Promise.resolve();
    });

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000);
      await retryPromise;
    });

    expect(flushPending).toHaveBeenCalledTimes(1);
    expect(submitModule).not.toHaveBeenCalled();
    expect(transitionBlocking).toHaveBeenCalledTimes(1);
  });
});
