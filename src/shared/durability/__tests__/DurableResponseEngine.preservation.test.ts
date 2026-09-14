/** Student answer preservation (repair verification, WP0/WP8).
 *
 * Inverted from the audit witnesses: these assert the SAFE repaired behavior.
 * Failing here means a silent-loss path regressed — treat as BLOCKING.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DurableResponseEngine, type TransportClient } from '../DurableResponseEngine';
import { getVisibleResponse, type PendingResponseState, type ResponsePayload, type ResponseSnapshotV2 } from '../types';

const storage = vi.hoisted(() => ({ save: vi.fn(), list: vi.fn(), clear: vi.fn() }));
vi.mock('../../../utils/durableDraftStore', () => ({
  saveDurableDraft: storage.save, listDurableDrafts: storage.list, clearDurableDraft: storage.clear,
}));
const payload = (answer: string, markedForReview = false): ResponsePayload => ({ answer, markedForReview, annotations: [], eliminatedOptions: [] });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const engines: DurableResponseEngine[] = [];
function setup(snapshot: TransportClient['fetchSnapshot']) {
  const transport: TransportClient = { fetchSnapshot: snapshot, sendBatch: vi.fn(), submit: vi.fn() };
  const engine = new DurableResponseEngine({ scheduleId: 'audit-s', attemptId: 'audit-a', leaseEpoch: 1, controlEpoch: 1, drainDebounceMs: 60_000, transport });
  engines.push(engine); return { engine, transport };
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
