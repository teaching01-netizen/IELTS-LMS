import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AssessmentDeliveryBootstrap,
  AssessmentResponseSnapshot,
} from '../../contracts/assessmentDelivery';
import type { SatQuestionResponseDraft } from '../../domain/satResponses';
import {
  satResponseCheckpointStorageKey,
  satResponseOutboxStorageKey,
} from '../../infrastructure/satResponseOutboxStore';
import { ApiClientError } from '../../../../shared/api/apiClient';
import { clearDurableDraft } from '../../../../utils/durableDraftStore';
import type { SatDeliveryGateway } from '../ports/SatDeliveryGateway';
import { useSatResponsePersistence } from '../../hooks/useSatResponsePersistence';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function gateway(saveResponse: SatDeliveryGateway['saveResponse']): SatDeliveryGateway {
  return {
    saveResponse,
    bootstrap: vi.fn(),
    startModule: vi.fn(),
    submitModule: vi.fn(),
    submitAssessment: vi.fn(),
  } as SatDeliveryGateway;
}

function draft(answer: string, markedForReview = false): SatQuestionResponseDraft {
  return {
    questionId: 'q1',
    answer,
    markedForReview,
    eliminatedOptionIds: [],
    annotations: { version: 1, note: '' },
  };
}

function snapshot(answer: string, revision: number): AssessmentResponseSnapshot {
  return {
    id: 'response-1',
    moduleAttemptId: 'module-attempt',
    examQuestionId: 'q1',
    response: answer,
    markedForReview: false,
    eliminatedOptions: [],
    annotations: { version: 1, note: '' },
    revision,
  };
}

function canonicalBootstrap(attemptId = 'attempt-terminal'): AssessmentDeliveryBootstrap {
  return {
    scheduleId: 'schedule',
    examId: 'exam',
    providerKey: 'sat',
    versionId: 'version',
    serverNow: '2026-08-30T02:00:01Z',
    candidateName: 'Candidate',
    scheduleRuntimeStatus: 'live',
    proctorStatus: 'active',
    proctorNote: null,
    deviceFingerprintHash: null,
    sections: [],
    result: null,
    timing: {
      authority: 'cohort_runtime',
      timingModel: 'cohort_stage_v2',
      stageKey: 'reading-writing:m2',
      stageStatus: 'live',
      serverNow: '2026-08-30T02:00:01Z',
      deadlineAt: '2026-08-30T02:32:01Z',
      remainingSeconds: 1_920,
      runtimeRevision: 8,
    },
    attempt: {
      id: attemptId,
      moduleAttempts: [
        {
          id: 'module-attempt',
          moduleId: 'module',
          state: 'locked',
          allocatedSeconds: 1_920,
          availableAt: '2026-08-30T01:28:00Z',
          startedAt: '2026-08-30T01:28:00Z',
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionSeconds: 0,
          deadlineAt: '2026-08-30T02:00:00Z',
          remainingSeconds: 0,
          completionReason: 'time_expired',
          rawCorrect: 0,
          operationalQuestionCount: 1,
          toolState: {},
          revision: 2,
        },
      ],
      responses: [],
    },
  };
}

function structuredConflict(reason: string): ApiClientError {
  return new ApiClientError({
    message: 'SAT response conflict',
    statusCode: 409,
    backendCode: 'ASSESSMENT_CONFLICT',
    backendDetails: { reason },
    backendRequestId: 'request-1',
  });
}

describe('SAT response durability laws', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(async () => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    await Promise.all(
      ['attempt', 'attempt-a', 'attempt-b', 'attempt-terminal'].map((attemptId) =>
        clearDurableDraft(satResponseOutboxStorageKey('schedule', attemptId))
      )
    );
  });

  it('keeps the newer answer pending when an older in-flight save is acknowledged', async () => {
    const first = deferred<AssessmentResponseSnapshot>();
    const second = deferred<AssessmentResponseSnapshot>();
    const saveResponse = vi
      .fn<SatDeliveryGateway['saveResponse']>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const stableGateway = gateway(saveResponse);
    const { result } = renderHook(() =>
      useSatResponsePersistence({
        scheduleId: 'schedule',
        attemptId: 'attempt',
        gateway: stableGateway,
        onSavedRevision: vi.fn(),
      })
    );

    act(() => {
      result.current.hydrateRevisions([]);
      result.current.save(draft('A'));
    });
    await waitFor(() => expect(saveResponse).toHaveBeenCalledTimes(1));
    act(() => {
      result.current.save(draft('B'));
    });

    await act(async () => {
      first.resolve(snapshot('A', 1));
    });
    await waitFor(() => expect(saveResponse).toHaveBeenCalledTimes(2));

    expect(result.current.pendingDrafts.q1?.answer).toBe('B');
    await act(async () => {
      second.resolve(snapshot('B', 2));
    });
    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.pendingCount).toBe(0);
  });

  it('recovers an unsent answer after the student process is restarted', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const saveWhileOffline = vi.fn<SatDeliveryGateway['saveResponse']>();
    const first = renderHook(() =>
      useSatResponsePersistence({
        scheduleId: 'schedule',
        attemptId: 'attempt',
        gateway: gateway(saveWhileOffline),
        onSavedRevision: vi.fn(),
      })
    );
    act(() => {
      first.result.current.hydrateRevisions([]);
      first.result.current.save(draft('C'));
    });
    await waitFor(() => expect(first.result.current.failureKind).toBe('offline'));
    expect(saveWhileOffline).not.toHaveBeenCalled();
    expect(
      window.localStorage.getItem(satResponseCheckpointStorageKey('schedule', 'attempt', 'q1'))
    ).toContain('"answer":"C"');
    first.unmount();

    online.mockReturnValue(true);
    const saveResponse = vi.fn<SatDeliveryGateway['saveResponse']>(
      async (_schedule, _attempt, _question, request) =>
        snapshot(String(request.response), request.revision + 1)
    );
    const second = renderHook(() =>
      useSatResponsePersistence({
        scheduleId: 'schedule',
        attemptId: 'attempt',
        gateway: gateway(saveResponse),
        onSavedRevision: vi.fn(),
      })
    );
    act(() => {
      second.result.current.hydrateRevisions([]);
    });

    await waitFor(() => expect(saveResponse).toHaveBeenCalledTimes(1));
    await act(async () => {
      await second.result.current.flush();
    });
    expect(second.result.current.pendingCount).toBe(0);
    expect(
      window.localStorage.getItem(satResponseCheckpointStorageKey('schedule', 'attempt', 'q1'))
    ).toBeNull();
  });

  it('treats a matching bootstrap snapshot as the acknowledgement lost with the prior response', async () => {
    const serverCommit = deferred<AssessmentResponseSnapshot>();
    const firstSave = vi.fn<SatDeliveryGateway['saveResponse']>(() => serverCommit.promise);
    const first = renderHook(() =>
      useSatResponsePersistence({
        scheduleId: 'schedule',
        attemptId: 'attempt',
        gateway: gateway(firstSave),
        onSavedRevision: vi.fn(),
      })
    );
    act(() => {
      first.result.current.hydrateRevisions([]);
      first.result.current.save(draft('D'));
    });
    await waitFor(() => expect(firstSave).toHaveBeenCalledTimes(1));
    first.unmount();
    serverCommit.resolve(snapshot('D', 1));
    await Promise.resolve();

    const retry = vi.fn<SatDeliveryGateway['saveResponse']>();
    const second = renderHook(() =>
      useSatResponsePersistence({
        scheduleId: 'schedule',
        attemptId: 'attempt',
        gateway: gateway(retry),
        onSavedRevision: vi.fn(),
      })
    );
    act(() => {
      second.result.current.hydrateRevisions([snapshot('D', 1)]);
    });

    await waitFor(() => expect(second.result.current.pendingCount).toBe(0));
    expect(retry).not.toHaveBeenCalled();
    expect(
      window.localStorage.getItem(satResponseCheckpointStorageKey('schedule', 'attempt', 'q1'))
    ).toBeNull();
  });

  it('tombstones a terminal old-stage response so it cannot poison later flushes', async () => {
    const canonical = canonicalBootstrap();
    const saveResponse = vi
      .fn<SatDeliveryGateway['saveResponse']>()
      .mockRejectedValue(structuredConflict('DEADLINE_EXPIRED'));
    const bootstrap = vi.fn<SatDeliveryGateway['bootstrap']>(async () => canonical);
    const terminalGateway: SatDeliveryGateway = { ...gateway(saveResponse), bootstrap };
    const { result } = renderHook(() =>
      useSatResponsePersistence({
        scheduleId: 'schedule',
        attemptId: 'attempt-terminal',
        gateway: terminalGateway,
        onSavedRevision: vi.fn(),
      })
    );

    act(() => {
      result.current.hydrateBootstrap(canonical);
      result.current.save(draft('A'), {
        moduleAttemptId: 'module-attempt',
        stageKey: 'reading-writing:m1',
        runtimeRevision: 7,
        remainingSeconds: 0,
        interactionType: 'discrete',
      });
    });

    await waitFor(() => expect(result.current.tombstoneCount).toBe(1));
    expect(saveResponse).toHaveBeenCalledTimes(1);
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.failureKind).toBe('terminal');
    await act(async () => {
      await result.current.flush();
    });
    expect(
      window.localStorage.getItem(
        satResponseCheckpointStorageKey('schedule', 'attempt-terminal', 'q1')
      )
    ).toBeNull();
  });

  it('does not replay the previous attempt when the hook switches identity in place', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const saveResponse = vi.fn<SatDeliveryGateway['saveResponse']>();
    const stableGateway = gateway(saveResponse);
    const hook = renderHook(
      ({ attemptId }: { attemptId: string }) =>
        useSatResponsePersistence({
          scheduleId: 'schedule',
          attemptId,
          gateway: stableGateway,
          onSavedRevision: vi.fn(),
        }),
      { initialProps: { attemptId: 'attempt-a' } }
    );

    act(() => {
      hook.result.current.hydrateRevisions([]);
      hook.result.current.save(draft('private-A'));
    });
    await waitFor(() => expect(hook.result.current.failureKind).toBe('offline'));

    online.mockReturnValue(true);
    hook.rerender({ attemptId: 'attempt-b' });
    act(() => {
      hook.result.current.hydrateRevisions([]);
    });

    await waitFor(() => expect(hook.result.current.pendingCount).toBe(0));
    expect(hook.result.current.pendingDrafts.q1).toBeUndefined();
    expect(saveResponse).not.toHaveBeenCalled();
  });

  it('never restores one SAT attempt response into another attempt on the same browser', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const firstAttemptSave = vi.fn<SatDeliveryGateway['saveResponse']>();
    const first = renderHook(() =>
      useSatResponsePersistence({
        scheduleId: 'schedule',
        attemptId: 'attempt-a',
        gateway: gateway(firstAttemptSave),
        onSavedRevision: vi.fn(),
      })
    );
    act(() => {
      first.result.current.hydrateRevisions([]);
      first.result.current.save(draft('private-A'));
    });
    await waitFor(() => expect(first.result.current.failureKind).toBe('offline'));
    expect(firstAttemptSave).not.toHaveBeenCalled();
    first.unmount();

    online.mockReturnValue(true);
    const otherAttemptSave = vi.fn<SatDeliveryGateway['saveResponse']>();
    const second = renderHook(() =>
      useSatResponsePersistence({
        scheduleId: 'schedule',
        attemptId: 'attempt-b',
        gateway: gateway(otherAttemptSave),
        onSavedRevision: vi.fn(),
      })
    );
    act(() => {
      second.result.current.hydrateRevisions([]);
    });

    await waitFor(() => expect(second.result.current.pendingCount).toBe(0));
    expect(second.result.current.pendingDrafts.q1).toBeUndefined();
    expect(otherAttemptSave).not.toHaveBeenCalled();
  });
});
