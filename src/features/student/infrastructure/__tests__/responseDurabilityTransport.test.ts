import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  backendGet: vi.fn(),
  backendPost: vi.fn(),
  refreshAttemptCredentialForAttempt: vi.fn(),
  storeAttemptCredential: vi.fn(),
  isAttemptCredentialExpiringWithin: vi.fn(),
  tryBuildAttemptAuthorizationHeader: vi.fn(),
}));

vi.mock('@services/backendBridge', () => ({
  backendGet: mocks.backendGet,
  backendPost: mocks.backendPost,
  hasBackendStatusCode: (error: unknown, statusCode: number) =>
    typeof error === 'object' && error !== null &&
    ((error as { status?: number }).status === statusCode ||
      (error as { statusCode?: number }).statusCode === statusCode),
}));

vi.mock('@services/attemptCredentialAdapter', () => ({
  storeAttemptCredential: mocks.storeAttemptCredential,
  isAttemptCredentialExpiringWithin: mocks.isAttemptCredentialExpiringWithin,
  tryBuildAttemptAuthorizationHeader: mocks.tryBuildAttemptAuthorizationHeader,
}));

vi.mock('@services/studentAttemptRepository', () => ({
  refreshAttemptCredentialForAttempt: mocks.refreshAttemptCredentialForAttempt,
}));

import { createResponseDurabilityV2Transport } from '../responseDurabilityTransport';
import type { StudentAttempt } from '../../../types/studentAttempt';

const attempt = { id: 'attempt-1', scheduleId: 'schedule-1' } as StudentAttempt;

describe('response durability transport writer identity', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.refreshAttemptCredentialForAttempt.mockResolvedValue(true);
    mocks.tryBuildAttemptAuthorizationHeader.mockReturnValue({ Authorization: 'Bearer attempt' });
  });

  it.each(['sendBatch', 'submit', 'fetchSnapshot'] as const)(
    'uses the browser writer id when refreshing credentials for %s',
    async (operation) => {
      const response = { ok: true };
      const request = operation === 'fetchSnapshot' ? mocks.backendGet : mocks.backendPost;
      request.mockRejectedValueOnce({ statusCode: 401 }).mockResolvedValueOnce(response);

      const transport = createResponseDurabilityV2Transport('schedule-1', attempt, 'browser-writer-id');
      const result = operation === 'sendBatch'
        ? await transport.sendBatch('attempt-1', { mutations: [] } as never)
        : operation === 'submit'
          ? await transport.submit('attempt-1', {} as never)
          : await transport.fetchSnapshot('attempt-1');

      expect(result).toBe(response);
      expect(mocks.refreshAttemptCredentialForAttempt).toHaveBeenCalledWith(attempt, 'browser-writer-id');
      expect(request).toHaveBeenCalledTimes(2);
    },
  );

  it('bounds response-batch requests so a stalled save can enter the retry path', async () => {
    mocks.backendPost.mockResolvedValue({ ok: true });
    const transport = createResponseDurabilityV2Transport('schedule-1', attempt);

    await transport.sendBatch('attempt-1', { commands: [] } as never);

    expect(mocks.backendPost).toHaveBeenCalledWith(
      '/v2/student/attempts/attempt-1/responses:batch',
      { commands: [] },
      expect.objectContaining({ timeout: 15_000, retries: 0 }),
    );
  });
});


describe('response durability credential renewal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.tryBuildAttemptAuthorizationHeader.mockReturnValue({ Authorization: 'Bearer current' });
    mocks.refreshAttemptCredentialForAttempt.mockResolvedValue(true);
    mocks.backendPost.mockResolvedValue({ ok: true });
  });

  it.each(['sendBatch', 'submit', 'fetchSnapshot'] as const)(
    'renews before sending %s with a near-expiry credential',
    async (operation) => {
      mocks.isAttemptCredentialExpiringWithin.mockReturnValue(true);
      const request = operation === 'fetchSnapshot' ? mocks.backendGet : mocks.backendPost;
      request.mockImplementation(async () => {
        expect(mocks.refreshAttemptCredentialForAttempt).toHaveBeenCalledWith(attempt, 'writer');
        return { ok: true };
      });
      const transport = createResponseDurabilityV2Transport('schedule-1', attempt, 'writer');
      if (operation === 'sendBatch') await transport.sendBatch(attempt.id, {} as never);
      else if (operation === 'submit') await transport.submit(attempt.id, {} as never);
      else await transport.fetchSnapshot(attempt.id);
      expect(request).toHaveBeenCalledTimes(1);
      expect(mocks.isAttemptCredentialExpiringWithin).toHaveBeenCalledWith('schedule-1', 'attempt-1', 120_000);
    },
  );

  it('still tries the current credential when proactive renewal is temporarily unavailable', async () => {
    mocks.isAttemptCredentialExpiringWithin.mockReturnValue(true);
    mocks.refreshAttemptCredentialForAttempt.mockRejectedValue({ statusCode: 503 });
    const transport = createResponseDurabilityV2Transport('schedule-1', attempt, 'writer');
    await expect(transport.submit(attempt.id, {} as never)).resolves.toEqual({ ok: true });
  });

  it('keeps a failed submission failed when renewal cannot restore authorization', async () => {
    const failure = { statusCode: 401 };
    mocks.backendPost.mockRejectedValue(failure);
    mocks.refreshAttemptCredentialForAttempt.mockResolvedValue(false);
    const transport = createResponseDurabilityV2Transport('schedule-1', attempt, 'writer');
    await expect(transport.submit(attempt.id, {} as never)).rejects.toBe(failure);
    expect(mocks.backendPost).toHaveBeenCalledTimes(1);
    expect(mocks.storeAttemptCredential).not.toHaveBeenCalled();
  });

  it('does not renew or replay a forbidden submission', async () => {
    const failure = { statusCode: 403 };
    mocks.backendPost.mockRejectedValue(failure);
    const transport = createResponseDurabilityV2Transport('schedule-1', attempt, 'writer');
    await expect(transport.submit(attempt.id, {} as never)).rejects.toBe(failure);
    expect(mocks.refreshAttemptCredentialForAttempt).not.toHaveBeenCalled();
    expect(mocks.backendPost).toHaveBeenCalledTimes(1);
  });
});
