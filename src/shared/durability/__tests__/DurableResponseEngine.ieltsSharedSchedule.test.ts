/**
 * IELTS shared-timetable continuity (docs/superpowers/plans/
 * 2026-10-30-ielts-shared-clock-offline-continuity.md, Task 7): a section
 * boundary is crossed on local durability alone, and a closed section's
 * drafts become evidence without fencing the next section.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DurableResponseEngine, type TransportClient } from '../DurableResponseEngine';
import type { ResponseBatchRequestV2, ResponsePayload, ResponseSnapshotV2 } from '../types';

const storage = vi.hoisted(() => ({ save: vi.fn(), list: vi.fn(), clear: vi.fn() }));
vi.mock('../../../utils/durableDraftStore', () => ({
  loadDurableDraft: vi.fn(async () => null),
  saveDurableDraft: storage.save, listDurableDrafts: storage.list, clearDurableDraft: storage.clear,
}));

const payload = (answer: string): ResponsePayload => ({ answer, markedForReview: false, annotations: [], eliminatedOptions: [] });
const SECTION: Record<string, string> = { r1: 'reading', r2: 'reading', w1: 'writing' };
const snapshot = (controlEpoch: number): ResponseSnapshotV2 => ({
  attemptId: 'att', protocolVersion: 2, deliveryStatus: 'running', leaseEpoch: 1, controlEpoch, attemptRevision: 1, responses: [],
});

const engines: DurableResponseEngine[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.destroy();
  storage.save.mockReset();
  storage.list.mockReset();
  storage.clear.mockReset();
  localStorage.clear();
});

function setup(sendBatch: TransportClient['sendBatch']) {
  storage.save.mockResolvedValue(undefined);
  storage.list.mockResolvedValue([]);
  storage.clear.mockResolvedValue(undefined);
  const transport: TransportClient = {
    fetchSnapshot: vi.fn().mockResolvedValue(snapshot(1)), submit: vi.fn(), sendBatch: vi.fn(sendBatch),
    submitDraftEvidence: vi.fn(async (_attemptId: string, items: unknown[]) => ({ recorded: items.length })),
  } as TransportClient;
  const engine = new DurableResponseEngine({
    scheduleId: 'sched', attemptId: 'att', leaseEpoch: 1, controlEpoch: 1, drainDebounceMs: 60_000, transport,
    scopeOf: (questionId) => SECTION[questionId] ?? null,
  });
  engines.push(engine);
  return { engine, transport };
}

const applied = async (_attemptId: string, request: ResponseBatchRequestV2) => ({
  attemptRevision: 2,
  serverTime: new Date().toISOString(),
  acknowledgements: request.commands.map((command) => ({
    writeId: command.writeId, questionId: command.questionId, clientVersion: command.clientVersion,
    outcome: 'applied' as const, serverRevision: 2, canonicalResponse: command.response, contentHash: 'hash',
  })),
});

describe('DurableResponseEngine IELTS shared timetable', () => {
  it('crosses a boundary on local durability while the transport hangs', async () => {
    const { engine, transport } = setup(() => new Promise(() => undefined));
    await engine.recover();
    await engine.acceptResponse('r1', payload('reading answer'));
    void engine.flush();
    const barrier = await Promise.race([
      engine.checkpointScopeLocally('reading'),
      new Promise((resolve) => setTimeout(() => resolve('timed out'), 200)),
    ]);
    expect(barrier).toEqual({ durable: true });
    expect(transport.fetchSnapshot).toHaveBeenCalledTimes(1); // recover only, never the barrier
  });

  it('restores server-acknowledged answers after an offline reload', async () => {
    const { engine } = setup(applied);
    await engine.recover();
    await engine.acceptResponse('r1', payload('saved answer'));
    await engine.flush();
    expect(engine.getStates().get('r1')?.confirmed?.payload.answer).toBe('saved answer');
    engine.destroy();

    const offline = new DurableResponseEngine({
      scheduleId: 'sched', attemptId: 'att', leaseEpoch: 1, controlEpoch: 1, drainDebounceMs: 60_000,
      transport: {
        fetchSnapshot: vi.fn().mockRejectedValue(new Error('offline')),
        submit: vi.fn(), sendBatch: vi.fn(),
      } as unknown as TransportClient,
      scopeOf: (questionId) => SECTION[questionId] ?? null,
    });
    engines.push(offline);
    await offline.recover();
    expect(offline.getStates().get('r1')?.confirmed?.payload.answer).toBe('saved answer');
    expect(offline.getPendingCount()).toBe(0);
  });

  it('reports storage loss instead of claiming durability', async () => {
    const { engine } = setup(applied);
    await engine.recover();
    storage.save.mockRejectedValue(new Error('IndexedDB unavailable'));
    await engine.acceptResponse('r1', payload('kept in memory')).catch(() => undefined);
    localStorage.clear();
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(await engine.checkpointScopeLocally('reading')).toEqual({ durable: false, reason: 'storage_unavailable' });
    setItem.mockRestore();
  });

  it('keeps a closed Reading draft as evidence and Writing keeps saving', async () => {
    const { engine, transport } = setup(async (attemptId, request) => {
      if (request.commands.some((command) => SECTION[command.questionId] === 'reading')) {
        throw { code: 'DEADLINE_EXPIRED', status: 422, details: { reason: 'IELTS_SECTION_CLOSED', sectionKey: 'reading', questionId: 'r1' } };
      }
      return applied(attemptId, request);
    });
    await engine.recover();
    await engine.acceptResponse('r1', payload('late reading'));
    await engine.flush();
    expect(engine.getClosedScopes().get('reading')).toBe('IELTS_SECTION_CLOSED');
    expect(engine.getQuarantined().map((entry) => entry.payload.answer)).toEqual(['late reading']);
    await vi.waitFor(() => expect(transport.submitDraftEvidence).toHaveBeenCalledTimes(1));
    expect(engine.getStatus()).not.toBe('conflict_terminal');
    await engine.acceptResponse('w1', payload('writing essay'));
    await engine.flush();
    expect(engine.getStates().get('w1')?.confirmed?.payload.answer).toBe('writing essay');
  });

  it('retries a write the server has not opened yet instead of discarding it', async () => {
    let calls = 0;
    const { engine } = setup(async (attemptId, request) => {
      calls += 1;
      if (calls === 1) throw { code: 'ATTEMPT_NOT_WRITABLE', status: 422, details: { reason: 'IELTS_SECTION_NOT_OPEN', sectionKey: 'writing', questionId: 'w1' } };
      return applied(attemptId, request);
    });
    await engine.recover();
    await engine.acceptResponse('w1', payload('early by skew'));
    await engine.flush();
    expect(engine.getQuarantined()).toHaveLength(0);
    expect(engine.getClosedScopes().has('writing')).toBe(false);
    expect(engine.getStatus()).not.toBe('conflict_terminal');
  });
});
