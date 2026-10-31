/**
 * Unsynced-window and close-settlement contracts
 * (docs/plans/2026-10-31-sat-unsynced-answer-resilience.md).
 *
 * The UI warning is only as honest as this timestamp: one window per attempt,
 * cleared by an acknowledgement, never restarted by the next keystroke. The
 * close settlement is the other half: a write the server already holds must be
 * promoted, not quarantined as late evidence, when its HTTP ack was lost.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DurableResponseEngine, type TransportClient } from '../DurableResponseEngine';
import type {
  ResponseAcknowledgementV2,
  ResponseBatchRequestV2,
  ResponseBatchResponseV2,
  ResponsePayload,
  ResponseSnapshotV2,
} from '../types';

const storage = vi.hoisted(() => ({ save: vi.fn(), list: vi.fn(), clear: vi.fn() }));
vi.mock('../../../utils/durableDraftStore', () => ({
  loadDurableDraft: vi.fn(async () => null),
  saveDurableDraft: storage.save,
  listDurableDrafts: storage.list,
  clearDurableDraft: storage.clear,
}));

const payload = (answer: string): ResponsePayload => ({
  answer,
  markedForReview: false,
  annotations: [],
  eliminatedOptions: [],
});

function emptySnapshot(): ResponseSnapshotV2 {
  return {
    attemptId: 'att',
    protocolVersion: 2,
    deliveryStatus: 'running',
    leaseEpoch: 1,
    controlEpoch: 1,
    attemptRevision: 1,
    responses: [],
  };
}

const engines: DurableResponseEngine[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.destroy();
  storage.save.mockReset();
  storage.list.mockReset();
  storage.clear.mockReset();
  localStorage.clear();
  vi.useRealTimers();
});

function setup(options: {
  failFirstBatch?: boolean;
  scoped?: boolean;
} = {}) {
  storage.save.mockResolvedValue(undefined);
  storage.list.mockResolvedValue([]);
  storage.clear.mockResolvedValue(undefined);
  let batchCalls = 0;
  let failing = options.failFirstBatch === true;
  const transport: TransportClient = {
    fetchSnapshot: vi.fn().mockResolvedValue(emptySnapshot()),
    submit: vi.fn(),
    sendBatch: vi.fn(async (_attemptId: string, request: ResponseBatchRequestV2): Promise<ResponseBatchResponseV2> => {
      batchCalls += 1;
      if (failing) {
        failing = false;
        throw new Error('network unavailable');
      }
      return {
        attemptRevision: batchCalls + 1,
        serverTime: new Date().toISOString(),
        acknowledgements: request.commands.map((command) => ({
          writeId: command.writeId,
          questionId: command.questionId,
          clientVersion: command.clientVersion,
          outcome: 'applied' as const,
          serverRevision: batchCalls + 1,
          canonicalResponse: command.response,
          contentHash: `hash-${batchCalls}`,
        })),
      };
    }),
  };
  const engine = new DurableResponseEngine({
    scheduleId: 'sched',
    attemptId: 'att',
    leaseEpoch: 1,
    controlEpoch: 1,
    drainDebounceMs: 60_000,
    transport,
    ...(options.scoped ? { scopeOf: () => 'ma-1' } : {}),
  });
  engines.push(engine);
  return { engine, transport };
}

function acknowledgementFor(engine: DurableResponseEngine, answer: string): ResponseAcknowledgementV2 {
  const entry = engine.getQuarantined()[0];
  if (!entry) throw new Error('expected a quarantined write');
  return {
    writeId: entry.writeId,
    questionId: entry.questionId,
    clientVersion: entry.clientVersion,
    outcome: 'applied',
    serverRevision: 7,
    canonicalResponse: payload(answer),
    contentHash: 'canonical-hash',
  };
}

describe('DurableResponseEngine unsynced window', () => {
  it('starts once and is not restarted by the next keystroke', async () => {
    const { engine } = setup();
    await engine.recover();
    expect(engine.getUnsyncedSince()).toBeNull();

    await engine.acceptResponse('q1', payload('first'));
    const first = engine.getUnsyncedSince();
    expect(first).not.toBeNull();

    await engine.acceptResponse('q1', payload('second'));
    expect(engine.getUnsyncedSince()).toBe(first);
  });

  it('clears only after the acknowledgement leaves no unconfirmed work', async () => {
    const { engine } = setup();
    await engine.recover();
    await engine.acceptResponse('q1', payload('answer'));
    expect(engine.getUnsyncedSince()).not.toBeNull();
    await engine.flush();
    expect(engine.getPendingCount()).toBe(0);
    expect(engine.getUnsyncedSince()).toBeNull();
  });

  it('forceRetry clears the scheduled retry before draining', async () => {
    const { engine } = setup();
    await engine.recover();
    // A real timer stands in for the backoff a failed drain would schedule.
    // The contract is public: the option is what the lifecycle/close edge
    // passes, and it must remove the timer before the usual early return.
    const retryHandle = setTimeout(() => undefined, 60_000);
    (engine as unknown as { retryTimer: ReturnType<typeof setTimeout> | null }).retryTimer = retryHandle;

    await engine.flush({ forceRetry: true });

    expect((engine as unknown as { retryTimer: ReturnType<typeof setTimeout> | null }).retryTimer).toBeNull();
    clearTimeout(retryHandle);
  });

  it('flushes with forceRetry on the lifecycle edges', async () => {
    const { engine } = setup();
    await engine.recover();
    const flush = vi.spyOn(engine, 'flush').mockResolvedValue(undefined);

    window.dispatchEvent(new Event('pagehide'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));

    expect(flush).toHaveBeenCalledTimes(3);
    for (const call of flush.mock.calls) expect(call[0]).toEqual({ forceRetry: true });
  });
});

describe('DurableResponseEngine close settlement', () => {
  it('settles a sealed scope from the compact manifest identity', async () => {
    const { engine } = setup({ scoped: true });
    await engine.recover();
    await engine.acceptResponse('q1', payload('B'));
    engine.sealScope('ma-1');
    const entry = engine.getQuarantined()[0];
    if (!entry) throw new Error('expected a quarantined write');

    await engine.settleScopeFromManifest('ma-1', [{
      questionId: entry.questionId,
      writeId: entry.writeId,
      clientVersion: entry.clientVersion,
    }]);

    expect(engine.getQuarantined()).toHaveLength(0);
    expect(engine.getStates().get('q1')?.pending).toBeNull();
    expect(engine.getStates().get('q1')?.confirmed?.payload.answer).toBe('B');
    expect(engine.getClosedScopes().get('ma-1')).toBe('MODULE_CLOSED');
    engine.sealScope('ma-1');
    expect(engine.getQuarantined()).toHaveLength(0);
  });

  it('settles a quarantined write when the close proves it durable', async () => {
    const { engine } = setup({ scoped: true });
    await engine.recover();
    await engine.acceptResponse('q1', payload('A'));
    engine.sealScope('ma-1');
    expect(engine.getQuarantined()).toHaveLength(1);
    expect(engine.getClosedScopes().get('ma-1')).toBe('MODULE_CLOSED');

    const ack = acknowledgementFor(engine, 'A');
    await engine.applyScopeCloseAcknowledgement('ma-1', 'close-1', [ack]);

    expect(engine.getQuarantined()).toHaveLength(0);
    expect(engine.getStates().get('q1')?.pending).toBeNull();
    expect(engine.getStates().get('q1')?.confirmed?.payload.answer).toBe('A');
    expect(engine.getStates().get('q1')?.confirmed?.serverRevision).toBe(7);

    // The later bootstrap seal must not recreate the evidence entry.
    engine.sealScope('ma-1');
    expect(engine.getQuarantined()).toHaveLength(0);
    expect(engine.getUnsyncedSince()).toBeNull();
  });
});
