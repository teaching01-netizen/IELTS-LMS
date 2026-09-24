import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DurableResponseEngine } from '@shared/durability/DurableResponseEngine';
import type { ResponseBatchRequestV2 } from '@shared/durability/types';
import { durablePayloadToSatDraft, useSatResponsePersistence } from '../../hooks/useSatResponsePersistence';
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

  it('sends the complete hydrated aggregate when only the answer changes', async () => {
    mocks.transport.fetchSnapshot.mockReset().mockResolvedValue([]);
    mocks.transport.sendBatch.mockReset().mockImplementation(async (_attemptId: string, request: ResponseBatchRequestV2) => ({
      attemptRevision: 1,
      serverTime: new Date().toISOString(),
      acknowledgements: request.commands.map((command) => ({
        writeId: command.writeId,
        questionId: command.questionId,
        clientVersion: command.clientVersion,
        outcome: 'applied' as const,
        serverRevision: 1,
        canonicalResponse: command.response,
        contentHash: 'hash',
      })),
    }));
    const hook = renderHook(() =>
      useSatResponsePersistence({
        scheduleId: 'schedule',
        attemptId: 'attempt-round-trip',
        gateway: gateway(),
        onSavedRevision: vi.fn(),
      })
    );
    await waitFor(() => expect(mocks.transport.fetchSnapshot).toHaveBeenCalled());

    const hydrated = durablePayloadToSatDraft('q1', {
      answer: 'old answer',
      markedForReview: true,
      eliminatedOptions: ['B'],
      annotations: [{
        id: 'sat-annotations',
        kind: 'sat_annotations',
        version: 2,
        legacyQuestionNote: 'earlier note',
        annotations: [],
      }],
    });
    act(() => {
      hook.result.current.save({ ...hydrated, answer: 'new answer' });
    });

    await waitFor(() => expect(mocks.transport.sendBatch).toHaveBeenCalled(), { timeout: 5_000 });
    const request = mocks.transport.sendBatch.mock.calls[0]?.[1] as ResponseBatchRequestV2;
    expect(request.commands).toHaveLength(1);
    expect(request.commands[0]?.response).toEqual({
      answer: 'new answer',
      markedForReview: true,
      eliminatedOptions: ['B'],
      annotations: [{
        id: 'sat-annotations',
        kind: 'sat_annotations',
        version: 2,
        legacyQuestionNote: 'earlier note',
        annotations: [],
      }],
    });
    hook.unmount();
  });

  it('passes discrete and typing interaction context into the durable drain policy', async () => {
    mocks.transport.fetchSnapshot.mockReset().mockResolvedValue([]);
    const acceptResponse = vi.spyOn(DurableResponseEngine.prototype, 'acceptResponse').mockResolvedValue(undefined);
    const hook = renderHook(() =>
      useSatResponsePersistence({
        scheduleId: 'schedule',
        attemptId: 'attempt-drain-policy',
        gateway: gateway(),
        onSavedRevision: vi.fn(),
      })
    );
    await waitFor(() => expect(mocks.transport.fetchSnapshot).toHaveBeenCalled());
    const draft = {
      questionId: 'q1',
      answer: 'A',
      markedForReview: false,
      eliminatedOptionIds: [],
      annotations: { version: 2 as const, annotations: [], legacyQuestionNote: '' },
    };
    const context = {
      moduleAttemptId: 'module-attempt',
      stageKey: 'reading-writing',
      runtimeRevision: 1,
      remainingSeconds: 60,
    };

    act(() => hook.result.current.save(draft, { ...context, interactionType: 'discrete' }));
    await waitFor(() => expect(acceptResponse).toHaveBeenCalledTimes(1));
    expect(acceptResponse.mock.calls[0]?.[2]).toEqual({ drainImmediately: true });

    act(() => hook.result.current.save({ ...draft, answer: '12.5' }, { ...context, interactionType: 'typing' }));
    await waitFor(() => expect(acceptResponse).toHaveBeenCalledTimes(2));
    expect(acceptResponse.mock.calls[1]?.[2]).toEqual({ drainImmediately: false });
    act(() => hook.result.current.save({ ...draft, answer: '12.50' }, { ...context, remainingSeconds: 5, interactionType: 'typing' }));
    await waitFor(() => expect(acceptResponse).toHaveBeenCalledTimes(3));
    expect(acceptResponse.mock.calls[2]?.[2]).toEqual({ drainImmediately: true });
    hook.unmount();
    acceptResponse.mockRestore();
  });

  it('identifies an answer refused after the SAT save window', async () => {
    mocks.transport.fetchSnapshot.mockReset().mockResolvedValue([]);
    mocks.transport.sendBatch.mockReset().mockRejectedValue({ code: 'DEADLINE_EXPIRED' });
    const hook = renderHook(() => useSatResponsePersistence({
      scheduleId: 'schedule', attemptId: 'attempt-expired', gateway: gateway(), onSavedRevision: vi.fn(),
    }));
    await waitFor(() => expect(mocks.transport.fetchSnapshot).toHaveBeenCalled());
    act(() => hook.result.current.save({
      questionId: 'q1', answer: 'final answer', markedForReview: false,
      eliminatedOptionIds: [], annotations: { version: 2, annotations: [], legacyQuestionNote: '' },
    }));
    await waitFor(() => expect(hook.result.current.failureKind).toBe('expired'));
    expect(hook.result.current.failure).toMatch(/contact your proctor/i);
    await waitFor(() => expect(hook.result.current.tombstoneCount).toBeGreaterThan(0));
    expect(window.localStorage.getItem('response-checkpoint:v2:attempt-expired:q1')).toContain('final answer');
    hook.unmount();

    const reopened = renderHook(() => useSatResponsePersistence({
      scheduleId: 'schedule', attemptId: 'attempt-expired', gateway: gateway(), onSavedRevision: vi.fn(),
    }));
    await waitFor(() => expect(reopened.result.current.tombstoneCount).toBeGreaterThan(0));
    reopened.unmount();
  });

  it('surfaces blocked drafts as visible + retryable exam-stress-safe failure and gates submit', async () => {
    // Blocked flow WITHOUT mocking persistence: only the transport is
    // mocked (fetchSnapshot/sendBatch/submit). The real DurableResponseEngine
    // + real browser checkpoint path own durability. The control bump rides
    // the initial recover(): the snapshot resolves AFTER the save, so
    // recoverInternal adopts control 2 over the live control-1 draft and
    // marks it blocked (visible, never sent) — same race the audit suite
    // covers at engine level (I1/I3 deferred pattern, already used above).
    const runningSnapshot = (controlEpoch: number) => ({
      attemptId: 'attempt-blocked-live',
      protocolVersion: 2,
      deliveryStatus: 'running',
      leaseEpoch: 1,
      controlEpoch,
      attemptRevision: 3,
      responses: [],
    });
    const recoverySnapshot = deferred<ReturnType<typeof runningSnapshot>>();
    // mockReset (not just clearAllMocks): the preceding identity test queues
    // two Once fetchSnapshot values but only consumes one (its replacement
    // engine never refetches), leaving a stale resolved [] Once entry behind
    // — clearAllMocks preserves Once queues, and that stale [] would be
    // consumed as this test's recovery snapshot (no authoritative epoch, so
    // no control bump, so no block). Reset first, then install this test's
    // gate: every fetch until the gate resolves gets the pending recovery
    // promise; everything after gets the bumped snapshot.
    mocks.transport.fetchSnapshot.mockReset();
    let recoveryGate: Promise<ReturnType<typeof runningSnapshot>> | null = recoverySnapshot.promise;
    mocks.transport.fetchSnapshot.mockImplementation(() => recoveryGate ?? runningSnapshot(2));
    mocks.transport.sendBatch.mockResolvedValue({ attemptRevision: 3, serverTime: new Date().toISOString(), acknowledgements: [] });
    const hook = renderHook(() =>
      useSatResponsePersistence({
        scheduleId: 'schedule',
        attemptId: 'attempt-blocked-live',
        gateway: gateway(),
        onSavedRevision: vi.fn(),
        leaseEpoch: 1,
        controlEpoch: 1,
      })
    );
    await waitFor(() => expect(mocks.transport.fetchSnapshot).toHaveBeenCalled());
    // Save while recovery is still in flight (engine still at control 1).
    act(() => {
      hook.result.current.save({
        questionId: 'q1',
        answer: 'kept-answer',
        markedForReview: false,
        eliminatedOptionIds: [],
        annotations: { version: 2, annotations: [], legacyQuestionNote: '' },
      });
    });
    await waitFor(() => expect(Object.keys(hook.result.current.pendingDrafts).length).toBeGreaterThan(0), { timeout: 5000 });
    // Timing-only control bump 1 -> 2 lands via the recovery snapshot: the
    // live unsent draft is marked blocked (visible, never sent).
    await act(async () => {
      recoveryGate = null;
      recoverySnapshot.resolve(runningSnapshot(2));
      await recoverySnapshot.promise;
    });
    await waitFor(() => expect(hook.result.current.blockedDrafts).toContain('q1'), { timeout: 8000 });

    // Visible-drafts flow assertion: the blocked draft stays VISIBLE (never
    // silently dropped) and is named by blockedDrafts/blockedCount.
    expect(hook.result.current.visibleDrafts.q1?.answer).toBe('kept-answer');
    expect(hook.result.current.blockedCount).toBe(1);
    expect(hook.result.current.blockedQuestionIds).toContain('q1');
    // Banner copy: retryable failure with the exam-stress-safe wording.
    await waitFor(() => expect(hook.result.current.failureKind).toBe('retryable'), { timeout: 5000 });
    expect(hook.result.current.failure).toMatch(/kept on this device/i);

    // Submit gate: blocked drafts refuse with the same gate copy (never a
    // generic pending+retry message, never silent exclusion).
    let submitError: unknown = null;
    await act(async () => {
      try {
        await hook.result.current.submit();
      } catch (error) {
        submitError = error;
      }
    });
    expect(submitError).toBeInstanceOf(Error);
    expect((submitError as Error).message).toMatch(/needs attention before submit/i);
    expect(hook.result.current.failureKind).toBe('retryable');

    // SAT-004: the module boundary shares the same barrier. It must refuse
    // before any module submission is attempted — queue length alone cannot
    // see a blocked visible draft. The refusal carries the same gate copy.
    let boundaryError: unknown = null;
    await act(async () => {
      try {
        await hook.result.current.assertBoundarySettled!();
      } catch (error) {
        boundaryError = error;
      }
    });
    expect(boundaryError).toBeInstanceOf(Error);
    expect((boundaryError as Error).message).toMatch(/needs attention before submit/i);
    // The blocked draft is still visible and named after the refusal.
    expect(hook.result.current.visibleDrafts.q1?.answer).toBe('kept-answer');
    expect(hook.result.current.blockedDrafts).toContain('q1');

    // Reconcile: reason union (never a bare boolean), and the draft stays
    // visible throughout. Reconcile re-issues under the new epoch (the
    // mocked snapshot above has no server-newer write), so expect
    // 'reconciled'; accept 'refusal' only if the drain raced first.
    const outcome = await hook.result.current.reconcileBlocked!('q1');
    expect(['reconciled', 'refusal']).toContain(outcome);
    expect(hook.result.current.visibleDrafts.q1?.answer).toBe('kept-answer');
    hook.unmount();
  });
});
