/**
 * Module-scoped refusals (docs/sat-m1-m2-handoff-plan.md, Phase 1).
 *
 * A late Module 1 answer refused after Module 1 closed must stay Module 1's
 * problem: it is kept as evidence and never sent again, while Module 2 keeps
 * saving. Before the fix the refusal fenced the whole attempt
 * (conflict_terminal) and every Module 2 answer was refused locally.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DurableResponseEngine, type TransportClient } from '../DurableResponseEngine';
import type { ResponseBatchRequestV2, ResponsePayload, ResponseSnapshotV2 } from '../types';

const storage = vi.hoisted(() => ({ save: vi.fn(), list: vi.fn(), clear: vi.fn() }));
vi.mock('../../../utils/durableDraftStore', () => ({
  saveDurableDraft: storage.save, listDurableDrafts: storage.list, clearDurableDraft: storage.clear,
}));

const payload = (answer: string): ResponsePayload => ({ answer, markedForReview: false, annotations: [], eliminatedOptions: [] });
const SCOPES: Record<string, string> = { m1q1: 'ma-1', m1q2: 'ma-1', m2q1: 'ma-2', m2q2: 'ma-2' };
const closedModuleRefusal = {
  code: 'DEADLINE_EXPIRED',
  status: 422,
  details: { reason: 'MODULE_DEADLINE_EXPIRED', questionId: 'm1q1', moduleId: 'mod-1' },
};

function emptySnapshot(): ResponseSnapshotV2 {
  return { attemptId: 'att', protocolVersion: 2, deliveryStatus: 'running', leaseEpoch: 1, controlEpoch: 1, attemptRevision: 1, responses: [] };
}

const engines: DurableResponseEngine[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.destroy();
  storage.save.mockReset();
  storage.list.mockReset();
  storage.clear.mockReset();
  localStorage.clear();
});

function setup(options: { scoped: boolean; refuseScope?: string }) {
  storage.save.mockResolvedValue(undefined);
  storage.list.mockResolvedValue([]);
  storage.clear.mockResolvedValue(undefined);
  const batches: ResponseBatchRequestV2[] = [];
  const transport: TransportClient = {
    fetchSnapshot: vi.fn().mockResolvedValue(emptySnapshot()),
    submit: vi.fn(),
    sendBatch: vi.fn(async (_attemptId: string, request: ResponseBatchRequestV2) => {
      batches.push(request);
      if (options.refuseScope && request.commands.some((command) => SCOPES[command.questionId] === options.refuseScope)) {
        throw closedModuleRefusal;
      }
      return {
        attemptRevision: 2,
        serverTime: new Date().toISOString(),
        acknowledgements: request.commands.map((command) => ({
          writeId: command.writeId,
          questionId: command.questionId,
          clientVersion: command.clientVersion,
          outcome: 'applied' as const,
          serverRevision: 2,
          canonicalResponse: command.response,
          contentHash: 'hash',
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
    ...(options.scoped ? { scopeOf: (questionId: string) => SCOPES[questionId] ?? null } : {}),
  });
  engines.push(engine);
  return { engine, transport, batches };
}

describe('DurableResponseEngine module scopes', () => {
  it('archives offline intent when the server projection closes its module before a write refusal', async () => {
    const { engine } = setup({ scoped: true });
    await engine.recover();
    await engine.acceptResponse('m1q1', payload('offline answer'));
    engine.sealScope('ma-1');
    expect(engine.getQuarantined()[0]?.payload.answer).toBe('offline answer');
    expect(engine.getQuarantined()[0]?.reason).toBe('MODULE_CLOSED');
    expect(engine.adoptControlEpochIfIdle(2, 'module_start')).toMatchObject({ adopted: true });
    await engine.acceptResponse('m2q1', payload('next answer'));
    await engine.flush();
    expect(engine.getStatus()).toBe('synced');
  });
  it('restores closed-module evidence after reload while Module 2 remains writable', async () => {
    const first = setup({ scoped: true, refuseScope: 'ma-1' }).engine;
    await first.recover();
    await first.acceptResponse('m1q1', payload('offline final answer'));
    await first.flush();
    const evidence = first.getQuarantined();
    first.destroy();
    const { engine } = setup({ scoped: true });
    storage.list.mockImplementation(async (prefix: string) => prefix.includes('quarantine')
      ? evidence.map((value) => ({ key: `${prefix}${value.writeId}`, value })) : []);
    await engine.recover();
    engine.refreshScopes();
    expect(engine.getClosedScopes().get('ma-1')).toBe('MODULE_DEADLINE_EXPIRED');
    expect(engine.getQuarantined()[0]?.payload.answer).toBe('offline final answer');
    await engine.acceptResponse('m2q1', payload('after reload'));
    await engine.flush();
    expect(engine.getStates().get('m2q1')?.confirmed?.payload.answer).toBe('after reload');
    expect(() => engine.assertBoundarySettled()).not.toThrow();
  });
  it('confines a closed-module refusal to that module and keeps saving the next module', async () => {
    const { engine, batches } = setup({ scoped: true, refuseScope: 'ma-1' });
    await engine.recover();

    await engine.acceptResponse('m1q1', payload('late M1 answer'));
    await engine.flush();

    expect(engine.getClosedScopes().get('ma-1')).toBe('MODULE_DEADLINE_EXPIRED');
    expect(engine.getStatus()).not.toBe('conflict_terminal');
    expect(engine.getQuarantined().map((entry) => entry.questionId)).toEqual(['m1q1']);

    await engine.acceptResponse('m2q1', payload('M2 answer'));
    await engine.flush();

    const m2Batch = batches.find((batch) => batch.commands.some((command) => command.questionId === 'm2q1'));
    expect(m2Batch).toBeDefined();
    expect(engine.getStates().get('m2q1')?.confirmed?.payload.answer).toBe('M2 answer');
    expect(engine.getPendingCount()).toBe(0);
    expect(engine.getStatus()).toBe('synced');
    expect(() => engine.assertBoundarySettled()).not.toThrow();
    expect(engine.adoptControlEpochIfIdle(2, 'module_start')).toMatchObject({ adopted: true });
  });

  it('preserves the whole-attempt fence from an old server with no module reason', async () => {
    const { engine, transport } = setup({ scoped: true });
    vi.mocked(transport.sendBatch).mockRejectedValue({ code: 'DEADLINE_EXPIRED', status: 422 });
    await engine.recover();
    await engine.acceptResponse('m1q1', payload('late'));
    await engine.flush();
    expect(engine.getStatus()).toBe('conflict_terminal');
    expect(engine.getClosedScopes().size).toBe(0);
  });

  it.each(['MODULE_UNASSIGNED', 'MODULE_CLOSED', 'MODULE_NOT_STARTED', 'MODULE_DEADLINE_EXPIRED'])('contains %s within its module', async (reason) => {
    const { engine, transport } = setup({ scoped: true });
    vi.mocked(transport.sendBatch).mockRejectedValueOnce({ code: reason === 'MODULE_DEADLINE_EXPIRED' ? 'DEADLINE_EXPIRED' : 'ATTEMPT_NOT_WRITABLE', details: { reason } });
    await engine.recover();
    await engine.acceptResponse('m1q1', payload('late'));
    await engine.flush();
    await engine.acceptResponse('m2q1', payload('new module'));
    await engine.flush();
    expect(engine.getClosedScopes().get('ma-1')).toBe(reason);
    expect(engine.getStatus()).toBe('synced');
    expect(engine.getStates().get('m2q1')?.confirmed?.payload.answer).toBe('new module');
  });

  it('never sends a draft for a module the server already closed', async () => {
    const { engine, batches } = setup({ scoped: true, refuseScope: 'ma-1' });
    await engine.recover();
    await engine.acceptResponse('m1q1', payload('first'));
    await engine.flush();
    const sentBefore = batches.length;

    await engine.acceptResponse('m1q2', payload('typed after close'));
    await engine.flush();

    expect(batches.length).toBe(sentBefore);
    expect(engine.getQuarantined().some((entry) => entry.questionId === 'm1q2')).toBe(true);
  });

  it('keeps the attempt-wide fence when no scope function is provided', async () => {
    const { engine } = setup({ scoped: false, refuseScope: 'ma-1' });
    await engine.recover();
    await engine.acceptResponse('m1q1', payload('late M1 answer'));
    await engine.flush();

    expect(engine.getStatus()).toBe('conflict_terminal');
    expect(engine.getClosedScopes().size).toBe(0);
  });

  it('never mixes two modules in one batch', async () => {
    const { engine, batches } = setup({ scoped: true });
    await engine.recover();
    await engine.acceptResponse('m1q1', payload('a'));
    await engine.acceptResponse('m2q1', payload('b'));
    await engine.acceptResponse('m1q2', payload('c'));
    await engine.flush();

    expect(batches.length).toBeGreaterThanOrEqual(2);
    for (const batch of batches) {
      const scopes = new Set(batch.commands.map((command) => SCOPES[command.questionId]));
      expect(scopes.size).toBe(1);
    }
  });

  it('keeps the exact durable write identity after snapshot recovery', async () => {
    const { engine, transport } = setup({ scoped: true });
    vi.mocked(transport.fetchSnapshot).mockResolvedValue({
      ...emptySnapshot(),
      responses: [{
        questionId: 'm1q1', writeId: 'durable-final-write', clientVersion: 12,
        outcome: 'applied', serverRevision: 9, canonicalResponse: payload('B'), contentHash: 'final-hash',
      }],
    });
    await engine.recover();
    expect(engine.getScopeManifest('ma-1')).toEqual([
      { questionId: 'm1q1', writeId: 'durable-final-write', clientVersion: 12 },
    ]);
  });

  it('lists the acknowledged version of every answered question in a close manifest', async () => {
    const { engine } = setup({ scoped: true });
    await engine.recover();
    await engine.acceptResponse('m1q1', payload('a'));
    await engine.acceptResponse('m1q1', payload('a2'));
    await engine.acceptResponse('m1q2', payload('b'));
    await engine.acceptResponse('m2q1', payload('other module'));
    await engine.flush();

    const manifest = engine.getScopeManifest('ma-1');
    expect(manifest.map((entry) => entry.questionId).sort()).toEqual(['m1q1', 'm1q2']);
    for (const entry of manifest) expect(entry.clientVersion).toBeGreaterThan(0);
    expect(manifest.find((entry) => entry.questionId === 'm1q1')?.clientVersion).toBeGreaterThan(
      manifest.find((entry) => entry.questionId === 'm1q2')?.clientVersion ?? 0,
    );
  });
});
