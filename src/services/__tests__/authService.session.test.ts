import { describe, expect, it, vi, beforeEach } from 'vitest';
import { authService } from '../authService';
import { get } from '../../app/api/apiClient';

vi.mock('../../app/api/apiClient', () => ({
  get: vi.fn(),
  post: vi.fn(),
}));

const session = {
  user: { id: 'u1', email: 'a@example.com', role: 'admin', state: 'active' },
  csrfToken: 't',
  expiresAt: '2099-01-01T00:00:00Z',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('authService.getSession single-flight (AT-09)', () => {
  beforeEach(() => {
    vi.mocked(get).mockReset();
    authService.invalidateSessionRequest();
  });

  it('shares one in-flight request across concurrent callers of one generation', async () => {
    const pending = deferred<unknown>();
    vi.mocked(get).mockReturnValue(pending.promise as never);
    const a = authService.getSession(1);
    const b = authService.getSession(1);
    pending.resolve({ data: session });
    await expect(Promise.all([a, b])).resolves.toEqual([session, session]);
    expect(vi.mocked(get)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(get)).toHaveBeenCalledWith(
      '/v1/auth/session',
      expect.objectContaining({ retries: 0, skipUnauthorizedHandler: true }),
    );
  });

  it('never lets a newer generation join an older flight, and the old finally keeps the new flight', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    vi.mocked(get)
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never)
      .mockReturnValueOnce(new Promise(() => {}) as never);
    const old = authService.getSession(1);
    const fresh = authService.getSession(2);
    expect(vi.mocked(get)).toHaveBeenCalledTimes(2);
    // The old flight was aborted by the newer generation.
    const oldSignal = (vi.mocked(get).mock.calls[0]?.[1] as { signal: AbortSignal }).signal;
    expect(oldSignal.aborted).toBe(true);
    first.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    await expect(old).rejects.toMatchObject({ name: 'AbortError' });
    // A same-generation caller still joins the live (second) flight.
    const joined = authService.getSession(2);
    expect(vi.mocked(get)).toHaveBeenCalledTimes(2);
    second.resolve({ data: session });
    await expect(Promise.all([fresh, joined])).resolves.toEqual([session, session]);
  });

  it("cancels only the caller's own wait, not the shared request", async () => {
    const pending = deferred<unknown>();
    vi.mocked(get).mockReturnValue(pending.promise as never);
    const controller = new AbortController();
    const cancelled = authService.getSession(1, controller.signal);
    const other = authService.getSession(1);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    const sharedSignal = (vi.mocked(get).mock.calls[0]?.[1] as { signal: AbortSignal }).signal;
    expect(sharedSignal.aborted).toBe(false);
    pending.resolve({ data: session });
    await expect(other).resolves.toEqual(session);
  });

  it('resolves null only for a definitive 401', async () => {
    vi.mocked(get).mockRejectedValue({ statusCode: 401 });
    await expect(authService.getSession()).resolves.toBeNull();
  });

  it('rejects (unavailable, not logged out) on transient failure and malformed payloads', async () => {
    vi.mocked(get).mockRejectedValueOnce({ statusCode: 503 });
    await expect(authService.getSession()).rejects.toMatchObject({ statusCode: 503 });
    vi.mocked(get).mockResolvedValueOnce({ data: { csrfToken: 't' } } as never);
    await expect(authService.getSession()).rejects.toMatchObject({ code: 'SESSION_PROTOCOL_ERROR' });
    vi.mocked(get).mockResolvedValueOnce({ data: null } as never);
    await expect(authService.getSession()).rejects.toMatchObject({ code: 'SESSION_PROTOCOL_ERROR' });
  });
});
