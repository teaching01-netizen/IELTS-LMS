import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SatDeliveryGateway } from '../ports/SatDeliveryGateway';
import { useSatResponsePersistence } from '../../hooks/useSatResponsePersistence';

function gateway(saveResponse: SatDeliveryGateway['saveResponse']): SatDeliveryGateway {
  return {
    saveResponse,
    bootstrap: vi.fn(),
    startModule: vi.fn(),
    submitModule: vi.fn(),
    submitAssessment: vi.fn(),
  } as SatDeliveryGateway;
}

describe('useSatResponsePersistence', () => {
  it('coalesces rapid pre-network aggregate saves into the latest server revision', async () => {
    const requests: Array<{ revision: number; body: unknown }> = [];
    const saveResponse = vi.fn<SatDeliveryGateway['saveResponse']>(
      async (_schedule, _attempt, questionId, request) => {
        requests.push({ revision: request.revision, body: request });
        return {
          id: `response-${request.revision + 1}`,
          moduleAttemptId: 'module-attempt',
          examQuestionId: questionId,
          response: request.response,
          markedForReview: request.markedForReview,
          eliminatedOptions: request.eliminatedOptions,
          annotations: request.annotations,
          revision: request.revision + 1,
        };
      },
    );
    const onSavedRevision = vi.fn();
    const { result } = renderHook(() => useSatResponsePersistence({
      scheduleId: 'schedule', attemptId: 'attempt', gateway: gateway(saveResponse), onSavedRevision,
    }));

    act(() => {
      result.current.hydrateRevisions([{
        id: 'response-3', moduleAttemptId: 'module-attempt', examQuestionId: 'q1', response: 'A',
        markedForReview: false, eliminatedOptions: [], annotations: {}, revision: 3,
      }]);
      result.current.save({
        questionId: 'q1', answer: 'B', markedForReview: false,
        eliminatedOptionIds: [], annotations: { version: 1, note: '' },
      });
      result.current.save({
        questionId: 'q1', answer: 'B', markedForReview: true,
        eliminatedOptionIds: ['A'], annotations: { version: 1, note: 'recheck' },
      });
    });

    await waitFor(() => expect(saveResponse).toHaveBeenCalledTimes(1));
    await act(async () => { await result.current.flush(); });

    expect(requests.map((request) => request.revision)).toEqual([3]);
    expect(requests[0]?.body).toMatchObject({
      response: 'B',
      markedForReview: true,
      eliminatedOptions: ['A'],
      annotations: { version: 1, note: 'recheck' },
    });
    expect(onSavedRevision).toHaveBeenLastCalledWith('q1', 4);
    expect(result.current.failure).toBeNull();
  });
});
