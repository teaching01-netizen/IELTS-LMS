import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useStudentSubmissionOrchestration } from '../useStudentSubmissionOrchestration';

describe('useStudentSubmissionOrchestration', () => {
  it('flushes and submits current module when pending mutations are persisted', async () => {
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
      }),
    );

    await act(async () => {
      await result.current.flushAndSubmitCurrentModuleWithRetry('manual:reading');
    });

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
      }),
    );

    await waitFor(() => {
      expect(submitAttempt).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(result.current.finalSubmitStatus).toBe('idle');
    });
  });
  it('cancels module retries after unmount', async () => {
    vi.useFakeTimers();
    const flushPending = vi.fn().mockResolvedValue(false);
    const transitionBlocking = vi.fn();
    const submitModule = vi.fn();
    const runtimeStateRef = {
      current: {
        phase: 'exam' as const,
        currentModule: 'reading' as const,
      },
    };

    const { result, unmount } = renderHook(() =>
      useStudentSubmissionOrchestration({
        runtimeState: {
          runtimeBacked: false,
          runtimeStatus: null,
          currentModule: 'reading',
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
      }),
    );

    let retryPromise: Promise<void> | undefined;
    await act(async () => {
      retryPromise = result.current.flushAndSubmitCurrentModuleWithRetry('auto:reading');
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
