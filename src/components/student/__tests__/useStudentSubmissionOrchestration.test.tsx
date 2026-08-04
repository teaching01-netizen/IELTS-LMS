import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useStudentSubmissionOrchestration } from '../useStudentSubmissionOrchestration';

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
        shouldRenderPostExam: false,
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
        shouldRenderPostExam: false,
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
          shouldRenderPostExam: false,
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
});
