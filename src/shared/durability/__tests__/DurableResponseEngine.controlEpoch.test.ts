/**
 * CONTROL_EPOCH_STALE self-heal (the late-join / module-start skew).
 *
 * Incident shape: a student checks in after the proctor pressed Start. The
 * check-in projects the backend clock onto the attempt and bumps its
 * control_epoch to 2; the client snapshots epoch 2; `modules/start` moves the
 * attempt to epoch 3 and returns nothing the engine reads. The first answer is
 * refused with 409 CONTROL_EPOCH_STALE {currentControlEpoch: 3,
 * requestControlEpoch: 2}. Before this heal the drafts were either re-sent
 * under epoch 2 forever (when the client could not read the code) or parked
 * as "needs re-check" with no reconcile path on the SAT surface.
 *
 * The heal re-reads the authoritative snapshot and re-issues the queued
 * drafts under the epoch it finds — ONLY when the lease is unchanged and the
 * attempt is running. A pause, a lease change, or a snapshot that does not
 * show a newer epoch keeps the blocked/reconcilable posture unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DurableResponseEngine, type TransportClient } from '../DurableResponseEngine';
import type {
  ResponseBatchRequestV2,
  ResponseBatchResponseV2,
  ResponsePayload,
  ResponseSnapshotV2,
} from '../types';

const storage = vi.hoisted(() => ({ save: vi.fn(), list: vi.fn(), clear: vi.fn() }));
vi.mock('../../../utils/durableDraftStore', () => ({
  saveDurableDraft: storage.save,
  listDurableDrafts: storage.list,
  clearDurableDraft: storage.clear,
}));

interface DurabilityEvent {
  name: string;
  fields?: Record<string, string | number | boolean | null | undefined>;
}

const engines: DurableResponseEngine[] = [];

const payload = (answer: string): ResponsePayload => ({
  answer,
  markedForReview: false,
  eliminatedOptions: [],
  annotations: [],
});

function snapshot(overrides?: Partial<ResponseSnapshotV2>): ResponseSnapshotV2 {
  return {
    attemptId: 'late-attempt',
    protocolVersion: 2,
    deliveryStatus: 'running',
    leaseEpoch: 1,
    controlEpoch: 2,
    attemptRevision: 1,
    responses: [],
    ...overrides,
  };
}

/** A server that refuses any batch whose control epoch is behind its own. */
function fencingServer(initialControlEpoch: number) {
  let controlEpoch = initialControlEpoch;
  const requests: ResponseBatchRequestV2[] = [];
  const sendBatch = vi.fn(async (_attemptId: string, request: ResponseBatchRequestV2): Promise<ResponseBatchResponseV2> => {
    requests.push(request);
    if (request.controlEpoch !== controlEpoch) {
      const error = Object.assign(new Error('Command crossed a pause/resume control boundary.'), {
        code: 'CONTROL_EPOCH_STALE',
        status: 409,
        details: { currentControlEpoch: controlEpoch, requestControlEpoch: request.controlEpoch },
      });
      throw error;
    }
    const response: ResponseBatchResponseV2 = {
      attemptRevision: 5,
      serverTime: new Date().toISOString(),
      acknowledgements: request.commands.map((command) => ({
        writeId: command.writeId,
        questionId: command.questionId,
        clientVersion: command.clientVersion,
        outcome: 'applied',
        serverRevision: 5,
        canonicalResponse: command.response,
        contentHash: `hash-${command.writeId}`,
      })),
    };
    return response;
  });
  return {
    sendBatch,
    requests,
    bumpTo(next: number) {
      controlEpoch = next;
    },
    get controlEpoch() {
      return controlEpoch;
    },
  };
}

function createEngine(transport: Partial<TransportClient>, controlEpoch = 2) {
  const events: DurabilityEvent[] = [];
  const full: TransportClient = {
    fetchSnapshot: transport.fetchSnapshot ?? vi.fn().mockResolvedValue(snapshot()),
    sendBatch: transport.sendBatch ?? vi.fn(),
    submit: transport.submit ?? vi.fn(),
  };
  const engine = new DurableResponseEngine({
    scheduleId: 'late-sched',
    attemptId: 'late-attempt',
    leaseEpoch: 1,
    controlEpoch,
    drainDebounceMs: 60_000,
    transport: full,
    onDurabilityEvent: (name, fields) => {
      events.push({ name, fields });
    },
  });
  engines.push(engine);
  return { engine, events, transport: full };
}

beforeEach(() => {
  localStorage.clear();
  storage.save.mockReset().mockResolvedValue(undefined);
  storage.list.mockReset().mockResolvedValue([]);
  storage.clear.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  engines.splice(0).forEach((engine) => engine.destroy());
  vi.restoreAllMocks();
});

describe('DurableResponseEngine × CONTROL_EPOCH_STALE', () => {
  it('heals the late-join skew: adopts the server epoch and re-sends the draft once', async () => {
    const server = fencingServer(2);
    // Recovery snapshot says epoch 2 (what the /live read and the first
    // GET /responses reported); modules/start then moved the attempt to 3.
    const fetchSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot({ controlEpoch: 2 }))
      .mockResolvedValue(snapshot({ controlEpoch: 3 }));
    const { engine, events } = createEngine({ fetchSnapshot, sendBatch: server.sendBatch });
    await engine.recover();
    server.bumpTo(3);

    await engine.acceptResponse('q1', payload('B'));
    await engine.flush();

    // One refusal under the stale epoch, then exactly one re-issue under the
    // current one — never a retry storm, never a permanently blocked draft.
    expect(server.requests.map((request) => request.controlEpoch)).toEqual([2, 3]);
    expect(server.sendBatch).toHaveBeenCalledTimes(2);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    expect(engine.getControlEpoch()).toBe(3);
    expect(engine.getStatus()).toBe('synced');
    expect(engine.getPendingCount()).toBe(0);
    expect(engine.getBlockedQuestionIds()).toEqual([]);
    expect(engine.getQuarantined()).toHaveLength(0);
    // The re-issue is a NEW write above the old one: same answer, fresh id,
    // higher version, so the server's per-write idempotency ledger is respected.
    const [stale, healed] = server.requests;
    expect(healed!.commands[0]!.writeId).not.toBe(stale!.commands[0]!.writeId);
    expect(healed!.commands[0]!.clientVersion).toBeGreaterThan(stale!.commands[0]!.clientVersion);
    expect(healed!.commands[0]!.response).toEqual(stale!.commands[0]!.response);
    const recovered = events.filter((event) => event.name === 'control_epoch_recovered');
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.fields).toMatchObject({ previousControlEpoch: 2, controlEpoch: 3, reissued: 1 });
    expect(events.map((event) => event.name)).not.toContain('control_epoch_blocked');
  });

  it('re-issues every queued draft, not only the one that was refused', async () => {
    const server = fencingServer(2);
    const fetchSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot({ controlEpoch: 2 }))
      .mockResolvedValue(snapshot({ controlEpoch: 3 }));
    const { engine } = createEngine({ fetchSnapshot, sendBatch: server.sendBatch });
    await engine.recover();
    server.bumpTo(3);

    await engine.acceptResponse('q1', payload('A'));
    await engine.acceptResponse('q2', payload('C'));
    await engine.acceptResponse('q3', payload('D'));
    await engine.flush();

    const delivered = server.requests
      .filter((request) => request.controlEpoch === 3)
      .flatMap((request) => request.commands.map((command) => command.questionId))
      .sort();
    expect(delivered).toEqual(['q1', 'q2', 'q3']);
    expect(engine.getPendingCount()).toBe(0);
    expect(engine.getStatus()).toBe('synced');
  });

  it('re-issues the newest draft when the answer changed while the refused write was in flight', async () => {
    const server = fencingServer(2);
    const fencing = server.sendBatch.getMockImplementation()!;
    let releaseFirstSend: () => void = () => undefined;
    const firstSendReleased = new Promise<void>((resolve) => {
      releaseFirstSend = resolve;
    });
    // The first envelope sits on the wire until the test releases it.
    server.sendBatch.mockImplementationOnce(async (attemptId: string, request: ResponseBatchRequestV2) => {
      await firstSendReleased;
      return fencing(attemptId, request);
    });
    const fetchSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot({ controlEpoch: 2 }))
      .mockResolvedValue(snapshot({ controlEpoch: 3 }));
    const { engine } = createEngine({ fetchSnapshot, sendBatch: server.sendBatch });
    await engine.recover();
    server.bumpTo(3);

    await engine.acceptResponse('q1', payload('A'));
    const flushing = engine.flush();
    await vi.waitFor(() => expect(server.sendBatch).toHaveBeenCalledTimes(1));
    // While 'A' is in flight under the stale epoch the student changes to 'B':
    // the outbox now holds a newer write than the one about to be refused.
    await engine.acceptResponse('q1', payload('B'));
    releaseFirstSend();
    await flushing;

    // The heal re-issues the LIVE draft ('B') and drops the refused 'A'; the
    // newer queued command must not be left behind under the old epoch as an
    // unsendable entry that keeps the engine "saving" forever.
    expect(server.requests.map((request) => request.controlEpoch)).toEqual([2, 3]);
    const healed = server.requests[1]!.commands;
    expect(healed).toHaveLength(1);
    expect(healed[0]!.response.answer).toBe('B');
    expect(engine.getPendingCount()).toBe(0);
    expect(engine.getStatus()).toBe('synced');
    expect(engine.getBlockedQuestionIds()).toEqual([]);
    expect(engine.getQuarantined()).toHaveLength(0);
  });

  it('parks the drafts as blocked, not terminal, when a healed re-send hits the writability gate', async () => {
    const server = fencingServer(2);
    const fencing = server.sendBatch.getMockImplementation()!;
    const fetchSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot({ controlEpoch: 2 }))
      .mockResolvedValue(snapshot({ controlEpoch: 3 }));
    const { engine } = createEngine({ fetchSnapshot, sendBatch: server.sendBatch });
    await engine.recover();
    // The proctor advanced the section: the epoch moved AND the runtime is
    // now between sections, so a write at the current epoch is refused by the
    // writability gate rather than the fence.
    server.bumpTo(3);
    server.sendBatch.mockImplementation(async (attemptId: string, request: ResponseBatchRequestV2) => {
      if (request.controlEpoch === 3) {
        server.requests.push(request);
        throw Object.assign(new Error('Exam runtime is waiting.'), {
          code: 'ATTEMPT_NOT_WRITABLE',
          status: 422,
        });
      }
      return fencing(attemptId, request);
    });

    await engine.acceptResponse('q1', payload('B'));
    await engine.flush();

    expect(server.requests.map((request) => request.controlEpoch)).toEqual([2, 3]);
    expect(engine.getControlEpoch()).toBe(3);
    // Kept on the device and re-checkable — the answer is never quarantined
    // and the engine never goes terminal over a gate that will reopen.
    expect(engine.getStatus()).toBe('blocked_attention');
    expect(engine.getBlockedQuestionIds()).toEqual(['q1']);
    expect(engine.getQuarantined()).toHaveLength(0);
  });

  it('keeps the draft blocked (never re-sends) when the attempt is paused', async () => {
    const server = fencingServer(2);
    const fetchSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot({ controlEpoch: 2 }))
      .mockResolvedValue(snapshot({ controlEpoch: 3, deliveryStatus: 'paused' }));
    const { engine, events } = createEngine({ fetchSnapshot, sendBatch: server.sendBatch });
    await engine.recover();
    server.bumpTo(3);

    await engine.acceptResponse('q1', payload('B'));
    await engine.flush();

    // A paused attempt is not writable: re-sending would trade a recoverable
    // block for a terminal refusal, so the existing posture stands.
    expect(server.requests.map((request) => request.controlEpoch)).toEqual([2]);
    expect(engine.getStatus()).toBe('blocked_attention');
    expect(engine.getBlockedQuestionIds()).toEqual(['q1']);
    expect(engine.getQuarantined()).toHaveLength(0);
    const failed = events.filter((event) => event.name === 'control_epoch_recovery_failed');
    expect(failed[0]?.fields?.reason).toBe('attempt_not_running');
  });

  it('never crosses a lease fence while healing a control skew', async () => {
    const server = fencingServer(2);
    const fetchSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot({ controlEpoch: 2 }))
      .mockResolvedValue(snapshot({ controlEpoch: 3, leaseEpoch: 2 }));
    const { engine, events } = createEngine({ fetchSnapshot, sendBatch: server.sendBatch });
    await engine.recover();
    server.bumpTo(3);

    await engine.acceptResponse('q1', payload('B'));
    await engine.flush();

    expect(server.requests.map((request) => request.controlEpoch)).toEqual([2]);
    expect(engine.getControlEpoch()).toBe(2);
    expect(engine.getBlockedQuestionIds()).toEqual(['q1']);
    const failed = events.filter((event) => event.name === 'control_epoch_recovery_failed');
    expect(failed[0]?.fields?.reason).toBe('lease_changed');
  });

  it('does not spin when the snapshot does not show a newer epoch', async () => {
    const sendBatch = vi.fn().mockRejectedValue(
      Object.assign(new Error('Command crossed a pause/resume control boundary.'), {
        code: 'CONTROL_EPOCH_STALE',
        status: 409,
      }),
    );
    const fetchSnapshot = vi.fn().mockResolvedValue(snapshot({ controlEpoch: 2 }));
    const { engine, events } = createEngine({ fetchSnapshot, sendBatch });
    await engine.recover();

    await engine.acceptResponse('q1', payload('B'));
    await engine.flush();

    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(engine.getStatus()).toBe('blocked_attention');
    expect(engine.getBlockedQuestionIds()).toEqual(['q1']);
    const failed = events.filter((event) => event.name === 'control_epoch_recovery_failed');
    expect(failed[0]?.fields?.reason).toBe('epoch_not_advanced');
  });

  it('bounds the heals per drain when the server keeps moving the epoch', async () => {
    const server = fencingServer(2);
    let served = 2;
    const fetchSnapshot = vi.fn().mockImplementation(async () => {
      // Every snapshot is honest about the current epoch — and the server
      // bumps again right after each one, so no re-issue can ever land.
      const view = snapshot({ controlEpoch: served });
      return view;
    });
    server.sendBatch.mockImplementation(async (_attemptId: string, request: ResponseBatchRequestV2) => {
      server.requests.push(request);
      served += 1;
      server.bumpTo(served);
      throw Object.assign(new Error('Command crossed a pause/resume control boundary.'), {
        code: 'CONTROL_EPOCH_STALE',
        status: 409,
        details: { currentControlEpoch: served, requestControlEpoch: request.controlEpoch },
      });
    });
    const { engine } = createEngine({ fetchSnapshot, sendBatch: server.sendBatch });
    await engine.recover();

    await engine.acceptResponse('q1', payload('B'));
    await engine.flush();

    // Initial send + exactly MAX_CONTROL_EPOCH_HEALS_PER_DRAIN (2) re-issues,
    // then the draft parks as blocked instead of chasing the epoch forever.
    expect(server.requests.length).toBe(3);
    expect(engine.getStatus()).toBe('blocked_attention');
    expect(engine.getBlockedQuestionIds()).toEqual(['q1']);
  });
});

describe('DurableResponseEngine × adoptControlEpochIfIdle (entry-ack adoption)', () => {
  /**
   * The entry ack carries the post-commit control epoch the server bumped in
   * the same transaction that opened the module. Adopting it while the engine
   * is idle removes the guaranteed first-batch 409 without ever blocking,
   * quarantining, or rolling back a draft — every skipped guard falls back to
   * the refuse-then-heal path this engine already owns.
   */
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  it('adopts a newer epoch while idle, so the first batch already carries it', async () => {
    const server = fencingServer(3);
    const { engine, events } = createEngine(
      {
        fetchSnapshot: vi.fn().mockResolvedValue(snapshot({ controlEpoch: 2 })),
        sendBatch: server.sendBatch,
      },
      2
    );
    await engine.recover();

    expect(engine.adoptControlEpochIfIdle(3, 'module_start')).toEqual({
      adopted: true,
      controlEpoch: 3,
    });
    expect(engine.getControlEpoch()).toBe(3);

    await engine.acceptResponse('q1', payload('B'));
    await engine.flush();

    // Exactly one send, already under the adopted fence: no 409, no heal.
    expect(server.requests.map((request) => request.controlEpoch)).toEqual([3]);
    expect(server.sendBatch).toHaveBeenCalledTimes(1);
    expect(engine.getStatus()).toBe('synced');
    expect(engine.getPendingCount()).toBe(0);
    expect(events.map((event) => event.name)).toContain('control_epoch_adopted');
    expect(events.map((event) => event.name)).not.toContain('control_epoch_blocked');
    expect(events.map((event) => event.name)).not.toContain('control_epoch_recovered');
    // Adoption moves ONLY the control fence: lease, quarantine and lifecycle
    // posture are untouched (it is not a lease takeover and not a heal).
    expect(engine.getLeaseEpoch()).toBe(1);
    expect(engine.getQuarantined()).toEqual([]);
    const adopted = events.filter((event) => event.name === 'control_epoch_adopted');
    expect(adopted[0]?.fields).toMatchObject({
      source: 'module_start',
      previousControlEpoch: 2,
      controlEpoch: 3,
    });
  });

  it('refuses to adopt while an accepted draft has no issued version yet, and never blocks it', async () => {
    // The gap `getPendingCount()` alone cannot see: the intent is in `states`
    // (already visible to the student) but its durable write has not issued,
    // so the outbox is still empty. Adopting here would block the keystroke.
    const gate = deferred<void>();
    storage.save.mockReturnValueOnce(gate.promise);
    const server = fencingServer(2);
    const fetchSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot({ controlEpoch: 2 }))
      .mockResolvedValue(snapshot({ controlEpoch: 3 }));
    const { engine, events } = createEngine({ fetchSnapshot, sendBatch: server.sendBatch }, 2);
    await engine.recover();
    // The server opened the module: epoch 3 on the wire, while the engine still
    // holds 2 because this ack was refused above.
    server.bumpTo(3);

    const acceptance = engine.acceptResponse('q1', payload('A'));
    expect(engine.getPendingCount()).toBe(0);
    expect(engine.getStates().get('q1')?.pending).toBeTruthy();

    expect(engine.adoptControlEpochIfIdle(3, 'module_start')).toEqual({
      adopted: false,
      reason: 'not_idle',
    });
    expect(engine.getControlEpoch()).toBe(2);
    expect(engine.getBlockedQuestionIds()).toEqual([]);
    expect(engine.getQuarantined()).toEqual([]);
    expect(events.filter((event) => event.name === 'control_epoch_blocked')).toEqual([]);

    gate.resolve();
    await acceptance;
    await engine.flush();
    // The draft still went out untouched — under the old epoch, which the
    // server answers with the existing refuse-then-heal path. Never blocked.
    expect(server.requests.map((request) => request.controlEpoch)).toEqual([2, 3]);
  });

  it('refuses to adopt while a draft is queued or blocked', async () => {
    const server = fencingServer(2);
    const { engine } = createEngine(
      {
        fetchSnapshot: vi.fn().mockResolvedValue(snapshot({ controlEpoch: 2 })),
        sendBatch: server.sendBatch,
      },
      2
    );
    await engine.recover();

    await engine.acceptResponse('q1', payload('B'));
    expect(engine.getPendingCount()).toBeGreaterThan(0);
    expect(engine.adoptControlEpochIfIdle(3, 'module_start')).toEqual({
      adopted: false,
      reason: 'not_idle',
    });

    // A blocked draft (which is never in the outbox) also refuses: adoption
    // must not be able to strand visible work behind a new fence.
    engine.updateEpochs(1, 4);
    expect(engine.getBlockedQuestionIds()).toEqual(['q1']);
    expect(engine.adoptControlEpochIfIdle(5, 'module_start')).toEqual({
      adopted: false,
      reason: 'not_idle',
    });
    expect(engine.getBlockedQuestionIds()).toEqual(['q1']);
    expect(engine.getQuarantined()).toEqual([]);
  });

  it('refuses an in-flight batch, then adopts after its acknowledgement clears command bookkeeping', async () => {
    const sending = deferred<void>();
    const release = deferred<void>();
    const server = fencingServer(2);
    const sendBatch = vi.fn(async (attemptId: string, request: ResponseBatchRequestV2) => {
      sending.resolve();
      await release.promise;
      return server.sendBatch(attemptId, request);
    });
    const { engine } = createEngine(
      { fetchSnapshot: vi.fn().mockResolvedValue(snapshot({ controlEpoch: 2 })), sendBatch },
      2
    );
    await engine.recover();
    await engine.acceptResponse('q1', payload('A'));

    const draining = engine.flush();
    await sending.promise;
    expect(engine.getPendingCount()).toBeGreaterThan(0);
    expect(engine.adoptControlEpochIfIdle(3, 'module_start')).toEqual({
      adopted: false,
      reason: 'not_idle',
    });
    expect(engine.getControlEpoch()).toBe(2);

    release.resolve();
    await draining;
    expect(engine.getPendingCount()).toBe(0);
    expect(engine.adoptControlEpochIfIdle(3, 'module_start')).toEqual({
      adopted: true,
      controlEpoch: 3,
    });
  });

  it('treats an equal or older epoch as a no-op (StrictMode double-invoke is idempotent)', async () => {
    const server = fencingServer(2);
    const { engine, events } = createEngine(
      {
        fetchSnapshot: vi.fn().mockResolvedValue(snapshot({ controlEpoch: 2 })),
        sendBatch: server.sendBatch,
      },
      2
    );
    await engine.recover();

    expect(engine.adoptControlEpochIfIdle(3, 'module_start')).toEqual({
      adopted: true,
      controlEpoch: 3,
    });
    // A double-invoked effect (or a retried start) must not re-adopt, re-emit,
    // or move the fence.
    expect(engine.adoptControlEpochIfIdle(3, 'module_start')).toEqual({
      adopted: false,
      reason: 'not_advanced',
    });
    expect(engine.adoptControlEpochIfIdle(2, 'module_start')).toEqual({
      adopted: false,
      reason: 'not_advanced',
    });
    expect(engine.getControlEpoch()).toBe(3);
    expect(events.filter((event) => event.name === 'control_epoch_adopted')).toHaveLength(1);
  });

  it('rejects an unusable epoch value', async () => {
    const server = fencingServer(2);
    const { engine, events } = createEngine(
      {
        fetchSnapshot: vi.fn().mockResolvedValue(snapshot({ controlEpoch: 2 })),
        sendBatch: server.sendBatch,
      },
      2
    );
    await engine.recover();

    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(engine.adoptControlEpochIfIdle(bad, 'module_start')).toEqual({
        adopted: false,
        reason: 'invalid_epoch',
      });
    }
    expect(engine.getControlEpoch()).toBe(2);
    expect(events.filter((event) => event.fields?.reason === 'invalid_epoch')).toHaveLength(5);
  });

  it('skips before the first recovery has seeded versions', async () => {
    const { engine } = createEngine({ sendBatch: vi.fn() }, 2);
    // No recover(): adopting here could mismatch a persisted draft that the
    // snapshot is about to replay.
    expect(engine.isRecoveryInitialized()).toBe(false);
    expect(engine.adoptControlEpochIfIdle(3, 'module_start')).toEqual({
      adopted: false,
      reason: 'recovery_pending',
    });
    expect(engine.getControlEpoch()).toBe(2);
  });

  it('skips on a destroyed engine', async () => {
    const server = fencingServer(2);
    const { engine } = createEngine(
      {
        fetchSnapshot: vi.fn().mockResolvedValue(snapshot({ controlEpoch: 2 })),
        sendBatch: server.sendBatch,
      },
      2
    );
    await engine.recover();
    engine.destroy();

    expect(engine.adoptControlEpochIfIdle(3, 'module_start')).toEqual({
      adopted: false,
      reason: 'engine_not_writable',
    });
    expect(engine.getControlEpoch()).toBe(2);
  });

  it('never adopts over a fenced conflict posture', async () => {
    const { engine, events } = createEngine(
      {
        fetchSnapshot: vi.fn().mockResolvedValue(snapshot({ controlEpoch: 2 })),
        sendBatch: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error('Fenced by newer session'), {
              code: 'LEASE_FENCED',
              status: 409,
            })
          ),
      },
      2
    );
    await engine.recover();
    await engine.acceptResponse('q1', payload('B'));
    await engine.flush();
    expect(engine.getStatus()).toBe('conflict_fenced');

    expect(engine.adoptControlEpochIfIdle(3, 'module_start')).toEqual({
      adopted: false,
      reason: 'conflict_fenced',
    });
    expect(engine.getControlEpoch()).toBe(2);
    expect(events.find((event) => event.fields?.reason === 'conflict_fenced')?.name).toBe(
      'control_epoch_adopt_skipped'
    );
  });

  it('skips once the attempt is terminal, and while a submit is in flight', async () => {
    const receipt = {
      attemptId: 'late-attempt',
      submissionId: 'sub-1',
      status: 'submitted',
      attemptRevision: 2,
      finalResponseDigest: 'digest',
      submittedAt: new Date().toISOString(),
      acknowledgements: [],
    };
    const server = fencingServer(2);
    const recovery = vi.fn().mockResolvedValue(snapshot({ controlEpoch: 2 }));

    // (a) terminal: the receipt landed, the attempt can no longer be written.
    const { engine: terminalEngine } = createEngine(
      { fetchSnapshot: recovery, sendBatch: server.sendBatch, submit: vi.fn().mockResolvedValue(receipt) },
      2
    );
    await terminalEngine.recover();
    await terminalEngine.submit('sub-1', 0);
    expect(terminalEngine.adoptControlEpochIfIdle(3, 'module_start')).toEqual({
      adopted: false,
      reason: 'engine_not_writable',
    });

    // (b) submitting: a receipt is outstanding, so nothing may change fence.
    const gate = deferred<typeof receipt>();
    const { engine: submittingEngine } = createEngine(
      { fetchSnapshot: recovery, sendBatch: server.sendBatch, submit: vi.fn().mockReturnValue(gate.promise) },
      2
    );
    await submittingEngine.recover();
    const inFlight = submittingEngine.submit('sub-2', 0);
    expect(submittingEngine.adoptControlEpochIfIdle(3, 'module_start')).toEqual({
      adopted: false,
      reason: 'engine_not_writable',
    });
    gate.resolve(receipt);
    await inFlight.catch(() => undefined);
    expect(submittingEngine.getControlEpoch()).toBe(2);
  });

  it('skips while the engine cannot trust its own storage', async () => {
    const server = fencingServer(2);
    const { engine } = createEngine(
      {
        fetchSnapshot: vi.fn().mockResolvedValue(snapshot({ controlEpoch: 2 })),
        sendBatch: server.sendBatch,
      },
      2
    );
    await engine.recover();
    await engine.acceptResponse('q1', payload('A'));
    // A lease fence quarantines the draft; with the archive write failing the
    // engine keeps the source and fails closed instead of losing the last copy.
    storage.save.mockRejectedValue(new Error('quota exceeded'));
    engine.updateEpochs(2, 2);
    await vi.waitFor(() => expect(engine.getStatus()).toBe('durability_fault'));

    expect(engine.adoptControlEpochIfIdle(3, 'module_start')).toEqual({
      adopted: false,
      reason: 'durability_fault',
    });
    expect(engine.getControlEpoch()).toBe(2);
  });

  it('keeps the proctor-pause refusal authoritative for a draft sent under an adopted epoch', async () => {
    // The composition the plan asked for: enter the module (adopt), answer, and
    // then have the proctor pause. The adopted epoch is what the batch carries,
    // so the refusal comes from the writability gate — and the heal must still
    // refuse to re-send, leaving the recoverable blocked posture in place.
    const server = fencingServer(3);
    const fetchSnapshot = vi
      .fn()
      .mockResolvedValueOnce(snapshot({ controlEpoch: 2 }))
      .mockResolvedValue(snapshot({ controlEpoch: 4, deliveryStatus: 'paused' }));
    const { engine, events } = createEngine({ fetchSnapshot, sendBatch: server.sendBatch }, 2);
    await engine.recover();
    expect(engine.adoptControlEpochIfIdle(3, 'module_start')).toEqual({
      adopted: true,
      controlEpoch: 3,
    });

    // Proctor pause right after entry: the epoch moves again under the client.
    server.bumpTo(4);
    await engine.acceptResponse('q1', payload('B'));
    await engine.flush();

    expect(server.requests.map((request) => request.controlEpoch)).toEqual([3]);
    expect(engine.getStatus()).toBe('blocked_attention');
    expect(engine.getBlockedQuestionIds()).toEqual(['q1']);
    expect(engine.getQuarantined()).toEqual([]);
    const failed = events.filter((event) => event.name === 'control_epoch_recovery_failed');
    expect(failed[0]?.fields?.reason).toBe('attempt_not_running');
  });
});
