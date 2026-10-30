import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../backendBridge', () => ({
  backendGet: vi.fn(),
  backendPost: vi.fn(),
  hasBackendStatusCode: (error: unknown, status: number) =>
    (error as { statusCode?: number } | null)?.statusCode === status,
}));

import { backendGet, backendPost } from '../backendBridge';
import { buildAttemptAuthorizationHeader, refreshAttemptCredential } from '../attemptCredentialAdapter';

const attempt = { id: 'attempt', scheduleId: 'schedule', candidateId: 'candidate' };
const credential = { attemptToken: 'renewed', expiresAt: '2099-01-01T00:00:00Z' };

describe('shared attempt credential renewal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('coalesces renewal from separate exam callers for the same writer', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(backendGet).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const save = refreshAttemptCredential(attempt, 'writer');
    const lifecycle = refreshAttemptCredential({ ...attempt }, 'writer');
    expect(backendGet).toHaveBeenCalledTimes(1);
    resolve({ attemptCredential: credential });
    await expect(Promise.all([save, lifecycle])).resolves.toEqual([true, true]);
    expect(buildAttemptAuthorizationHeader(attempt)).toEqual({ Authorization: 'Bearer renewed' });
  });

  it('does not share authorization between different browser writers or attempts', async () => {
    vi.mocked(backendGet).mockResolvedValue({ attemptCredential: credential });
    await Promise.all([
      refreshAttemptCredential(attempt, 'writer-a'),
      refreshAttemptCredential(attempt, 'writer-b'),
      refreshAttemptCredential({ ...attempt, id: 'other-attempt' }, 'writer-a'),
    ]);
    expect(backendGet).toHaveBeenCalledTimes(3);
  });

  it('releases a failed renewal so the next save can recover', async () => {
    const failure = { statusCode: 403 };
    vi.mocked(backendGet).mockRejectedValueOnce(failure).mockResolvedValueOnce({ attemptCredential: credential });
    await expect(refreshAttemptCredential(attempt, 'writer')).rejects.toBe(failure);
    await expect(refreshAttemptCredential(attempt, 'writer')).resolves.toBe(true);
    expect(backendGet).toHaveBeenCalledTimes(2);
    expect(backendPost).not.toHaveBeenCalled();
  });

  it('does not cache completed credentials instead of renewing on the next expiry', async () => {
    vi.mocked(backendGet).mockResolvedValue({ attemptCredential: credential });
    await refreshAttemptCredential(attempt, 'writer');
    await refreshAttemptCredential(attempt, 'writer');
    expect(backendGet).toHaveBeenCalledTimes(2);
  });

  it('retries rate-limited renewal with a bounded backoff', async () => {
    vi.useFakeTimers();
    vi.mocked(backendGet).mockRejectedValueOnce({ statusCode: 429 }).mockResolvedValueOnce({ attemptCredential: credential });
    const renewal = refreshAttemptCredential(attempt, 'writer');
    const assertion = expect(renewal).resolves.toBe(true);
    await vi.runAllTimersAsync();
    await assertion;
    expect(backendGet).toHaveBeenCalledTimes(2);
    expect(backendPost).not.toHaveBeenCalled();
  });

  it('stops rate-limit retries and allows a later request to recover', async () => {
    vi.useFakeTimers();
    const limited = { statusCode: 429 };
    vi.mocked(backendGet).mockRejectedValue(limited);
    const outcome = refreshAttemptCredential(attempt, 'writer').catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await outcome).toBe(limited);
    expect(backendGet).toHaveBeenCalledTimes(4);
    expect(backendPost).not.toHaveBeenCalled();
    vi.mocked(backendGet).mockResolvedValue({ attemptCredential: credential });
    await expect(refreshAttemptCredential(attempt, 'writer')).resolves.toBe(true);
  });

  it('does not treat an expired login and refused bootstrap as renewed authorization', async () => {
    const expired = { statusCode: 401 };
    vi.mocked(backendGet).mockRejectedValue(expired);
    vi.mocked(backendPost).mockRejectedValue(expired);
    await expect(refreshAttemptCredential(attempt, 'writer')).rejects.toBe(expired);
    expect(backendGet).toHaveBeenCalledTimes(1);
    expect(backendPost).toHaveBeenCalledTimes(1);
    expect(() => buildAttemptAuthorizationHeader(attempt)).toThrow('Missing attempt credential');
  });

});

// Sitting grants resume with their own proof; account expiry is unrelated.
describe('sitting grant policy', () => {
  beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear(); });

  it('uses narrow bearer resume and preserves policy', async () => {
    const { storeAttemptCredential, isAttemptCredentialExpiringWithin } = await import('../attemptCredentialAdapter');
    storeAttemptCredential(attempt, { ...credential, credentialPolicy: 'sitting_v1' });
    vi.mocked(backendPost).mockResolvedValue({ ...credential, credentialPolicy: 'sitting_v1', attemptId: attempt.id, clientSessionId: 'writer' });
    await expect(refreshAttemptCredential(attempt, 'writer')).resolves.toBe(true);
    expect(backendGet).not.toHaveBeenCalled();
    expect(backendPost).toHaveBeenCalledWith('/v2/student/attempts/attempt/access:resume', {}, expect.objectContaining({ headers: { Authorization: 'Bearer renewed' }, skipUnauthorizedHandler: true }));
    expect(isAttemptCredentialExpiringWithin(attempt.scheduleId, attempt.id, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it('never falls back to account bootstrap when a sitting grant expires', async () => {
    const { storeAttemptCredential } = await import('../attemptCredentialAdapter');
    storeAttemptCredential(attempt, { ...credential, credentialPolicy: 'sitting_v1' });
    const expired = { statusCode: 401, code: 'EXAM_ACCESS_EXPIRED' };
    vi.mocked(backendPost).mockRejectedValue(expired);
    await expect(refreshAttemptCredential(attempt, 'writer')).rejects.toBe(expired);
    expect(backendPost).toHaveBeenCalledTimes(1);
    expect(backendGet).not.toHaveBeenCalled();
  });
});

describe('sitting grant selection', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  const sitting = (attemptToken: string, expiresAt = '2099-01-01T00:00:00Z') =>
    ({ attemptToken, expiresAt, credentialPolicy: 'sitting_v1' as const });

  it('uses the single schedule grant when the route candidate is a WCODE alias', async () => {
    const { storeAttemptCredential, findSittingAttemptCredential } = await import('../attemptCredentialAdapter');
    storeAttemptCredential({ id: 'a1', scheduleId: 's', candidateId: 'CAND-1' }, sitting('grant'));
    expect(findSittingAttemptCredential('s', 'W123')?.attemptToken).toBe('grant');
  });

  it('prefers the exact candidate and refuses an ambiguous schedule', async () => {
    const { storeAttemptCredential, findSittingAttemptCredential } = await import('../attemptCredentialAdapter');
    storeAttemptCredential({ id: 'a1', scheduleId: 's', candidateId: 'alice' }, sitting('alice-grant'));
    storeAttemptCredential({ id: 'a2', scheduleId: 's', candidateId: 'bob' }, sitting('bob-grant'));
    expect(findSittingAttemptCredential('s', 'bob')?.attemptToken).toBe('bob-grant');
    expect(findSittingAttemptCredential('s', 'carol')).toBeNull();
  });

  it('never selects an expired grant or a legacy credential', async () => {
    const { storeAttemptCredential, findSittingAttemptCredential } = await import('../attemptCredentialAdapter');
    storeAttemptCredential({ id: 'a1', scheduleId: 's' }, sitting('old', '2001-01-01T00:00:00Z'));
    storeAttemptCredential({ id: 'a2', scheduleId: 's' }, { attemptToken: 'legacy', expiresAt: '2099-01-01T00:00:00Z' });
    expect(findSittingAttemptCredential('s')).toBeNull();
  });
});
