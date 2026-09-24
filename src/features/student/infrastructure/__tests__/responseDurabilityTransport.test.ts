import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  backendGet: vi.fn(),
  backendPost: vi.fn(),
  refreshAttemptCredentialForAttempt: vi.fn(),
  storeAttemptCredential: vi.fn(),
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
});
