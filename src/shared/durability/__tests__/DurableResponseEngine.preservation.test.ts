/** Student answer preservation (repair verification, WP0/WP8).
 *
 * Inverted from the audit witnesses: these assert the SAFE repaired behavior.
 * Failing here means a silent-loss path regressed — treat as BLOCKING.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chunkResponseCommands,
  DurableResponseEngine,
  MAX_BATCH_BODY_BYTES,
  MAX_BATCH_COMMANDS,
  type TransportClient,
} from '../DurableResponseEngine';
import {
  getVisibleResponse,
  type DurabilitySyncStatus,
  type PendingResponseState,
  type ResponseCommandV2,
  type ResponsePayload,
  type ResponseSnapshotV2,
} from '../types';

const storage = vi.hoisted(() => ({ save: vi.fn(), list: vi.fn(), clear: vi.fn() }));
vi.mock('../../../utils/durableDraftStore', () => ({
  saveDurableDraft: storage.save, listDurableDrafts: storage.list, clearDurableDraft: storage.clear,
}));
const payload = (answer: string, markedForReview = false): ResponsePayload => ({ answer, markedForReview, annotations: [], eliminatedOptions: [] });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const engines: DurableResponseEngine[] = [];
function setup(
  snapshot: TransportClient['fetchSnapshot'],
  onStatusChange?: (status: DurabilitySyncStatus, error?: string | null) => void,
) {
  const transport: TransportClient = { fetchSnapshot: snapshot, sendBatch: vi.fn(), submit: vi.fn() };
  const engine = new DurableResponseEngine({ scheduleId: 'audit-s', attemptId: 'audit-a', leaseEpoch: 1, controlEpoch: 1, drainDebounceMs: 60_000, transport, onStatusChange });
  engines.push(engine); return { engine, transport };
}
/** Snapshot with nothing server-side: recovery has no authoritative response to seed from. */
function emptySnapshot(): ResponseSnapshotV2 {
  return { attemptId: 'audit-a', protocolVersion: 2, deliveryStatus: 'running', leaseEpoch: 1, controlEpoch: 1, attemptRevision: 8, responses: [] };
}
/** Resolving sendBatch stub: echoes valid acknowledgements for every command. */
function echoBatches(transport: TransportClient, serverRevision = 1): void {
  (transport.sendBatch as ReturnType<typeof vi.fn>).mockImplementation(
    async (_attemptId: string, req: { commands: Array<{ writeId: string; questionId: string; clientVersion: number; response: ResponsePayload }> }) => ({
      attemptRevision: serverRevision,
      serverTime: new Date().toISOString(),
      acknowledgements: req.commands.map((command) => ({
        writeId: command.writeId,
        questionId: command.questionId,
        clientVersion: command.clientVersion,
        outcome: 'applied' as const,
        serverRevision,
        canonicalResponse: command.response,
        contentHash: `hash-${serverRevision}`,
      })),
    }),
  );
}

function snapshot(answer = 'server-old', version = 8): ResponseSnapshotV2 {
  return { attemptId: 'audit-a', protocolVersion: 2, deliveryStatus: 'running', leaseEpoch: 1, controlEpoch: 1, attemptRevision: 8,
    responses: [{ questionId: 'q1', writeId: 'server-write', clientVersion: version, serverRevision: 8, outcome: 'applied', contentHash: 'hash', canonicalResponse: payload(answer) }] };
}
beforeEach(() => { localStorage.clear(); storage.save.mockReset().mockResolvedValue(undefined); storage.list.mockReset().mockResolvedValue([]); storage.clear.mockReset().mockResolvedValue(undefined); });
afterEach(() => { engines.splice(0).forEach(e => e.destroy()); vi.restoreAllMocks(); });

describe('student answer preservation (repair verification)', () => {
  it('I1: recovery keeps a newly typed answer and flag over an older local draft', async () => {
    const old: PendingResponseState = { payload: payload('old draft'), writeId: 'old-draft', leaseEpoch: 1, controlEpoch: 1, clientVersion: 20, durability: 'checkpoint' };
    localStorage.setItem('response-checkpoint:v2:audit-a:q1', JSON.stringify(old));
    const network = deferred<ResponseSnapshotV2>();
    const fetch = vi.fn().mockReturnValue(network.promise);
    const { engine } = setup(fetch);
    const recovery = engine.recover();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const accepted = engine.acceptResponse('q1', payload('newly typed', true));
    expect(getVisibleResponse(engine.getStates().get('q1'))).toEqual(payload('newly typed', true));
    network.resolve(snapshot()); await recovery; await accepted;
    // Live input wins; recovery seeds ordering but never regresses visible work.
    expect(getVisibleResponse(engine.getStates().get('q1'))).toEqual(payload('newly typed', true));
    expect(engine.isRecoveryInitialized()).toBe(true);
  });

  it('I3: input during recovery is versioned only after seeding — never with an uninitialized version', async () => {
    const network = deferred<ResponseSnapshotV2>();
    const fetch = vi.fn().mockReturnValue(network.promise);
    const { engine, transport } = setup(fetch);
    const recovery = engine.recover();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const accepted = engine.acceptResponse('q1', payload('new answer', true));
    // Provisional: visible immediately, but no version issued pre-recovery.
    expect(getVisibleResponse(engine.getStates().get('q1'))).toEqual(payload('new answer', true));
    expect(engine.getStates().get('q1')?.pending?.clientVersion).toBe(0);
    network.resolve(snapshot('previous answer', 1)); await recovery; await accepted;
    // Post-seeding the version is seeded above the server floor (1) — no
    // uninitialized version 1 is ever sent, so no VERSION_COLLISION rollback.
    const sent = (transport.sendBatch as ReturnType<typeof vi.fn>).mock.calls
      .flatMap((call) => (call[1] as { commands: Array<{ clientVersion: number }> }).commands);
    for (const command of sent) {
      expect(command.clientVersion).toBeGreaterThan(1);
    }
    expect(getVisibleResponse(engine.getStates().get('q1'))).toEqual(payload('new answer', true));
  });

  it('I3-W1: input during recovery flushes a non-empty batch with seeded versions only — never provisional 0', async () => {
    // W1 pin: the I3 test above never flushes (sendBatch stub never resolves
    // and the 60s debounce never fires), so its every-command version loop is
    // vacuous over zero calls. This pin flushes through a RESOLVING batch
    // mock and asserts the batch is non-empty with every version seeded above
    // the server floor — a stale-empty or provisional-0 send regresses here.
    const network = deferred<ResponseSnapshotV2>();
    const fetch = vi.fn().mockReturnValue(network.promise);
    const { engine, transport } = setup(fetch);
    (transport.sendBatch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_attemptId: string, req: { commands: Array<{ writeId: string; questionId: string; clientVersion: number; response: ResponsePayload }> }) => ({
        attemptRevision: 8,
        serverTime: new Date().toISOString(),
        acknowledgements: req.commands.map((command) => ({
          writeId: command.writeId,
          questionId: command.questionId,
          clientVersion: command.clientVersion,
          outcome: 'applied' as const,
          serverRevision: 8,
          canonicalResponse: command.response,
          contentHash: 'hash-live',
        })),
      }),
    );
    const recovery = engine.recover();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const accepted = engine.acceptResponse('q1', payload('new answer', true));
    expect(engine.getStates().get('q1')?.pending?.clientVersion).toBe(0);
    network.resolve(snapshot('previous answer', 1)); await recovery; await accepted;
    await engine.flush();
    const sendMock = transport.sendBatch as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalled();
    const sent = sendMock.mock.calls.flatMap(
      (call) => (call[1] as { commands: Array<{ clientVersion: number }> }).commands,
    );
    // Non-empty: the resolving flush must carry the write; every version is
    // seeded above the server floor (1) — a provisional 0 never flies.
    expect(sent.length).toBeGreaterThan(0);
    for (const command of sent) {
      expect(command.clientVersion).toBeGreaterThan(1);
      expect(command.clientVersion).not.toBe(0);
    }
    expect(getVisibleResponse(engine.getStates().get('q1'))).toEqual(payload('new answer', true));
  });

  it('I4: a control-only bump keeps unsent work visible as blocked, never silently dropped', async () => {
    const { engine } = setup(vi.fn().mockResolvedValue(snapshot()));
    await engine.recover();
    await engine.acceptResponse('q1', payload('new answer', true));
    engine.updateEpochs(1, 2);
    expect(getVisibleResponse(engine.getStates().get('q1'))).toEqual(payload('new answer', true));
    expect(engine.getBlockedQuestionIds()).toContain('q1');
    expect(engine.getBlockedCount()).toBe(1);
    expect(engine.getStatus()).toBe('blocked_attention');
    expect(engine.getQuarantined()).toHaveLength(0);
    // Blocked drafts are never sent without reconcile/discard.
    await engine.flush();
    expect(engine.getStates().get('q1')?.pending?.blocked?.reason).toBe('EPOCH_STALE');
    // Reconcile re-issues under the new epoch and clears the block.
    const reconciled = await engine.reconcileBlocked('q1');
    expect(reconciled).toBe(true);
    expect(engine.getBlockedCount()).toBe(0);
  });

  it('I2: a slow IndexedDB write never delays the latest intent checkpoint before teardown', async () => {
    const slowWrite = deferred<void>();
    storage.save.mockReturnValue(slowWrite.promise);
    const { engine } = setup(vi.fn().mockResolvedValue([]));
    const first = engine.acceptResponse('q1', payload('first keystroke'));
    const second = engine.acceptResponse('q1', payload('latest typing', true));
    // Latest intent is checkpointed synchronously, ahead of async storage.
    expect(getVisibleResponse(engine.getStates().get('q1'))).toEqual(payload('latest typing', true));
    expect(JSON.parse(localStorage.getItem('response-checkpoint:v2:audit-a:q1')!).payload).toEqual(payload('latest typing', true));
    engine.destroy();
    slowWrite.resolve(); await Promise.all([first, second]);
    expect(JSON.parse(localStorage.getItem('response-checkpoint:v2:audit-a:q1')!).payload).toEqual(payload('latest typing', true));
  });

  it('RISK-26: offline recovery seeds the version floor from the recovered draft, so the next edit never re-mints a consumed version', async () => {
    // Consumer-ledger state: q1 already consumed versions 1..3 under this
    // lease, and the device holds an unsent v3 draft. The reload happens with
    // NO network, so no snapshot can seed the version trackers.
    const recoveredDraft: PendingResponseState = {
      payload: payload('unsent v3'),
      writeId: 'w-3',
      leaseEpoch: 1,
      controlEpoch: 1,
      clientVersion: 3,
      durability: 'checkpoint',
      receivedAt: new Date().toISOString(),
      order: 3,
    };
    localStorage.setItem('response-checkpoint:v2:audit-a:q1', JSON.stringify(recoveredDraft));
    const { engine, transport } = setup(vi.fn().mockRejectedValue(new Error('offline')));
    await engine.recover();
    // The student keeps answering the same question after the offline reload.
    await engine.acceptResponse('q1', payload('the next keystroke'));
    (transport.sendBatch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_attemptId: string, req: { commands: Array<{ writeId: string; questionId: string; clientVersion: number; response: ResponsePayload }> }) => ({
        attemptRevision: 8,
        serverTime: new Date().toISOString(),
        acknowledgements: req.commands.map((command) => ({
          writeId: command.writeId,
          questionId: command.questionId,
          clientVersion: command.clientVersion,
          outcome: 'applied' as const,
          serverRevision: 8,
          canonicalResponse: command.response,
          contentHash: 'hash-risk26',
        })),
      }),
    );
    await engine.flush();
    const sent = (transport.sendBatch as ReturnType<typeof vi.fn>).mock.calls.flatMap(
      (call) => (call[1] as { commands: Array<{ clientVersion: number }> }).commands,
    );
    expect(sent.length).toBeGreaterThan(0);
    // The mint must sit ABOVE the recovered version. Without the recovery-time
    // seed this is v1 — a version the server already used under this lease,
    // which the exact-match collision probe terminally quarantines.
    for (const command of sent) {
      expect(command.clientVersion).toBeGreaterThan(3);
      expect(command.clientVersion).not.toBe(1);
    }
    expect(engine.getStatus()).not.toBe('conflict_terminal');
  });

  it('Bug 1: a version-zero checkpoint survives immediate teardown and recovery mints a sendable version', async () => {
    const { engine: first } = setup(vi.fn().mockResolvedValue([]));
    const accepted = first.acceptResponse('q1', payload('latest typed answer'));
    // The teardown-safe checkpoint lands BEFORE version allocation finishes.
    const stored = JSON.parse(localStorage.getItem('response-checkpoint:v2:audit-a:q1')!) as PendingResponseState;
    expect(stored.clientVersion).toBe(0);
    first.destroy();
    await accepted;

    const { engine: second, transport } = setup(vi.fn().mockResolvedValue([]));
    echoBatches(transport);
    await second.recover();
    const recovered = second.getStates().get('q1')?.pending;
    expect(getVisibleResponse(second.getStates().get('q1'))).toEqual(payload('latest typed answer'));
    expect(recovered?.clientVersion).toBeGreaterThan(0);
    // The durable copy is refreshed with the minted version, so the next
    // reload recovers a sendable write instead of another raw zero.
    const refreshed = JSON.parse(localStorage.getItem('response-checkpoint:v2:audit-a:q1')!) as PendingResponseState;
    expect(refreshed.clientVersion).toBe(recovered?.clientVersion);
    await second.flush();
    const sent = (transport.sendBatch as ReturnType<typeof vi.fn>).mock.calls.flatMap(
      (call) => (call[1] as { commands: Array<{ clientVersion: number }> }).commands,
    );
    expect(sent.length).toBeGreaterThan(0);
    for (const command of sent) expect(command.clientVersion).toBeGreaterThan(0);
  });

  it('Bug 1: typing during a held initial snapshot is recovered by a fresh engine after teardown', async () => {
    const network = deferred<ResponseSnapshotV2>();
    const { engine: first } = setup(vi.fn().mockReturnValue(network.promise));
    const recovery = first.recover();
    const accepted = first.acceptResponse('q1', payload('typed during recovery'));
    expect(first.getStates().get('q1')?.pending?.clientVersion).toBe(0);
    // Teardown while the durable copy exists but version initialization has
    // not run: this is the window the old reader silently dropped.
    first.destroy();
    network.resolve([]);
    await recovery; await accepted;

    const { engine: second } = setup(vi.fn().mockResolvedValue([]));
    await second.recover();
    expect(getVisibleResponse(second.getStates().get('q1'))).toEqual(payload('typed during recovery'));
  });

  it('Bug 1: a newer server snapshot version never rolls back a recovered local intent', async () => {
    const network = deferred<ResponseSnapshotV2>();
    const { engine: first } = setup(vi.fn().mockReturnValue(network.promise));
    const recovery = first.recover();
    const accepted = first.acceptResponse('q1', payload('student latest'));
    first.destroy();
    network.resolve(snapshot('server old', 9));
    await recovery; await accepted;

    const { engine: second } = setup(vi.fn().mockResolvedValue(snapshot('server old', 9)));
    await second.recover();
    expect(getVisibleResponse(second.getStates().get('q1'))).toEqual(payload('student latest'));
    // The mint sits above the refreshed server floor — never compared as zero.
    expect(second.getStates().get('q1')?.pending?.clientVersion).toBeGreaterThan(9);
    expect(second.getQuarantined()).toHaveLength(0);
  });

  it('Bug 1: a control-epoch refresh keeps the recovered intent visible, reconcilable and sendable', async () => {
    const { engine: first } = setup(vi.fn().mockResolvedValue([]));
    const accepted = first.acceptResponse('q1', payload('typed before the timing bump'));
    first.destroy();
    await accepted;

    // Provider-equivalent replacement: a fresh engine built on the newer
    // control epoch that a proctor warning increments.
    const bumped = { ...snapshot('server old', 9), controlEpoch: 2 };
    const { engine: second, transport } = setup(vi.fn().mockResolvedValue(bumped));
    echoBatches(transport, 9);
    await second.recover();
    // Never a silent fallback to the older server answer.
    expect(getVisibleResponse(second.getStates().get('q1'))).toEqual(payload('typed before the timing bump'));
    expect(second.getBlockedQuestionIds()).toContain('q1');
    expect(second.getQuarantined()).toHaveLength(0);
    // Fenced drafts need an explicit decision: flush sends nothing.
    await second.flush();
    expect(transport.sendBatch).not.toHaveBeenCalled();
    // Reconcile re-issues the preserved intent above the server floor.
    expect(await second.reconcileBlocked('q1')).toBe(true);
    await second.flush();
    const sent = (transport.sendBatch as ReturnType<typeof vi.fn>).mock.calls.flatMap(
      (call) => (call[1] as { commands: Array<{ clientVersion: number }> }).commands,
    );
    expect(sent.length).toBeGreaterThan(0);
    for (const command of sent) expect(command.clientVersion).toBeGreaterThan(9);
  });

  it('Bug 1: a recovered intent from an older lease is fenced, never auto-issued under the new lease', async () => {
    const { engine: first } = setup(vi.fn().mockResolvedValue([]));
    const accepted = first.acceptResponse('q1', payload('pre-takeover typing'));
    first.destroy();
    await accepted;

    const takeover = { ...snapshot('server old', 9), leaseEpoch: 2 };
    const { engine: second, transport } = setup(vi.fn().mockResolvedValue(takeover));
    echoBatches(transport, 9);
    await second.recover();
    expect(second.getLeaseEpoch()).toBe(2);
    expect(second.getQuarantined().map((entry) => entry.reason)).toContain('EPOCH_STALE');
    await second.flush();
    expect(transport.sendBatch).not.toHaveBeenCalled();
  });

  it('N1: a submit-time response-revision race refreshes and retries instead of terminally fencing the attempt', async () => {
    const revisionRace = Object.assign(
      new Error('Response revision changed; refresh before submitting.'),
      { code: 'VERSION_COLLISION', status: 409, details: { expected: 8, current: 9 } },
    );
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(snapshot('server-old', 8))
      .mockResolvedValueOnce({ ...snapshot('server-old', 8), attemptRevision: 9 });
    const { engine, transport } = setup(fetch);
    const submitMock = transport.submit as ReturnType<typeof vi.fn>;
    submitMock
      .mockRejectedValueOnce(revisionRace)
      .mockResolvedValueOnce({
        attemptId: 'audit-a',
        submissionId: 'sub-1',
        status: 'submitted',
        attemptRevision: 9,
        finalResponseDigest: 'digest',
        submittedAt: new Date().toISOString(),
        acknowledgements: [],
      });
    (transport.sendBatch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_attemptId: string, req: { commands: Array<{ writeId: string; questionId: string; clientVersion: number; response: ResponsePayload }> }) => ({
        attemptRevision: 8,
        serverTime: new Date().toISOString(),
        acknowledgements: req.commands.map((command) => ({
          writeId: command.writeId,
          questionId: command.questionId,
          clientVersion: command.clientVersion,
          outcome: 'applied' as const,
          serverRevision: 8,
          canonicalResponse: command.response,
          contentHash: 'hash-n1',
        })),
      }),
    );
    await engine.recover();
    await engine.acceptResponse('q1', payload('final answer'));
    await engine.flush();

    await expect(engine.submit('sub-1', engine.getAttemptRevision())).resolves.toMatchObject({
      attemptRevision: 9,
    });
    // One refresh + one resubmit — never a terminal fence, never quarantine.
    expect(submitMock).toHaveBeenCalledTimes(2);
    expect(engine.getStatus()).not.toBe('conflict_terminal');
    expect(engine.getQuarantined()).toHaveLength(0);
  });

  it('N1b: a per-question submit collision (questionId in details) stays terminal', async () => {
    const questionCollision = Object.assign(
      new Error('Client version already used by another write.'),
      {
        code: 'VERSION_COLLISION',
        status: 409,
        details: { questionId: 'q1', clientVersion: 2, existingWriteId: 'w-other' },
      },
    );
    const { engine, transport } = setup(vi.fn().mockResolvedValue(snapshot('server-old', 1)));
    const submitMock = transport.submit as ReturnType<typeof vi.fn>;
    submitMock.mockRejectedValue(questionCollision);
    (transport.sendBatch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_attemptId: string, req: { commands: Array<{ writeId: string; questionId: string; clientVersion: number; response: ResponsePayload }> }) => ({
        attemptRevision: 3,
        serverTime: new Date().toISOString(),
        acknowledgements: req.commands.map((command) => ({
          writeId: command.writeId,
          questionId: command.questionId,
          clientVersion: command.clientVersion,
          outcome: 'applied' as const,
          serverRevision: 3,
          canonicalResponse: command.response,
          contentHash: 'hash-n1b',
        })),
      }),
    );
    await engine.recover();
    await engine.acceptResponse('q1', payload('final answer'));
    await engine.flush();

    await expect(engine.submit('sub-1', engine.getAttemptRevision())).rejects.toThrow();
    expect(submitMock).toHaveBeenCalledTimes(1);
    expect(engine.getStatus()).toBe('conflict_terminal');
  });

  it('Bug 5: accepting intent never leaves a server-saved claim standing while it awaits its version', async () => {
    const network = deferred<ResponseSnapshotV2>();
    const fetch = vi.fn().mockReturnValue(network.promise);
    const seen: string[] = [];
    const { engine, transport } = setup(fetch, (status) => seen.push(status));
    const recovery = engine.recover();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());

    const accepted = engine.acceptResponse('q1', payload('new not acknowledged'));
    // Synchronously: the intent is visible and durable on THIS device, has no
    // version and no outbox entry yet — so it is not server-saved.
    expect(getVisibleResponse(engine.getStates().get('q1'))).toEqual(payload('new not acknowledged'));
    expect(engine.getStates().get('q1')?.pending?.clientVersion).toBe(0);
    expect(engine.getStatus()).not.toBe('synced');
    expect(engine.getStatus()).toBe('saved_locally');
    expect(seen).not.toContain('synced');
    expect(
      JSON.parse(localStorage.getItem('response-checkpoint:v2:audit-a:q1')!).payload.answer,
    ).toBe('new not acknowledged');

    // The matching acknowledgement is the only thing that may restore the
    // server-saved truth — and it does, so the state is never sticky.
    echoBatches(transport);
    network.resolve(emptySnapshot());
    await recovery; await accepted; await engine.flush();
    expect(engine.getStatus()).toBe('synced');
    expect(getVisibleResponse(engine.getStates().get('q1'))).toEqual(payload('new not acknowledged'));
  });

  it('Bug 5: a drained queue with an unacknowledged intent outside it is never reported server-saved', async () => {
    // q1's durable write is slow, so its intent is still provisional and NOT in
    // the outbox; q2 is a normal sendable write in the same drain.
    const slow = deferred<void>();
    storage.save.mockImplementation((key: string) =>
      String(key).includes('q1') ? slow.promise : Promise.resolve(undefined),
    );
    const transport: TransportClient = { fetchSnapshot: vi.fn().mockResolvedValue(emptySnapshot()), sendBatch: vi.fn(), submit: vi.fn() };
    const engine = new DurableResponseEngine({ scheduleId: 'audit-s', attemptId: 'audit-a', leaseEpoch: 1, controlEpoch: 1, drainDebounceMs: 60_000, transport });
    engines.push(engine);
    echoBatches(transport);
    await engine.recover();

    const stalled = engine.acceptResponse('q1', payload('still provisional'));
    const sendable = engine.acceptResponse('q2', payload('sendable answer'));
    // q2 is issued and queued; q1 is still provisional and outside the queue.
    await vi.waitFor(() => expect(engine.getPendingCount()).toBe(1));
    // Driven directly (the engine's own drain is debounced 60s): a flush barrier
    // legitimately waits for the stalled intent, which would hide this drain.
    await (engine as unknown as { drainOutbox: () => Promise<void> }).drainOutbox();
    // Queue length alone says "nothing pending" (q2 was delivered and acked) —
    // the intent ledger says otherwise, so the drain must not claim saved.
    expect(transport.sendBatch).toHaveBeenCalled();
    expect(engine.getPendingCount()).toBe(0);
    expect(getVisibleResponse(engine.getStates().get('q1'))).toEqual(payload('still provisional'));
    expect(engine.getStatus()).not.toBe('synced');
    expect(engine.getStatus()).toBe('saved_locally');

    // The provisional write lands, is acknowledged, and only then is the
    // server-saved truth restored.
    slow.resolve();
    await stalled; await sendable;
    await engine.flush();
    expect(engine.getStatus()).toBe('synced');
  });

  it('Bug 5: a recovered unacknowledged draft is never reported server-saved', async () => {
    // Consumer ledger: the device holds an unsent draft from the last session
    // and the drain is debounced, so nothing has acknowledged it yet.
    const recoveredDraft: PendingResponseState = {
      payload: payload('last session typing'),
      writeId: 'w-9',
      leaseEpoch: 1,
      controlEpoch: 1,
      clientVersion: 9,
      durability: 'checkpoint',
      receivedAt: new Date().toISOString(),
      order: 9,
    };
    localStorage.setItem('response-checkpoint:v2:audit-a:q1', JSON.stringify(recoveredDraft));
    const { engine, transport } = setup(vi.fn().mockResolvedValue(emptySnapshot()));
    await engine.recover();
    expect(getVisibleResponse(engine.getStates().get('q1'))).toEqual(payload('last session typing'));
    expect(engine.getPendingCount()).toBe(1);
    expect(engine.getStatus()).not.toBe('synced');
    expect(engine.getStatus()).toBe('saved_locally');

    echoBatches(transport, 9);
    await engine.flush();
    expect(engine.getStatus()).toBe('synced');
    expect(engine.getStates().get('q1')?.pending ?? null).toBeNull();
  });

  it('I5: quarantine archives before deleting — archive failure retains the source and raises a fault', async () => {
    const { engine } = setup(vi.fn().mockResolvedValue(snapshot()));
    await engine.recover(); await engine.acceptResponse('q1', payload('only durable copy'));
    expect(localStorage.getItem('response-checkpoint:v2:audit-a:q1')).not.toBeNull();
    storage.save.mockRejectedValue(new Error('quota exceeded'));
    // Drive quarantine through the real lease-fence path so the archived
    // command matches the live pending write (stale commands are skipped).
    engine.updateEpochs(2, 1);
    await vi.waitFor(() => expect(engine.getStatus()).toBe('durability_fault'));
    // Source checkpoint retained: the last durable copy is not deleted.
    expect(localStorage.getItem('response-checkpoint:v2:audit-a:q1')).not.toBeNull();
  });
});

describe('reconnect batch chunking (Bug 6 preservation)', () => {
  const command = (index: number, answer = 'answer'): ResponseCommandV2 => ({
    writeId: `w-${index}`,
    questionId: `q${index}`,
    clientVersion: 1,
    response: payload(answer),
  });
  /** Independent envelope-size oracle: what actually goes on the wire. */
  const envelopeBytes = (chunk: ResponseCommandV2[]): number =>
    JSON.stringify({ leaseEpoch: 1, controlEpoch: 1, commands: chunk }).length;
  const counts = (total: number): number[] =>
    chunkResponseCommands(Array.from({ length: total }, (_, index) => command(index))).map(
      (chunk) => chunk.length,
    );

  it('splits at the server command cap for 99, 100 and 101 commands', () => {
    // The server's own envelope limit (attempts/validate.go) is independent of
    // this client budget — pin both sides of the boundary.
    expect(MAX_BATCH_COMMANDS).toBe(100);
    expect(counts(99)).toEqual([99]);
    expect(counts(100)).toEqual([100]);
    expect(counts(101)).toEqual([100, 1]);
  });

  it('splits just below / at / above the encoded body budget, preserving order and identity', () => {
    const commands = Array.from({ length: 12 }, (_, index) => command(index, 'x'.repeat(20_000)));
    const chunks = chunkResponseCommands(commands);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_BATCH_COMMANDS);
      expect(envelopeBytes(chunk)).toBeLessThanOrEqual(MAX_BATCH_BODY_BYTES);
    }
    // Chunking reorders nothing and re-mints nothing: same writable identity,
    // same order, so acknowledgements still match one-for-one.
    expect(chunks.flat().map((entry) => entry.writeId)).toEqual(commands.map((entry) => entry.writeId));
    expect(chunks.flat().map((entry) => entry.questionId)).toEqual(commands.map((entry) => entry.questionId));
    // ...and the client budget stays under the server's 256 KiB body cap.
    expect(MAX_BATCH_BODY_BYTES).toBeLessThan(256 << 10);
  });

  it('sends one over-budget command alone instead of stranding its neighbors', () => {
    const oversized = command(0, 'x'.repeat(MAX_BATCH_BODY_BYTES + 4_096));
    const chunks = chunkResponseCommands([oversized, command(1), command(2)]);
    expect(chunks.map((chunk) => chunk.map((entry) => entry.writeId))).toEqual([
      ['w-0'],
      ['w-1', 'w-2'],
    ]);
  });

  it('quarantines only the rejected envelope so valid neighbors still deliver', async () => {
    // The offending answer is itself over the byte budget, so it travels in an
    // envelope of its own: the bound is "one bad command costs at most its own
    // envelope", never the whole backlog.
    const oversizedAnswer = 'x'.repeat(200_000);
    const batches: string[][] = [];
    const transport: TransportClient = { fetchSnapshot: vi.fn().mockResolvedValue(emptySnapshot()), sendBatch: vi.fn(), submit: vi.fn() };
    const engine = new DurableResponseEngine({ scheduleId: 'audit-s', attemptId: 'audit-a', leaseEpoch: 1, controlEpoch: 1, transport });
    engines.push(engine);
    (transport.sendBatch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_attemptId: string, req: { commands: Array<{ writeId: string; questionId: string; clientVersion: number; response: ResponsePayload }> }) => {
        batches.push(req.commands.map((entry) => entry.questionId));
        if (req.commands.some((entry) => entry.questionId === 'q1')) {
          // Server-side validation of ONE payload: terminal for that write, not
          // for the session (shared error map: kind 'validation').
          throw Object.assign(new Error('Invalid response payload.'), { code: 'INVALID_RESPONSE' });
        }
        return {
          attemptRevision: 8,
          serverTime: new Date().toISOString(),
          acknowledgements: req.commands.map((entry) => ({
            writeId: entry.writeId,
            questionId: entry.questionId,
            clientVersion: entry.clientVersion,
            outcome: 'applied' as const,
            serverRevision: 8,
            canonicalResponse: entry.response,
            contentHash: 'hash-isolation',
          })),
        };
      },
    );
    await engine.recover();
    await engine.acceptResponse('q1', payload(oversizedAnswer));
    await engine.acceptResponse('q2', payload('valid two'));
    await engine.acceptResponse('q3', payload('valid three'));
    await engine.flush();

    // The rejected answer is quarantined with its content intact — never a
    // silent drop — and never fences the attempt.
    expect(engine.getQuarantined().map((entry) => entry.questionId)).toEqual(['q1']);
    expect(engine.getQuarantined()[0]?.payload.answer).toBe(oversizedAnswer);
    expect(engine.getStatus()).not.toBe('conflict_terminal');
    // Its valid neighbors are delivered and hold no pending work.
    expect(batches).toContainEqual(['q1']);
    expect(batches).toContainEqual(['q2', 'q3']);
    expect(engine.getStates().get('q2')?.pending ?? null).toBeNull();
    expect(engine.getStates().get('q3')?.pending ?? null).toBeNull();
    // And the student can keep answering: the session was never fenced.
    await expect(engine.acceptResponse('q4', payload('answer after the rejection'))).resolves.toBeUndefined();
    await engine.flush();
    expect(engine.getStates().get('q4')?.pending ?? null).toBeNull();
  });

  it.each([100, 101])('delivers every answer exactly once through in-cap batches (%i questions)', async (total) => {
    const batches: number[] = [];
    const transport: TransportClient = { fetchSnapshot: vi.fn().mockResolvedValue(emptySnapshot()), sendBatch: vi.fn(), submit: vi.fn() };
    const engine = new DurableResponseEngine({ scheduleId: 'audit-s', attemptId: 'audit-a', leaseEpoch: 1, controlEpoch: 1, transport });
    engines.push(engine);
    (transport.sendBatch as ReturnType<typeof vi.fn>).mockImplementation(
      async (_attemptId: string, req: { commands: Array<{ writeId: string; questionId: string; clientVersion: number; response: ResponsePayload }> }) => {
        batches.push(req.commands.length);
        return {
          attemptRevision: 8,
          serverTime: new Date().toISOString(),
          acknowledgements: req.commands.map((entry) => ({
            writeId: entry.writeId,
            questionId: entry.questionId,
            clientVersion: entry.clientVersion,
            outcome: 'applied' as const,
            serverRevision: 8,
            canonicalResponse: entry.response,
            contentHash: 'hash-batch',
          })),
        };
      },
    );
    await engine.recover();
    await Promise.all(
      Array.from({ length: total }, (_, index) => engine.acceptResponse(`q${index}`, payload('answer'))),
    );
    await engine.flush();

    expect(batches.length).toBeGreaterThan(0);
    expect(batches.every((size) => size <= MAX_BATCH_COMMANDS)).toBe(true);
    // No answer is dropped and none is sent twice by the split.
    expect(batches.reduce((sum, size) => sum + size, 0)).toBe(total);
    expect(engine.getPendingCount()).toBe(0);
    expect(engine.getStatus()).toBe('synced');
  });
});
