import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSatResponsePersistence } from '../../hooks/useSatResponsePersistence';
import type { SatDeliveryGateway } from '../ports/SatDeliveryGateway';

const mocks = vi.hoisted(() => ({
  transport: {
    sendBatch: vi.fn(),
    submit: vi.fn(),
    fetchSnapshot: vi.fn(),
  },
  createTransport: vi.fn(),
  takeover: vi.fn(),
}));

vi.mock('@student/api/responseDurabilityTransport', () => ({
  createResponseDurabilityV2Transport: mocks.createTransport,
  takeOverResponseDurabilityLease: mocks.takeover,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function gateway(): SatDeliveryGateway {
  return {
    saveResponse: vi.fn(),
    bootstrap: vi.fn(),
    startModule: vi.fn(),
    submitModule: vi.fn(),
    submitAssessment: vi.fn(),
  } as SatDeliveryGateway;
}

describe('SAT V2 response persistence integration', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mocks.createTransport.mockReturnValue(mocks.transport);
  });

  it('surfaces terminal failure and never a false saved state when all browser storage fails', async () => {
    // T2.3 SAT mirror of the engine storage-fault contract: quota on every
    // localStorage write (checkpoint + IndexedDB fallback) must surface
    // failureKind terminal — never synced/cleared — so the route blocks
    // interaction and the shell can only show save-failed, never a false
    // saved confirmation.
    mocks.transport.fetchSnapshot.mockResolvedValue([]);
    const hook = renderHook(() =>
      useSatResponsePersistence({
        scheduleId: 'schedule',
        attemptId: 'attempt-fault',
        gateway: gateway(),
        onSavedRevision: vi.fn(),
      })
    );
    await waitFor(() => expect(mocks.transport.fetchSnapshot).toHaveBeenCalled());
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    try {
      act(() => {
        hook.result.current.save({
          questionId: 'q1',
          answer: 'private-A',
          markedForReview: false,
          eliminatedOptionIds: [],
          annotations: { version: 2, annotations: [], legacyQuestionNote: '' },
        });
      });
      await waitFor(() => expect(hook.result.current.failureKind).toBe('terminal'));
    } finally {
      setItem.mockRestore();
    }
    expect(hook.result.current.failureKind).toBe('terminal');
    expect(hook.result.current.failure).toMatch(/storage|unavailable|persist/i);
    expect(hook.result.current.visibleDrafts.q1?.answer).toBe('private-A');
    hook.unmount();
  });

  it('does not publish a save into a replacement attempt after recovery switches identity', async () => {
    const firstRecovery = deferred<[]>();
    const secondRecovery = deferred<[]>();
    mocks.transport.fetchSnapshot
      .mockReturnValueOnce(firstRecovery.promise)
      .mockReturnValueOnce(secondRecovery.promise);

    const hook = renderHook(
      ({ attemptId }: { attemptId: string }) =>
        useSatResponsePersistence({
          scheduleId: 'schedule',
          attemptId,
          gateway: gateway(),
          onSavedRevision: vi.fn(),
        }),
      { initialProps: { attemptId: 'attempt-a' } }
    );

    act(() => {
      hook.result.current.save({
        questionId: 'q1',
        answer: 'private-A',
        markedForReview: false,
        eliminatedOptionIds: [],
        annotations: { version: 2, annotations: [], legacyQuestionNote: '' },
      });
    });
    hook.rerender({ attemptId: 'attempt-b' });

    await act(async () => {
      firstRecovery.resolve([]);
      await Promise.resolve();
    });
    await waitFor(() => expect(hook.result.current.visibleDrafts.q1).toBeUndefined());

    secondRecovery.resolve([]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(hook.result.current.visibleDrafts.q1).toBeUndefined();
  });
});
