import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DurableResponseEngine, type TransportClient } from '../DurableResponseEngine';
import type { SubmitAttemptV2Request, SubmitAttemptV2Response } from '../types';
import { loadDurableDraft, saveDurableDraft } from '../../../utils/durableDraftStore';

const intentKey = 'v2_submission_intent:schedule:attempt:1';
const engines: DurableResponseEngine[] = [];
const makeEngine = (transport: TransportClient) => {
  const engine = new DurableResponseEngine({ scheduleId: 'schedule', attemptId: 'attempt', leaseEpoch: 1, controlEpoch: 1, transport, drainDebounceMs: 60_000 });
  engines.push(engine);
  return engine;
};
function receipt(request: SubmitAttemptV2Request): SubmitAttemptV2Response {
  return {
    attemptId: 'attempt', submissionId: request.submissionId, status: 'submitted', attemptRevision: 2,
    finalResponseDigest: 'committed-digest', submittedAt: new Date().toISOString(),
    acknowledgements: request.finalCommands.map((command) => ({
      writeId: command.writeId, questionId: command.questionId, clientVersion: command.clientVersion,
      outcome: 'applied', serverRevision: 2, canonicalResponse: command.response, contentHash: 'hash',
    })),
  };
}
function transport(): TransportClient {
  return {
    sendBatch: vi.fn(), submit: vi.fn(), fetchSubmissionReceipt: vi.fn(),
    fetchSnapshot: vi.fn(async () => ({ attemptId: 'attempt', protocolVersion: 2, deliveryStatus: 'running', leaseEpoch: 1, controlEpoch: 1, attemptRevision: 1, responses: [] })),
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => { for (const engine of engines.splice(0)) engine.destroy(); vi.restoreAllMocks(); });

describe('durable submission recovery with the durable store', () => {
  it('recovers the committed receipt after reload without inventing a new submission ID or losing final answers', async () => {
    const firstTransport = transport();
    vi.mocked(firstTransport.submit).mockRejectedValue({ status: 0, message: 'Response lost after commit' });
    const first = makeEngine(firstTransport);
    await first.acceptResponse('q1', { answer: 'B', markedForReview: false, eliminatedOptions: [], annotations: [] });
    await expect(first.submit('original-submission', 1)).rejects.toMatchObject({ status: 0 });
    const original = vi.mocked(firstTransport.submit).mock.calls[0]![1];
    first.destroy();

    const nextTransport = transport();
    vi.mocked(nextTransport.fetchSubmissionReceipt!).mockResolvedValue(receipt(original));
    const next = makeEngine(nextTransport);
    await next.recover();
    const result = await next.submit('new-id-after-reload', 999);
    expect(result.submissionId).toBe('original-submission');
    expect(nextTransport.fetchSubmissionReceipt).toHaveBeenCalledWith('attempt', 'original-submission');
    expect(nextTransport.submit).not.toHaveBeenCalled();
    expect(next.getStates().get('q1')?.confirmed?.payload.answer).toBe('B');
    expect(next.getQuarantined()).toHaveLength(0);
    expect(await loadDurableDraft(intentKey)).toBeNull();
  });

  it('replays the exact saved request when the prior commit did not happen', async () => {
    const firstTransport = transport();
    vi.mocked(firstTransport.submit).mockRejectedValue({ status: 503 });
    const first = makeEngine(firstTransport);
    await expect(first.submit('original-submission', 1)).rejects.toMatchObject({ status: 503 });
    const original = vi.mocked(firstTransport.submit).mock.calls[0]![1];
    first.destroy();
    const nextTransport = transport();
    vi.mocked(nextTransport.fetchSubmissionReceipt!).mockResolvedValue(null);
    vi.mocked(nextTransport.submit).mockImplementation(async (_attempt, request) => receipt(request));
    const next = makeEngine(nextTransport);
    await next.submit('different-id', 99);
    expect(nextTransport.submit).toHaveBeenCalledWith('attempt', original);
  });

  it('preserves the original intent when receipt lookup is unavailable', async () => {
    const client = transport();
    vi.mocked(client.submit).mockRejectedValue({ status: 0 });
    const engine = makeEngine(client);
    await expect(engine.submit('original', 1)).rejects.toMatchObject({ status: 0 });
    vi.mocked(client.fetchSubmissionReceipt!).mockRejectedValue({ status: 503 });
    await expect(engine.submit('replacement', 99)).rejects.toMatchObject({ status: 503 });
    expect(client.submit).toHaveBeenCalledTimes(1);
    expect(await loadDurableDraft(intentKey)).toMatchObject({ request: { submissionId: 'original', expectedAttemptRevision: 1 } });
  });

  it('refuses to send when the submission intent cannot be stored durably', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    const client = transport();
    await expect(makeEngine(client).submit('submission', 1)).rejects.toThrow();
    expect(client.submit).not.toHaveBeenCalled();
  });

  it('refuses a corrupted or foreign submission intent without sending it', async () => {
    await saveDurableDraft(intentKey, { scheduleId: 'other', attemptId: 'other', request: { submissionId: 'other', leaseEpoch: 1, finalCommands: [] } });
    const client = transport();
    await expect(makeEngine(client).submit('new', 1)).rejects.toThrow('needs recovery');
    expect(client.submit).not.toHaveBeenCalled();
  });
});

it('retains answers and asks for restored access without a rapid retry loop', async () => {
  const client = transport();
  vi.mocked(client.sendBatch).mockRejectedValue({ status: 401, code: 'EXAM_ACCESS_EXPIRED' });
  const statuses: string[] = [];
  const engine = new DurableResponseEngine({ scheduleId: 'auth-schedule', attemptId: 'auth-attempt', leaseEpoch: 1, controlEpoch: 1, transport: client, drainDebounceMs: 60_000, onStatusChange: (status) => statuses.push(status) });
  engines.push(engine);
  await engine.acceptResponse('q1', { answer: 'B', markedForReview: false, eliminatedOptions: [], annotations: [] });
  await engine.flush();
  expect(client.sendBatch).toHaveBeenCalledTimes(1);
  expect(engine.getStatus()).toBe('authentication_required');
  expect(engine.getStates().get('q1')?.pending?.payload.answer).toBe('B');
  expect(engine.getQuarantined()).toHaveLength(0);
  expect(statuses.at(-1)).toBe('authentication_required');
});

it('allows a corrected submission after a definitive payload rejection', async () => {
  const client = transport();
  vi.mocked(client.submit).mockRejectedValueOnce({ status: 413, code: 'PAYLOAD_TOO_LARGE' })
    .mockImplementationOnce(async (_attempt, request) => receipt(request));
  const engine = makeEngine(client);
  await expect(engine.submit('rejected', 1)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  expect(await loadDurableDraft(intentKey)).toBeNull();
  await expect(engine.submit('corrected', 2)).resolves.toMatchObject({ submissionId: 'corrected' });
  expect(client.fetchSubmissionReceipt).not.toHaveBeenCalled();
});

describe('retained drafts become unscored evidence', () => {
  const withoutAcks = (request: SubmitAttemptV2Request) => ({ ...receipt(request), acknowledgements: [] });

  it('sends a draft the terminal receipt did not accept, with its original provenance', async () => {
    const client = transport();
    client.submitDraftEvidence = vi.fn(async () => ({ recorded: 1, replayed: 0 }));
    vi.mocked(client.submit).mockImplementation(async (_attempt, request) => withoutAcks(request));
    const engine = makeEngine(client);
    await engine.acceptResponse('q1', { answer: 'late', markedForReview: false, eliminatedOptions: [], annotations: [] });
    await engine.submit('submission', 1);
    const [attemptId, items] = vi.mocked(client.submitDraftEvidence).mock.calls[0]!;
    expect(attemptId).toBe('attempt');
    expect(items).toEqual([expect.objectContaining({ questionId: 'q1', originLeaseEpoch: 1, reason: 'SUBMISSION_ACK_MISSING', response: expect.objectContaining({ answer: 'late' }) })]);
    // Local copies are always kept; a second call does not resend.
    expect(engine.getQuarantined()).toHaveLength(1);
    await expect(engine.recordRetainedEvidence()).resolves.toBe(0);
    expect(client.submitDraftEvidence).toHaveBeenCalledTimes(1);
  });

  it('keeps the receipt and the local draft when evidence cannot be sent', async () => {
    const client = transport();
    client.submitDraftEvidence = vi.fn(async () => { throw { status: 503, code: 'SERVICE_UNAVAILABLE' }; });
    vi.mocked(client.submit).mockImplementation(async (_attempt, request) => withoutAcks(request));
    const engine = makeEngine(client);
    await engine.acceptResponse('q1', { answer: 'late', markedForReview: false, eliminatedOptions: [], annotations: [] });
    await expect(engine.submit('submission', 1)).resolves.toMatchObject({ submissionId: 'submission' });
    expect(engine.getQuarantined()).toHaveLength(1);
  });
});
