import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  useStudentSubmissionOrchestration,
  type UseStudentSubmissionOrchestrationOptions,
} from '../useStudentSubmissionOrchestration';

describe('useStudentSubmissionOrchestration', () => {
  it('flushes and submits current module when pending mutations are persisted', async () => {
    const flushDomAnswerControlsNow = vi.fn();
    const reconcileLiveAnswerCacheNow = vi.fn();
    const commitWritingDraft = vi.fn();
    const flushPending = vi.fn().mockResolvedValue(true);
    const transitionBlocking = vi.fn();
    const submitModule = vi.fn();

    const runtimeStateRef = {
      current: {
        phase: 'exam' as const,
        currentModule: 'reading' as const,
      },
    };

    const { result } = renderHook(() =>
      useStudentSubmissionOrchestration({
        runtimeState: {
          runtimeBacked: false,
          runtimeStatus: null,
          currentModule: 'reading',
        },
        runtimeStateRef,
        attemptId: null,
        runtimeCompletionVerified: false,
        attemptFinalized: false,
        pendingSubmissionActive: false,
        flushDomAnswerControlsNow,
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
      }),
    );

    await act(async () => {
      await result.current.flushAndSubmitCurrentModuleWithRetry('manual:reading');
    });

    expect(flushDomAnswerControlsNow).toHaveBeenCalledTimes(1);
    expect(reconcileLiveAnswerCacheNow).toHaveBeenCalledTimes(1);
    expect(commitWritingDraft).toHaveBeenCalledTimes(1);
    expect(flushPending).toHaveBeenCalledTimes(1);
    expect(transitionBlocking).toHaveBeenCalledWith('syncing_reconnect', false);
    expect(transitionBlocking).toHaveBeenCalledWith('offline', false);
    expect(submitModule).toHaveBeenCalledTimes(1);
  });

  it('triggers runtime final-submit pipeline when runtime is completed', async () => {
    const submitAttempt = vi.fn().mockResolvedValue(true);

    const { result } = renderHook(() =>
      useStudentSubmissionOrchestration({
        runtimeState: {
          runtimeBacked: true,
          runtimeStatus: 'completed',
          currentModule: 'reading',
        },
        runtimeStateRef: {
          current: {
            phase: 'exam',
            currentModule: 'reading',
          },
        },
        attemptId: 'attempt-1',
        runtimeCompletionVerified: true,
        attemptFinalized: false,
        pendingSubmissionActive: false,
        flushDomAnswerControlsNow: vi.fn(),
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
    );

    await waitFor(() => {
      expect(submitAttempt).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(result.current.finalSubmitStatus).toBe('idle');
    });
  });

  it('does not duplicate the final submit under StrictMode double effects (FEX-052)', async () => {
    const submitAttempt = vi.fn().mockResolvedValue(true);

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <React.StrictMode>{children}</React.StrictMode>
    );

    const { result } = renderHook(
      () =>
        useStudentSubmissionOrchestration({
          runtimeState: {
            runtimeBacked: true,
            runtimeStatus: 'completed',
            currentModule: 'reading',
          },
          runtimeStateRef: {
            current: {
              phase: 'exam',
              currentModule: 'reading',
            },
          },
          attemptId: 'attempt-1',
          runtimeCompletionVerified: true,
          attemptFinalized: false,
          pendingSubmissionActive: false,
          flushDomAnswerControlsNow: vi.fn(),
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
      { wrapper },
    );

    await waitFor(() => {
      expect(submitAttempt).toHaveBeenCalledTimes(1);
    });

    // Give any duplicate effect pass the chance to fire, then confirm there is
    // exactly one submit call and the pipeline returns to idle.
    await waitFor(() => {
      expect(result.current.finalSubmitStatus).toBe('idle');
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(submitAttempt).toHaveBeenCalledTimes(1);
  });

  it('emitted the section-submit pipeline in the FEX-041 order: DOM controls, live cache, writing draft, then pending flush (FEX-041 steps 1-4)', async () => {
    const order: string[] = [];
    const flushDomAnswerControlsNow = vi.fn(() => {
      order.push('flushDom');
    });
    const reconcileLiveAnswerCacheNow = vi.fn(() => {
      order.push('reconcile');
    });
    const commitWritingDraft = vi.fn(() => {
      order.push('commit');
    });
    const flushPending = vi.fn(async () => {
      order.push('flushPending');
      return true;
    });
    const transitionBlocking = vi.fn();
    const submitModule = vi.fn();

    const runtimeStateRef = {
      current: {
        phase: 'exam' as const,
        currentModule: 'reading' as const,
      },
    };

    const { result } = renderHook(() =>
      useStudentSubmissionOrchestration({
        runtimeState: {
          runtimeBacked: false,
          runtimeStatus: null,
          currentModule: 'reading',
        },
        runtimeStateRef,
        attemptId: null,
        runtimeCompletionVerified: false,
        attemptFinalized: false,
        pendingSubmissionActive: false,
        flushDomAnswerControlsNow,
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
      }),
    );

    await act(async () => {
      await result.current.flushAndSubmitCurrentModuleWithRetry('manual:reading');
    });

    // FEX-041 steps 1-3-2-4 in spec numbering: the current DOM controls emit
    // their latest values, the live answer cache is reconciled, the writing
    // draft is committed, and only then are pending mutations flushed.
    expect(order).toEqual(['flushDom', 'reconcile', 'commit', 'flushPending']);
    expect(submitModule).toHaveBeenCalledTimes(1);
  });

  it('retried a failed section flush with exponential backoff and reconnect blocking, then submitted exactly once after the flush succeeded (FEX-041 #5/#6, FEX-042 connection drop)', async () => {
    const originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    vi.useFakeTimers();
    try {
      const flushPending = vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true);
      const transitionBlocking = vi.fn();
      const submitModule = vi.fn();

      const runtimeStateRef = {
        current: {
          phase: 'exam' as const,
          currentModule: 'reading' as const,
        },
      };

      const { result } = renderHook(() =>
        useStudentSubmissionOrchestration({
          runtimeState: {
            runtimeBacked: false,
            runtimeStatus: null,
            currentModule: 'reading',
          },
          runtimeStateRef,
          attemptId: null,
          runtimeCompletionVerified: false,
          attemptFinalized: false,
          pendingSubmissionActive: false,
          flushDomAnswerControlsNow: vi.fn(),
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
        }),
      );

      let submitPromise: Promise<void> | undefined;
      await act(async () => {
        submitPromise = result.current.flushAndSubmitCurrentModuleWithRetry('manual:reading');
      });

      // The first flush failed while online: reconnect blocking is shown and
      // the section must NOT transition.
      expect(flushPending).toHaveBeenCalledTimes(1);
      expect(submitModule).not.toHaveBeenCalled();
      expect(transitionBlocking).toHaveBeenCalledWith('syncing_reconnect', true);
      expect(transitionBlocking).not.toHaveBeenCalledWith('offline', true);

      // First backoff: 1_000ms (2 ** 0).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(flushPending).toHaveBeenCalledTimes(2);
      expect(submitModule).not.toHaveBeenCalled();

      // Second backoff: 2_000ms (2 ** 1).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(flushPending).toHaveBeenCalledTimes(3);
      expect(submitModule).toHaveBeenCalledTimes(1);
      expect(transitionBlocking).toHaveBeenCalledWith('syncing_reconnect', false);
      expect(transitionBlocking).toHaveBeenCalledWith('offline', false);

      await act(async () => {
        await submitPromise;
      });
    } finally {
      vi.useRealTimers();
      if (originalOnLine) {
        Object.defineProperty(navigator, 'onLine', originalOnLine);
      } else {
        delete (navigator as { onLine?: unknown }).onLine;
      }
    }
  });

  it('showed offline blocking and kept retrying when the section flush failed while the connection was down (FEX-041 #6, FEX-042 connection drop)', async () => {
    const originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    vi.useFakeTimers();
    try {
      const flushPending = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
      const transitionBlocking = vi.fn();
      const submitModule = vi.fn();

      const runtimeStateRef = {
        current: {
          phase: 'exam' as const,
          currentModule: 'reading' as const,
        },
      };

      const { result } = renderHook(() =>
        useStudentSubmissionOrchestration({
          runtimeState: {
            runtimeBacked: false,
            runtimeStatus: null,
            currentModule: 'reading',
          },
          runtimeStateRef,
          attemptId: null,
          runtimeCompletionVerified: false,
          attemptFinalized: false,
          pendingSubmissionActive: false,
          flushDomAnswerControlsNow: vi.fn(),
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
        }),
      );

      let submitPromise: Promise<void> | undefined;
      await act(async () => {
        submitPromise = result.current.flushAndSubmitCurrentModuleWithRetry('manual:reading');
      });

      // Offline failure: the offline blocking state is shown, never the
      // reconnect one, and the section must NOT transition.
      expect(flushPending).toHaveBeenCalledTimes(1);
      expect(submitModule).not.toHaveBeenCalled();
      expect(transitionBlocking).toHaveBeenCalledWith('offline', true);
      expect(transitionBlocking).not.toHaveBeenCalledWith('syncing_reconnect', true);

      // After the backoff the retry succeeds and both blockings are cleared.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(flushPending).toHaveBeenCalledTimes(2);
      expect(submitModule).toHaveBeenCalledTimes(1);
      expect(transitionBlocking).toHaveBeenCalledWith('offline', false);
      expect(transitionBlocking).toHaveBeenCalledWith('syncing_reconnect', false);

      await act(async () => {
        await submitPromise;
      });
    } finally {
      vi.useRealTimers();
      if (originalOnLine) {
        Object.defineProperty(navigator, 'onLine', originalOnLine);
      } else {
        delete (navigator as { onLine?: unknown }).onLine;
      }
    }
  });

  it('abandoned the retry loop without submitting when the proctor advanced the section mid-retry (FEX-042 proctor advances)', async () => {
    const originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    vi.useFakeTimers();
    try {
      const flushPending = vi.fn().mockResolvedValue(false);
      const transitionBlocking = vi.fn();
      const submitModule = vi.fn();

      const runtimeStateRef = {
        current: {
          phase: 'exam' as const,
          currentModule: 'reading' as const,
        },
      };

      const { result } = renderHook(() =>
        useStudentSubmissionOrchestration({
          runtimeState: {
            runtimeBacked: false,
            runtimeStatus: null,
            currentModule: 'reading',
          },
          runtimeStateRef,
          attemptId: null,
          runtimeCompletionVerified: false,
          attemptFinalized: false,
          pendingSubmissionActive: false,
          flushDomAnswerControlsNow: vi.fn(),
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
        }),
      );

      let submitPromise: Promise<void> | undefined;
      await act(async () => {
        submitPromise = result.current.flushAndSubmitCurrentModuleWithRetry('manual:reading');
      });
      expect(flushPending).toHaveBeenCalledTimes(1);

      // The proctor advances the section while the first retry backoff is
      // still pending: the loop re-reads the runtime state on each iteration.
      runtimeStateRef.current.currentModule = 'listening';

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });

      // The retry loop returns without a second flush and without submitting.
      expect(flushPending).toHaveBeenCalledTimes(1);
      expect(submitModule).not.toHaveBeenCalled();

      await act(async () => {
        await submitPromise;
      });
    } finally {
      vi.useRealTimers();
      if (originalOnLine) {
        Object.defineProperty(navigator, 'onLine', originalOnLine);
      } else {
        delete (navigator as { onLine?: unknown }).onLine;
      }
    }
  });

  it('abandoned the retry loop without submitting when the phase left the exam mid-retry (FEX-042 phase exit)', async () => {
    const originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    vi.useFakeTimers();
    try {
      const flushPending = vi.fn().mockResolvedValue(false);
      const transitionBlocking = vi.fn();
      const submitModule = vi.fn();

      const runtimeStateRef = {
        current: {
          phase: 'exam' as const,
          currentModule: 'reading' as const,
        },
      };

      const { result } = renderHook(() =>
        useStudentSubmissionOrchestration({
          runtimeState: {
            runtimeBacked: false,
            runtimeStatus: null,
            currentModule: 'reading',
          },
          runtimeStateRef,
          attemptId: null,
          runtimeCompletionVerified: false,
          attemptFinalized: false,
          pendingSubmissionActive: false,
          flushDomAnswerControlsNow: vi.fn(),
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
        }),
      );

      let submitPromise: Promise<void> | undefined;
      await act(async () => {
        submitPromise = result.current.flushAndSubmitCurrentModuleWithRetry('manual:reading');
      });
      expect(flushPending).toHaveBeenCalledTimes(1);

      // The runtime leaves the exam phase (e.g. the section was submitted by
      // another path) while the retry backoff is still pending.
      runtimeStateRef.current.phase = 'post-exam';

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });

      expect(flushPending).toHaveBeenCalledTimes(1);
      expect(submitModule).not.toHaveBeenCalled();

      await act(async () => {
        await submitPromise;
      });
    } finally {
      vi.useRealTimers();
      if (originalOnLine) {
        Object.defineProperty(navigator, 'onLine', originalOnLine);
      } else {
        delete (navigator as { onLine?: unknown }).onLine;
      }
    }
  });

  it('deduplicated a second module-submit request with the same fingerprint while the first flush was still in flight (FEX-040 confirm, FEX-042 flush in flight)', async () => {
    let resolveFlush: ((flushed: boolean) => void) | null = null;
    const flushPending = vi.fn().mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveFlush = resolve;
        }),
    );
    const transitionBlocking = vi.fn();
    const submitModule = vi.fn();

    const runtimeStateRef = {
      current: {
        phase: 'exam' as const,
        currentModule: 'reading' as const,
      },
    };

    const { result } = renderHook(() =>
      useStudentSubmissionOrchestration({
        runtimeState: {
          runtimeBacked: false,
          runtimeStatus: null,
          currentModule: 'reading',
        },
        runtimeStateRef,
        attemptId: null,
        runtimeCompletionVerified: false,
        attemptFinalized: false,
        pendingSubmissionActive: false,
        flushDomAnswerControlsNow: vi.fn(),
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
      }),
    );

    let firstSubmit: Promise<void> | undefined;
    let secondSubmit: Promise<void> | undefined;
    await act(async () => {
      firstSubmit = result.current.flushAndSubmitCurrentModuleWithRetry('manual:reading');
    });
    await act(async () => {
      secondSubmit = result.current.flushAndSubmitCurrentModuleWithRetry('manual:reading');
    });

    // While the first flush is still in flight the second call with the same
    // fingerprint must not start another flush or submit.
    expect(flushPending).toHaveBeenCalledTimes(1);
    expect(submitModule).not.toHaveBeenCalled();

    await act(async () => {
      resolveFlush?.(true);
      await firstSubmit;
      await secondSubmit;
    });

    expect(flushPending).toHaveBeenCalledTimes(1);
    expect(submitModule).toHaveBeenCalledTimes(1);
    expect(transitionBlocking).toHaveBeenCalledWith('syncing_reconnect', false);
    expect(transitionBlocking).toHaveBeenCalledWith('offline', false);
  });

  it('did not fire the final-submit pipeline when the attempt was already finalized (FEX-050 gate)', async () => {
    const submitAttempt = vi.fn();

    const { result } = renderHook(() =>
      useStudentSubmissionOrchestration({
        runtimeState: {
          runtimeBacked: true,
          runtimeStatus: 'completed',
          currentModule: 'reading',
        },
        runtimeStateRef: {
          current: {
            phase: 'exam',
            currentModule: 'reading',
          },
        },
        attemptId: 'attempt-1',
        runtimeCompletionVerified: true,
        // The app derives this from attempt.submittedAt != null OR
        // attempt.proctorStatus === 'terminated' — both are authoritative end
        // states that must never fire the pipeline.
        attemptFinalized: true,
        pendingSubmissionActive: false,
        flushDomAnswerControlsNow: vi.fn(),
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
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(submitAttempt).not.toHaveBeenCalled();
    expect(result.current.finalSubmitStatus).toBe('idle');
  });

  it('did not fire the final-submit pipeline while a durable pending submission owned the retry loop (FEX-050/FEX-051 gate)', async () => {
    const submitAttempt = vi.fn();

    const { result } = renderHook(() =>
      useStudentSubmissionOrchestration({
        runtimeState: {
          runtimeBacked: true,
          runtimeStatus: 'completed',
          currentModule: 'reading',
        },
        runtimeStateRef: {
          current: {
            phase: 'exam',
            currentModule: 'reading',
          },
        },
        attemptId: 'attempt-1',
        runtimeCompletionVerified: true,
        attemptFinalized: false,
        // A durable pending record exists (e.g. restored after reload): the
        // provider's background retry loop owns the submission identity, so
        // the pipeline must not double-drive it.
        pendingSubmissionActive: true,
        flushDomAnswerControlsNow: vi.fn(),
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
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(submitAttempt).not.toHaveBeenCalled();
    expect(result.current.finalSubmitStatus).toBe('idle');
  });

  it('advanced the final-submit retry status from submitting through retrying to idle when the provider recovered (FEX-050 retry status)', async () => {
    vi.useFakeTimers();
    try {
      let resolveSecondAttempt: ((confirmed: boolean) => void) | null = null;
      const submitAttempt = vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockImplementationOnce(
          () =>
            new Promise<boolean>((resolve) => {
              resolveSecondAttempt = resolve;
            }),
        );

      const { result } = renderHook(() =>
        useStudentSubmissionOrchestration({
          runtimeState: {
            runtimeBacked: true,
            runtimeStatus: 'completed',
            currentModule: 'reading',
          },
          runtimeStateRef: {
            current: {
              phase: 'exam',
              currentModule: 'reading',
            },
          },
          attemptId: 'attempt-1',
          runtimeCompletionVerified: true,
          attemptFinalized: false,
          pendingSubmissionActive: false,
          flushDomAnswerControlsNow: vi.fn(),
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
      );

      await act(async () => {
        await Promise.resolve();
      });
      expect(submitAttempt).toHaveBeenCalledTimes(1);
      expect(result.current.finalSubmitStatus).toBe('submitting');

      // The first attempt reported failure: after the 1_000ms backoff the
      // second attempt starts and the visible status becomes 'retrying'.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(submitAttempt).toHaveBeenCalledTimes(2);
      expect(result.current.finalSubmitStatus).toBe('retrying');

      await act(async () => {
        resolveSecondAttempt?.(true);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.finalSubmitStatus).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reached the failed final-submit status after six unanswered attempts with capped exponential backoff (FEX-050 retry status)', async () => {
    vi.useFakeTimers();
    try {
      const submitAttempt = vi.fn().mockResolvedValue(false);

      const { result } = renderHook(() =>
        useStudentSubmissionOrchestration({
          runtimeState: {
            runtimeBacked: true,
            runtimeStatus: 'completed',
            currentModule: 'reading',
          },
          runtimeStateRef: {
            current: {
              phase: 'exam',
              currentModule: 'reading',
            },
          },
          attemptId: 'attempt-1',
          runtimeCompletionVerified: true,
          attemptFinalized: false,
          pendingSubmissionActive: false,
          flushDomAnswerControlsNow: vi.fn(),
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
      );

      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.finalSubmitStatus).toBe('submitting');

      // Backoffs between the six attempts: 1_000, 2_000, 4_000, 8_000, 16_000
      // and the capped 30_000 (Math.min(30_000, 1_000 * 2 ** attemptIndex)),
      // then the status settles on 'failed'.
      for (const backoffMs of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(backoffMs);
        });
      }
      expect(submitAttempt).toHaveBeenCalledTimes(6);
      expect(result.current.finalSubmitStatus).toBe('failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('kept exactly one final submit across repeated runtime hydration with fresh runtime state objects (FEX-052)', async () => {
    const submitAttempt = vi.fn().mockResolvedValue(true);

    const options: UseStudentSubmissionOrchestrationOptions = {
      runtimeState: {
        runtimeBacked: true,
        runtimeStatus: 'completed',
        currentModule: 'reading',
      },
      runtimeStateRef: {
        current: {
          phase: 'exam',
          currentModule: 'reading',
        },
      },
      attemptId: 'attempt-1',
      runtimeCompletionVerified: true,
      attemptFinalized: false,
      pendingSubmissionActive: false,
      flushDomAnswerControlsNow: vi.fn(),
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
    };

    const { result, rerender } = renderHook(() =>
      useStudentSubmissionOrchestration(options),
    );

    await waitFor(() => {
      expect(submitAttempt).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(result.current.finalSubmitStatus).toBe('idle');
    });

    // A fresh completed runtime object with identical values (re-hydration)
    // must not re-fire the pipeline.
    options.runtimeState = {
      runtimeBacked: true,
      runtimeStatus: 'completed',
      currentModule: 'reading',
    };
    rerender();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(submitAttempt).toHaveBeenCalledTimes(1);

    // After the authoritative receipt the attempt is finalized: even a
    // live -> completed round trip must not fire a second submit.
    options.attemptFinalized = true;
    options.runtimeState = {
      runtimeBacked: true,
      runtimeStatus: 'live',
      currentModule: 'reading',
    };
    rerender();
    await act(async () => {
      await Promise.resolve();
    });
    options.runtimeState = {
      runtimeBacked: true,
      runtimeStatus: 'completed',
      currentModule: 'reading',
    };
    rerender();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(submitAttempt).toHaveBeenCalledTimes(1);
    expect(result.current.finalSubmitStatus).toBe('idle');
  });

  it('did not start a second final submit when a stale live runtime was re-delivered mid-flight and completion returned (FEX-052)', async () => {
    const submitAttempt = vi.fn().mockReturnValue(new Promise<boolean>(() => undefined));

    const options: UseStudentSubmissionOrchestrationOptions = {
      runtimeState: {
        runtimeBacked: true,
        runtimeStatus: 'completed',
        currentModule: 'reading',
      },
      runtimeStateRef: {
        current: {
          phase: 'exam',
          currentModule: 'reading',
        },
      },
      attemptId: 'attempt-1',
      runtimeCompletionVerified: true,
      attemptFinalized: false,
      pendingSubmissionActive: false,
      flushDomAnswerControlsNow: vi.fn(),
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
    };

    const { rerender } = renderHook(() => useStudentSubmissionOrchestration(options));

    await act(async () => {
      await Promise.resolve();
    });
    expect(submitAttempt).toHaveBeenCalledTimes(1);

    // A stale out-of-order live runtime arrives while the first submit is
    // still in flight (FEX-012 re-delivery, mid-pipeline).
    options.runtimeState = {
      runtimeBacked: true,
      runtimeStatus: 'live',
      currentModule: 'reading',
    };
    rerender();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Completion is re-delivered: the still-running pipeline must not be
    // duplicated by a second submit.
    options.runtimeState = {
      runtimeBacked: true,
      runtimeStatus: 'completed',
      currentModule: 'reading',
    };
    rerender();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(submitAttempt).toHaveBeenCalledTimes(1);
  });
});
