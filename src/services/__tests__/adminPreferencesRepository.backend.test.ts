import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../constants/examDefaults';
import { adminPreferencesRepository } from '../adminPreferencesRepository';

const originalFetch = global.fetch;

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('adminPreferencesRepository backend mode', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('loads and saves admin defaults through the backend settings endpoint', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_BUILDER', 'true');
    const config = createDefaultConfig('Academic', 'Academic');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          configSnapshot: config,
          revision: 2,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          configSnapshot: config,
          revision: 3,
        }),
      );
    global.fetch = fetchMock as typeof fetch;

    const loaded = await adminPreferencesRepository.loadDefaults();
    const saved = await adminPreferencesRepository.saveDefaults(loaded.config, loaded);

    expect(loaded).toEqual({ config, revision: 2, stored: true });
    expect(saved.revision).toBe(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/settings/exam-defaults',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/settings/exam-defaults',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('surfaces backend failures instead of silently falling back to local defaults', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_BUILDER', 'true');
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'settings offline' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    ) as typeof fetch;

    await expect(adminPreferencesRepository.loadDefaults()).rejects.toThrow('settings offline');
  });

  it('turns an aborted defaults request into a retryable timeout message', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_BUILDER', 'true');
    const abortError = new Error('signal is aborted without reason');
    abortError.name = 'AbortError';
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    global.fetch = fetchMock as typeof fetch;

    await expect(adminPreferencesRepository.loadDefaults()).rejects.toThrow(
      'Loading saved exam defaults timed out. Check the backend connection and retry.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a caller cancellation as a cancellation, not a timeout', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_BUILDER', 'true');
    const controller = new AbortController();
    global.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
    ) as typeof fetch;

    const read = adminPreferencesRepository.loadDefaults(controller.signal);
    controller.abort();
    await expect(read).rejects.toMatchObject({ name: 'AbortError' });
  });

  describe('conflicting writers (F8)', () => {
    function conflict() {
      return new Response(JSON.stringify({ success: false, error: { code: 'REVISION_CONFLICT', message: 'stale revision' } }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    }

    function withTitle(title: string) {
      const config = createDefaultConfig('Academic', 'Academic');
      config.general.title = title;
      return config;
    }

    it('does not overwrite a remote edit with a stale full document', async () => {
      const base = withTitle('base');
      const remote = withTitle('their edit');
      const mine = withTitle('my edit');
      const puts: unknown[] = [];
      global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          puts.push(JSON.parse(String(init.body)));
          return conflict();
        }
        return jsonResponse({ configSnapshot: puts.length ? remote : base, revision: puts.length ? 5 : 4 });
      }) as typeof fetch;

      const loaded = await adminPreferencesRepository.loadDefaults();
      await expect(adminPreferencesRepository.saveDefaults(mine, loaded)).rejects.toMatchObject({
        code: 'EXAM_DEFAULTS_CONFLICT',
        latest: { revision: 5, config: expect.objectContaining({ general: expect.objectContaining({ title: 'their edit' }) }) },
      });
      expect(puts).toHaveLength(1);
    });

    it('retries once when the remote revision moved but its content did not', async () => {
      const base = withTitle('base');
      const mine = withTitle('my edit');
      const puts: Array<{ revision: number }> = [];
      global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          puts.push(JSON.parse(String(init.body)));
          return puts.length === 1 ? conflict() : jsonResponse({ configSnapshot: mine, revision: 6 });
        }
        return jsonResponse({ configSnapshot: base, revision: puts.length ? 5 : 4 });
      }) as typeof fetch;

      const loaded = await adminPreferencesRepository.loadDefaults();
      await adminPreferencesRepository.saveDefaults(mine, loaded);
      expect(puts.map((put) => put.revision)).toEqual([4, 5]);
    });

    it('overwrites a remote edit only when explicitly asked', async () => {
      const base = withTitle('base');
      const remote = withTitle('their edit');
      const mine = withTitle('my edit');
      const puts: Array<{ revision: number }> = [];
      global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          puts.push(JSON.parse(String(init.body)));
          return puts.length === 1 ? conflict() : jsonResponse({ configSnapshot: mine, revision: 6 });
        }
        return jsonResponse({ configSnapshot: puts.length ? remote : base, revision: puts.length ? 5 : 4 });
      }) as typeof fetch;

      const loaded = await adminPreferencesRepository.loadDefaults();
      await adminPreferencesRepository.saveDefaults(mine, loaded, { overwrite: true });
      expect(puts.map((put) => put.revision)).toEqual([4, 5]);
    });
  });
});
