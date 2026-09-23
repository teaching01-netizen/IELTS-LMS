import { expect, it, vi } from 'vitest';
import { DurableResponseEngine, type TransportClient } from '../DurableResponseEngine';
import type { ResponseBatchRequestV2 } from '../types';

it('keeps edits durable locally while debouncing transport and flushes immediately on demand', async () => {
  vi.useFakeTimers();
  const transport: TransportClient = {
    fetchSnapshot: vi.fn().mockResolvedValue([]), submit: vi.fn(),
    sendBatch: vi.fn().mockImplementation(async (_attemptId: string, request: ResponseBatchRequestV2) => ({
      attemptRevision: 1, serverTime: new Date().toISOString(),
      acknowledgements: request.commands.map((command) => ({ writeId: command.writeId, questionId: command.questionId,
        clientVersion: command.clientVersion, outcome: 'applied', serverRevision: 1, canonicalResponse: command.response, contentHash: 'test' })),
    })),
  };
  const engine = new DurableResponseEngine({ scheduleId: 'debounce', attemptId: 'debounce', leaseEpoch: 1, controlEpoch: 1, transport, drainDebounceMs: 400 });
  const payload = (note: string) => ({ answer: 'A', markedForReview: false, eliminatedOptions: [], annotations: [{ id: 'note', text: note }] });
  try {
    await engine.acceptResponse('q', payload('First'));
    expect(localStorage.getItem('response-checkpoint:v2:debounce:q')).toContain('First');
    await vi.advanceTimersByTimeAsync(300);
    expect(transport.sendBatch).not.toHaveBeenCalled();
    await engine.acceptResponse('q', payload('Second'));
    await vi.advanceTimersByTimeAsync(300);
    expect(transport.sendBatch).not.toHaveBeenCalled();
    await engine.flush();
    expect(transport.sendBatch).toHaveBeenCalledTimes(1);
    expect(engine.getStates().get('q')?.confirmed?.payload.annotations[0]?.['text']).toBe('Second');
  } finally {
    engine.destroy(); vi.useRealTimers();
  }
});

it('lets discrete response changes preempt the typing debounce', async () => {
  vi.useFakeTimers();
  const transport: TransportClient = {
    fetchSnapshot: vi.fn().mockResolvedValue([]), submit: vi.fn(),
    sendBatch: vi.fn().mockImplementation(async (_attemptId: string, request: ResponseBatchRequestV2) => ({
      attemptRevision: 1, serverTime: new Date().toISOString(),
      acknowledgements: request.commands.map((command) => ({ writeId: command.writeId, questionId: command.questionId,
        clientVersion: command.clientVersion, outcome: 'applied', serverRevision: 1, canonicalResponse: command.response, contentHash: 'test' })),
    })),
  };
  const engine = new DurableResponseEngine({
    scheduleId: 'discrete', attemptId: 'discrete', leaseEpoch: 1, controlEpoch: 1,
    transport, drainDebounceMs: 400,
  });
  const payload = { answer: 'A', markedForReview: false, eliminatedOptions: [], annotations: [] };
  try {
    await engine.acceptResponse('typing-q', payload);
    await engine.acceptResponse('choice-q', payload, { drainImmediately: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.sendBatch).toHaveBeenCalledTimes(1);
    const request = (transport.sendBatch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as ResponseBatchRequestV2;
    expect(request.commands.map((command) => command.questionId)).toEqual(['typing-q', 'choice-q']);
  } finally {
    engine.destroy();
    vi.useRealTimers();
  }
});

it('listens for visibilitychange on document and removes the listener on destroy', async () => {
  const transport: TransportClient = {
    fetchSnapshot: vi.fn().mockResolvedValue([]), submit: vi.fn(), sendBatch: vi.fn(),
  };
  const engine = new DurableResponseEngine({
    scheduleId: 'visibility', attemptId: 'visibility', leaseEpoch: 1, controlEpoch: 1,
    transport, drainDebounceMs: 400,
  });
  const flush = vi.spyOn(engine, 'flush').mockResolvedValue(undefined);

  window.dispatchEvent(new Event('visibilitychange'));
  expect(flush).not.toHaveBeenCalled();
  document.dispatchEvent(new Event('visibilitychange'));
  expect(flush).toHaveBeenCalledTimes(1);

  engine.destroy();
  flush.mockClear();
  document.dispatchEvent(new Event('visibilitychange'));
  expect(flush).not.toHaveBeenCalled();
});
