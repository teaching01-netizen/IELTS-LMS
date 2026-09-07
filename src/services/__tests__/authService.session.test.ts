import { describe, expect, it, vi, beforeEach } from 'vitest';
import { authService } from '../authService';
import { get } from '../../app/api/apiClient';

vi.mock('../../app/api/apiClient', () => ({
  get: vi.fn(),
  post: vi.fn(),
}));

describe('authService.getSession single-flight (AT-09)', () => {
  beforeEach(() => {
    vi.mocked(get).mockReset();
  });

  it('shares one in-flight request across concurrent callers', async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(get).mockReturnValue(new Promise((r) => { resolve = r; }));
    const a = authService.getSession();
    const b = authService.getSession();
    resolve({ data: { csrfToken: 't' } });
    await Promise.all([a, b]);
    expect(vi.mocked(get)).toHaveBeenCalledTimes(1);
  });

  it('keeps returning null on 401 without throwing', async () => {
    vi.mocked(get).mockRejectedValue({ statusCode: 401 });
    await expect(authService.getSession()).resolves.toBeNull();
  });
});
