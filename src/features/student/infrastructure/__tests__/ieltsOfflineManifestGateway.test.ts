import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudentAttempt } from '../../../../types/studentAttempt';

const mocks = vi.hoisted(() => ({
  backendGet: vi.fn(),
  remember: vi.fn(),
  headers: vi.fn(),
  store: vi.fn(),
}));
vi.mock('@services/backendBridge', () => ({ backendGet: mocks.backendGet }));
vi.mock('@services/attemptCredentialAdapter', () => ({
  sittingAttemptAuthorizationHeaders: mocks.headers,
  storeAttemptCredential: mocks.store,
}));
vi.mock('../ieltsOfflinePackageStore', () => ({ rememberIeltsOfflineManifest: mocks.remember }));

import { fetchIeltsOfflineManifestForAttempt } from '../ieltsOfflineManifestGateway';

const attempt = {
  id: 'att-1',
  scheduleId: 'sched-1',
  candidateId: 'W001',
} as StudentAttempt;

describe('IELTS offline manifest gateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.headers.mockReturnValue({ Authorization: 'Bearer attempt' });
  });

  it('reads the credentialed session projection and remembers only a valid descriptor', async () => {
    mocks.backendGet.mockResolvedValue({ offlineManifest: { schemaVersion: 1 } });

    await expect(fetchIeltsOfflineManifestForAttempt(attempt, 'cs-1')).resolves.toBe(true);

    expect(mocks.backendGet).toHaveBeenCalledWith(
      '/v1/student/sessions/sched-1?candidateId=W001&clientSessionId=cs-1&refreshAttemptCredential=true',
      expect.objectContaining({ headers: { Authorization: 'Bearer attempt' }, retries: 0 }),
    );
    expect(mocks.headers).toHaveBeenCalledWith('sched-1', 'W001', 'att-1');
    expect(mocks.remember).toHaveBeenCalledWith({ schemaVersion: 1 });
  });

  it('reads through the cookie session and keeps the re-issued credential without a sitting grant', async () => {
    mocks.headers.mockReturnValue({});
    const credential = { attemptToken: 'rotated', expiresAt: '2026-10-30T20:00:00Z' };
    mocks.backendGet.mockResolvedValue({ attemptCredential: credential, offlineManifest: { schemaVersion: 1 } });

    await expect(fetchIeltsOfflineManifestForAttempt(attempt, 'cs-1')).resolves.toBe(true);

    expect(mocks.backendGet).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: {} }));
    expect(mocks.store).toHaveBeenCalledWith(attempt, credential);
  });

  it('does not remember an absent descriptor', async () => {
    mocks.backendGet.mockResolvedValue({});

    await expect(fetchIeltsOfflineManifestForAttempt(attempt, 'cs-1')).resolves.toBe(false);
    expect(mocks.remember).not.toHaveBeenCalled();
  });
});
