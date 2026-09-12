/** WP7 reason-coded durability counters (telemetry-only, never answer content).
 *
 * The engine exposes a best-effort onDurabilityEvent hook; providers forward
 * it to emitStudentObservabilityMetric. These tests pin the emission points
 * and the privacy invariant (reason/epoch/count fields only).
 *
 * WP0 mapping (WP-T1 second pass): this file is the WP-T1-owned telemetry
 * pin suite for the frozen E1 emission contract plus the E2 prune events
 * (quarantine_pruned ack-superseded/discard, quarantine_archived) and the
 * E2 drain/control shapes. quarantine_pruned pins are ACTIVE (E2 landed
 * green — T1 SIGNAL 2026-09-10); no prune pins remain deferred.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DurableResponseEngine, type TransportClient } from '../DurableResponseEngine';
import type { ResponsePayload, ResponseSnapshotV2 } from '../types';

const storage = vi.hoisted(() => ({ save: vi.fn(), list: vi.fn(), clear: vi.fn() }));
vi.mock('../../../utils/durableDraftStore', () => ({
  saveDurableDraft: storage.save,
  listDurableDrafts: storage.list,
  clearDurableDraft: storage.clear,
}));

type DurabilityEvent = {
  name: string;
  fields?: Record<string, string | number | boolean | null | undefined>;
};

const engines: DurableResponseEngine[] = [];

const payload = (answer: string): ResponsePayload => ({
  answer,
  markedForReview: false,
  eliminatedOptions: [],
  annotations: [],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function runningSnapshot(overrides?: Partial<ResponseSnapshotV2>): ResponseSnapshotV2 {
  return {
    attemptId: 'telemetry-attempt',
    protocolVersion: 2,
    deliveryStatus: 'running',
    leaseEpoch: 1,
    controlEpoch: 1,
    attemptRevision: 1,
    responses: [],
    ...overrides,
  };
}

function createEngine(opts?: {
  fetchSnapshot?: TransportClient['fetchSnapshot'];
  sendBatch?: TransportClient['sendBatch'];
  onDurabilityEvent?: (name: string, fields?: Record<string, string | number | boolean | null | undefined>) => void;
}) {
  const events: DurabilityEvent[] = [];
  const transport: TransportClient = {
    fetchSnapshot: opts?.fetchSnapshot ?? vi.fn().mockResolvedValue([]),
    sendBatch: opts?.sendBatch ?? vi.fn(),
    submit: vi.fn(),
  };
  const engine = new DurableResponseEngine({
    scheduleId: 'telemetry-sched',
    attemptId: 'telemetry-attempt',
    leaseEpoch: 1,
    controlEpoch: 1,
    drainDebounceMs: 60_000,
    transport,
    onDurabilityEvent:
      opts?.onDurabilityEvent ?? ((name, fields) => { events.push({ name, fields }); }),
  });
  engines.push(engine);
  return { engine, transport, events };
}

beforeEach(() => {
  localStorage.clear();
  storage.save.mockReset().mockResolvedValue(undefined);
  storage.list.mockReset().mockResolvedValue([]);
  storage.clear.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  engines.splice(0).forEach((e) => e.destroy());
  vi.restoreAllMocks();
});

describe('durability telemetry (WP7 reason-coded counters)', () => {
  it('emits intent_queued_during_recovery when input is accepted before recovery seeds versions', async () => {
    const network = deferred<ResponseSnapshotV2>();
    const fetchSnapshot = vi.fn().mockReturnValue(network.promise);
    const { engine, events } = createEngine({ fetchSnapshot });
    const recovery = engine.recover();
    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalled());
    const accepted = engine.acceptResponse('q1', payload('pre-recovery typing'));
    expect(events.map((e) => e.name)).toContain('intent_queued_during_recovery');
    network.resolve(runningSnapshot());
    await recovery;
    await accepted;
  });

  it('emits control_epoch_blocked per blocked question on a timing-only control bump', async () => {
    const { engine, events } = createEngine({
      fetchSnapshot: vi.fn().mockResolvedValue(runningSnapshot()),
    });
    await engine.recover();
    await engine.acceptResponse('q1', payload('first answer'));
    await engine.acceptResponse('q2', payload('second answer'));
    engine.updateEpochs(1, 2);
    const blocked = events.filter((e) => e.name === 'control_epoch_blocked');
    expect(blocked).toHaveLength(2);
    for (const event of blocked) {
      expect(event.fields?.reason).toBe('CONTROL_EPOCH_STALE');
      expect(event.fields?.controlEpoch).toBe(2);
    }
    expect(engine.getBlockedCount()).toBe(2);
  });

  it('emits reconcile_succeeded when a blocked draft is re-issued under the new epoch', async () => {
    const fetchSnapshot = vi.fn()
      .mockResolvedValueOnce(runningSnapshot({ controlEpoch: 1 }))
      .mockResolvedValue(runningSnapshot({ controlEpoch: 2 }));
    const { engine, events } = createEngine({ fetchSnapshot });
    await engine.recover();
    await engine.acceptResponse('q1', payload('blocked answer'));
    engine.updateEpochs(1, 2);
    expect(engine.getBlockedCount()).toBe(1);
    await expect(engine.reconcileBlocked('q1')).resolves.toBe(true);
    expect(events.map((e) => e.name)).toContain('reconcile_succeeded');
    expect(engine.getBlockedCount()).toBe(0);
  });

  it('emits reconcile_failed{reason:reconcile_in_progress} on concurrent same-Q reconciles (mutex pin)', async () => {
    // Frozen E1 mutex contract: the second concurrent reconcile for Q
    // returns false WITHOUT touching shared state, emitting exactly one
    // reasoned event. Deferred fetch holds the first reconcile in flight.
    const gate = deferred<ResponseSnapshotV2>();
    const fetchSnapshot = vi.fn()
      .mockResolvedValueOnce(runningSnapshot({ controlEpoch: 1 }))
      .mockReturnValue(gate.promise);
    const { engine, events } = createEngine({ fetchSnapshot });
    await engine.recover();
    await engine.acceptResponse('q1', payload('blocked answer'));
    engine.updateEpochs(1, 2);
    expect(engine.getBlockedCount()).toBe(1);
    const first = engine.reconcileBlocked('q1');
    await vi.waitFor(() => expect(fetchSnapshot.mock.calls.length).toBeGreaterThanOrEqual(2));
    await expect(engine.reconcileBlocked('q1')).resolves.toBe(false);
    expect(events.filter((e) => e.name === 'reconcile_failed' && e.fields?.reason === 'reconcile_in_progress')).toHaveLength(1);
    gate.resolve(runningSnapshot({ controlEpoch: 2 }));
    await expect(first).resolves.toBe(true);
    expect(engine.getBlockedCount()).toBe(0);
  });

  it('emits reconcile_failed{reason:lease_changed} when the blocked origin lease != current lease', async () => {
    // Park the quarantine archive so the live lease fence's tombstone can
    // never land mid-reconcile (see preservation-suite lease_changed pin
    // for the traced race analysis).
    const gate = deferred<void>();
    const fetchSnapshot = vi.fn().mockResolvedValue(runningSnapshot({ controlEpoch: 1 }));
    const { engine, events } = createEngine({ fetchSnapshot });
    await engine.recover();
    const baseSave = storage.save.getMockImplementation();
    storage.save.mockImplementation((key: string, value: unknown) => {
      if (String(key).includes('v2_quarantine:')) return gate.promise.then(() => undefined);
      const impl = baseSave as unknown as ((k: string, v: unknown) => Promise<void>) | undefined;
      if (impl) return impl(key, value);
      return Promise.resolve(undefined);
    });
    await engine.acceptResponse('q1', payload('lease-fenced answer'));
    engine.updateEpochs(1, 2);
    engine.updateEpochs(2, 2);
    fetchSnapshot.mockResolvedValueOnce(runningSnapshot({ leaseEpoch: 2, controlEpoch: 2 }));
    await expect(engine.reconcileBlocked('q1')).resolves.toBe(false);
    expect(events.filter((e) => e.name === 'reconcile_failed' && e.fields?.reason === 'lease_changed')).toHaveLength(1);
    expect(engine.getBlockedCount()).toBe(1);
    gate.resolve();
  });

  it('emits quarantine_archived on durable archive with the fence reason (success-path pin)', async () => {
    const { engine, events } = createEngine({
      fetchSnapshot: vi.fn().mockResolvedValue(runningSnapshot()),
    });
    await engine.recover();
    await engine.acceptResponse('q1', payload('archived answer'));
    engine.updateEpochs(2, 1);
    await vi.waitFor(() => expect(events.map((e) => e.name)).toContain('quarantine_archived'));
    const archived = events.filter((e) => e.name === 'quarantine_archived');
    expect(archived).toHaveLength(1);
    expect(archived[0]?.fields?.reason).toBe('EPOCH_STALE');
  });

  it("emits quarantine_pruned{reason:'ack-superseded'} with questionId+count when a replacement ack prunes Q", async () => {
    const sendBatch = vi.fn().mockImplementation(async (_attemptId: string, req: { commands: Array<{ writeId: string; questionId: string; clientVersion: number; response: ResponsePayload }> }) => ({
      attemptRevision: 1, serverTime: new Date().toISOString(),
      acknowledgements: req.commands.map((command) => ({ writeId: command.writeId, questionId: command.questionId, clientVersion: command.clientVersion, outcome: 'applied' as const, serverRevision: 1, canonicalResponse: command.response, contentHash: 'hash-live' })),
    }));
    const { engine, transport, events } = createEngine({
      fetchSnapshot: vi.fn().mockResolvedValue(runningSnapshot()),
      sendBatch,
    });
    await engine.recover();
    await engine.acceptResponse('q1', payload('fenced answer'));
    engine.updateEpochs(2, 1);
    await vi.waitFor(() => expect(engine.getQuarantined()).toHaveLength(1));
    const fencedWriteId = engine.getQuarantined()[0]?.writeId as string;
    await vi.waitFor(() => {
      const raw = localStorage.getItem('response-checkpoint:v2:telemetry-attempt:q1');
      expect(raw).not.toBeNull();
      expect((JSON.parse(raw as string) as { tombstoned?: boolean }).tombstoned).toBe(true);
    });
    await engine.acceptResponse('q1', payload('replacement answer'));
    await engine.flush();
    expect(transport.sendBatch).toHaveBeenCalled();
    await vi.waitFor(() => expect(events.map((e) => e.name)).toContain('quarantine_pruned'));
    const pruned = events.filter((e) => e.name === 'quarantine_pruned' && e.fields?.reason === 'ack-superseded');
    expect(pruned.length).toBeGreaterThan(0);
    expect(pruned[0]?.fields?.questionId).toBe('q1');
    expect(typeof pruned[0]?.fields?.count).toBe('number');
    expect(pruned[0]?.fields?.count as number).toBeGreaterThanOrEqual(1);
    expect(engine.getQuarantined().filter((e) => e.questionId === 'q1')).toHaveLength(0);
    const deletedKeys = storage.clear.mock.calls.map((call) => call[0] as string);
    expect(deletedKeys.some((key) => key.includes('v2_quarantine:telemetry-attempt:') && key.includes(fencedWriteId))).toBe(true);
    // Privacy: the prune event carries reason/ID/count only — never payload.
    expect(JSON.stringify(pruned)).not.toContain('replacement answer');
    expect(JSON.stringify(pruned)).not.toContain('fenced answer');
  });

  it("emits quarantine_pruned{reason:'discard'} with questionId+count on discardBlocked (durable keys deleted)", async () => {
    const { engine, events } = createEngine({
      fetchSnapshot: vi.fn().mockResolvedValue(runningSnapshot()),
    });
    await engine.recover();
    await engine.acceptResponse('q1', payload('fenced answer'));
    // Park the archive so the tombstone cannot land before discard.
    const archiveGate = deferred<void>();
    const baseSave = storage.save.getMockImplementation();
    storage.save.mockImplementation((key: string, value: unknown) => {
      if (String(key).includes('v2_quarantine:')) return archiveGate.promise.then(() => undefined);
      const impl = baseSave as unknown as ((k: string, v: unknown) => Promise<void>) | undefined;
      if (impl) return impl(key, value);
      return Promise.resolve(undefined);
    });
    engine.updateEpochs(2, 1);
    await vi.waitFor(() => expect(engine.getQuarantined()).toHaveLength(1));
    const fencedWriteId = engine.getQuarantined()[0]?.writeId as string;
    expect(engine.getBlockedQuestionIds()).toContain('q1');
    expect(engine.discardBlocked('q1')).toBe(true);
    archiveGate.resolve();
    expect(engine.getQuarantined().filter((e) => e.questionId === 'q1')).toHaveLength(0);
    const pruned = events.filter((e) => e.name === 'quarantine_pruned' && e.fields?.reason === 'discard');
    expect(pruned.length).toBeGreaterThan(0);
    expect(pruned[0]?.fields?.questionId).toBe('q1');
    expect(pruned[0]?.fields?.count as number).toBeGreaterThanOrEqual(1);
    const deletedKeys = storage.clear.mock.calls.map((call) => call[0] as string);
    expect(deletedKeys.some((key) => key.includes('v2_quarantine:telemetry-attempt:') && key.includes(fencedWriteId))).toBe(true);
  });

  it('emits no quarantine_pruned and prunes nothing when the ledger fills past 50 without ack/discard (no silent shift)', async () => {
    const sendBatch = vi.fn().mockRejectedValue({ code: 'VERSION_COLLISION' });
    const { engine, events } = createEngine({
      fetchSnapshot: vi.fn().mockResolvedValue(runningSnapshot()),
      sendBatch,
    });
    await engine.recover();
    for (let i = 0; i < 51; i += 1) {
      await engine.acceptResponse('q' + i, payload('answer ' + i));
    }
    const firstWriteId = engine.getStates().get('q0')?.pending?.writeId as string;
    await engine.flush();
    // Spec-mandated: all 51 entries retained in memory (cap counts durable
    // IDB keys); the oldest entry is NOT silently evicted.
    expect(engine.getQuarantined()).toHaveLength(51);
    expect(engine.getQuarantined().some((e) => e.writeId === firstWriteId)).toBe(true);
    expect(events.map((e) => e.name)).not.toContain('quarantine_pruned');
  });

  it('emits control_epoch_blocked (not quarantine) when the drain hits CONTROL_EPOCH_STALE', async () => {
    const sendBatch = vi.fn().mockRejectedValue({ code: 'CONTROL_EPOCH_STALE' });
    const { engine, events } = createEngine({
      fetchSnapshot: vi.fn().mockResolvedValue(runningSnapshot()),
      sendBatch,
    });
    await engine.recover();
    await engine.acceptResponse('q1', payload('control-stale answer'));
    await engine.flush();
    expect(engine.getStatus()).toBe('blocked_attention');
    expect(engine.getQuarantined()).toHaveLength(0);
    expect(engine.getBlockedQuestionIds()).toContain('q1');
    const blocked = events.filter((e) => e.name === 'control_epoch_blocked');
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0]?.fields?.reason).toBe('CONTROL_EPOCH_STALE');
  });

  it('emits reconcile_failed when the reconcile snapshot cannot be fetched', async () => {
    const fetchSnapshot = vi.fn()
      .mockResolvedValueOnce(runningSnapshot())
      .mockRejectedValueOnce(new Error('offline'));
    const { engine, events } = createEngine({ fetchSnapshot });
    await engine.recover();
    await engine.acceptResponse('q1', payload('blocked answer'));
    engine.updateEpochs(1, 2);
    await expect(engine.reconcileBlocked('q1')).resolves.toBe(false);
    const failed = events.filter((e) => e.name === 'reconcile_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.fields?.reason).toBe('snapshot_fetch_failed');
    expect(engine.getBlockedCount()).toBe(1);
  });

  it('emits quarantine_failed and raises durability_fault when archive-before-delete fails', async () => {
    const { engine, events } = createEngine({
      fetchSnapshot: vi.fn().mockResolvedValue(runningSnapshot()),
    });
    await engine.recover();
    await engine.acceptResponse('q1', payload('only durable copy'));
    storage.save.mockRejectedValue(new Error('quota exceeded'));
    engine.updateEpochs(2, 1);
    await vi.waitFor(() => expect(events.map((e) => e.name)).toContain('quarantine_failed'));
    const failed = events.filter((e) => e.name === 'quarantine_failed');
    expect(failed[0]?.fields?.reason).toBe('quarantine_archive_failed');
    expect(engine.getStatus()).toBe('durability_fault');
    expect(localStorage.getItem('response-checkpoint:v2:telemetry-attempt:q1')).not.toBeNull();
  });

  it('emits version_collision when the server terminally rejects a batch version', async () => {
    const sendBatch = vi.fn().mockRejectedValue({ code: 'VERSION_COLLISION' });
    const { engine, events } = createEngine({
      fetchSnapshot: vi.fn().mockResolvedValue(runningSnapshot()),
      sendBatch,
    });
    await engine.recover();
    await engine.acceptResponse('q1', payload('colliding answer'));
    await engine.flush();
    const collisions = events.filter((e) => e.name === 'version_collision');
    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.fields?.reason).toBe('VERSION_COLLISION');
    expect(engine.getStatus()).toBe('conflict_terminal');
  });

  it('emits checkpoint_sync_failed when both sync checkpoint and IndexedDB are unavailable', async () => {
    const { engine, events } = createEngine({
      fetchSnapshot: vi.fn().mockResolvedValue([]),
    });
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    storage.save.mockRejectedValue(new Error('idb unavailable'));
    try {
      await expect(engine.acceptResponse('q7', payload('unsavable answer'))).rejects.toThrow();
    } finally {
      setItem.mockRestore();
    }
    expect(events.map((e) => e.name)).toContain('checkpoint_sync_failed');
    expect(engine.getStatus()).toBe('durability_fault');
  });

  it('never emits answer or payload content in durability event fields', async () => {
    const markerA = 'PRIVACY-PROBE-ANSWER-aa91c4';
    const markerB = 'PRIVACY-PROBE-ANSWER-bb72d8';
    const firstFetch = deferred<ResponseSnapshotV2>();
    const fetchSnapshot = vi.fn()
      .mockReturnValueOnce(firstFetch.promise)
      .mockResolvedValue(runningSnapshot({ controlEpoch: 2 }));
    const sendBatch = vi.fn().mockRejectedValue({ code: 'VERSION_COLLISION' });
    const { engine, events } = createEngine({ fetchSnapshot, sendBatch });
    const recovery = engine.recover();
    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalled());
    const acceptedA = engine.acceptResponse('q1', payload(markerA));
    firstFetch.resolve(runningSnapshot());
    await recovery;
    await acceptedA;
    await engine.acceptResponse('q2', payload(markerB));
    engine.updateEpochs(1, 2);
    await engine.reconcileBlocked('q1');
    await engine.flush();
    await vi.waitFor(() => expect(events.map((e) => e.name)).toContain('version_collision'));
    expect(events.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain(markerA);
    expect(serialised).not.toContain(markerB);
    const keys: string[] = [];
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(collect); return; }
      if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) { keys.push(k); collect(v); }
      }
    };
    events.forEach(collect);
    for (const forbidden of ['answer', 'payload', 'response', 'annotation']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('never throws when the durability event hook itself throws', async () => {
    const { engine } = createEngine({
      fetchSnapshot: vi.fn().mockResolvedValue(runningSnapshot()),
      onDurabilityEvent: () => { throw new Error('telemetry boom'); },
    });
    await engine.recover();
    await expect(engine.acceptResponse('q1', payload('hook-throws answer'))).resolves.toBeUndefined();
    engine.updateEpochs(1, 2);
    await expect(engine.reconcileBlocked('q1')).resolves.toBe(true);
  });
});
