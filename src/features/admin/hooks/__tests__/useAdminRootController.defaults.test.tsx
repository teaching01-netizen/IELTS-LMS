import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../../constants/examDefaults';
import type { ExamConfig } from '../../../../types';
import { useAdminRootController } from '../useAdminRootController';

vi.mock('../../../auth/api/authSession', () => ({
  useAuthSession: () => ({ session: { user: { id: 'admin-1', role: 'admin' } } }),
}));

const originalFetch = global.fetch;

function withTitle(title: string): ExamConfig {
  const config = createDefaultConfig('Academic', 'Academic');
  config.general.title = title;
  return config;
}

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={['/admin/settings']}>{children}</MemoryRouter>
  </QueryClientProvider>
);

async function renderLoaded() {
  const view = renderHook(() => useAdminRootController(), { wrapper });
  await waitFor(() => expect(view.result.current.isInitialized).toBe(true));
  return view;
}

describe('admin defaults persistence (F8)', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('reports a failed save and keeps the edited defaults on screen', async () => {
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'PUT'
        ? respond(400, { success: false, error: { code: 'INVALID', message: 'settings rejected' } })
        : respond(200, { success: true, data: { configSnapshot: withTitle('base'), revision: 1 } }),
    ) as typeof fetch;
    const { result } = await renderLoaded();

    act(() => result.current.contextValue.setDefaults(withTitle('mine')));

    await waitFor(() => expect(result.current.defaultsSaveIssue).toMatchObject({ kind: 'failed' }));
    expect(result.current.defaultsSaveIssue?.message).toContain('settings rejected');
    expect(result.current.contextValue.defaults.general.title).toBe('mine');
  });

  it('does not overwrite a conflicting remote edit until the admin chooses to', async () => {
    const puts: Array<{ revision: number; configSnapshot: ExamConfig }> = [];
    let remote = { configSnapshot: withTitle('base'), revision: 4 };
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        if (body.revision !== remote.revision) {
          return respond(409, { success: false, error: { code: 'REVISION_CONFLICT', message: 'stale' } });
        }
        remote = { configSnapshot: body.configSnapshot, revision: remote.revision + 1 };
        return respond(200, { success: true, data: remote });
      }
      return respond(200, { success: true, data: remote });
    }) as typeof fetch;
    const { result } = await renderLoaded();

    // Another admin saves between this admin's load and edit.
    remote = { configSnapshot: withTitle('their edit'), revision: 5 };
    act(() => result.current.contextValue.setDefaults(withTitle('mine')));
    await waitFor(() => expect(result.current.defaultsSaveIssue).toMatchObject({ kind: 'conflict' }));
    expect(puts).toHaveLength(1);
    expect(remote.configSnapshot.general.title).toBe('their edit');

    // Further edits stay local while the conflict is unresolved.
    act(() => result.current.contextValue.setDefaults(withTitle('mine, edited again')));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(puts).toHaveLength(1);
    expect(result.current.contextValue.defaults.general.title).toBe('mine, edited again');

    act(() => result.current.overwriteDefaults());
    await waitFor(() => expect(result.current.defaultsSaveIssue).toBeNull());
    expect(remote.configSnapshot.general.title).toBe('mine, edited again');
  });

  it('serializes rapid edits and sends only the latest queued draft', async () => {
    const puts: Array<{ revision: number; configSnapshot: ExamConfig }> = [];
    const firstPut = deferred();
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        if (puts.length === 1) return firstPut.promise;
        return respond(200, { success: true, data: { configSnapshot: body.configSnapshot, revision: body.revision + 1 } });
      }
      return respond(200, { success: true, data: { configSnapshot: withTitle('base'), revision: 1 } });
    }) as typeof fetch;
    const { result } = await renderLoaded();

    act(() => result.current.contextValue.setDefaults(withTitle('one')));
    act(() => result.current.contextValue.setDefaults(withTitle('two')));
    act(() => result.current.contextValue.setDefaults(withTitle('three')));
    await act(async () => {
      firstPut.resolve(respond(200, { success: true, data: { configSnapshot: withTitle('one'), revision: 2 } }));
    });

    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts.map((put) => [put.configSnapshot.general.title, put.revision])).toEqual([
      ['one', 1],
      ['three', 2],
    ]);
    expect(result.current.defaultsSaveIssue).toBeNull();
  });

  it('confirms an acknowledged save in the shared cache and keeps a newer edit dirty', async () => {
    const save = deferred();
    let remote = { configSnapshot: withTitle('base'), revision: 1 };
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return save.promise;
      return respond(200, { success: true, data: remote });
    }) as typeof fetch;
    const { result } = await renderLoaded();

    act(() => result.current.contextValue.setDefaults(withTitle('four')));
    // Edit 5 lands while save 4 is pending.
    act(() => result.current.contextValue.setDefaults(withTitle('five')));
    await act(async () => {
      save.resolve(respond(200, { success: true, data: { configSnapshot: withTitle('four'), revision: 2 } }));
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(['admin', 'preferences', 'exam-defaults'])).toMatchObject({ revision: 2 }),
    );
    expect(result.current.contextValue.defaults.general.title).toBe('five');

    // A refetch replaces the confirmed base but never the unsaved draft.
    remote = { configSnapshot: withTitle('remote'), revision: 3 };
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['admin', 'preferences', 'exam-defaults'] });
      // Let the query observers deliver the refetched base before asserting.
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(queryClient.getQueryData(['admin', 'preferences', 'exam-defaults'])).toMatchObject({ revision: 3 });
    expect(result.current.contextValue.defaults.general.title).toBe('five');
  });

  it('adopts the acknowledged defaults when no newer edit exists, then follows the server', async () => {
    let remote = { configSnapshot: withTitle('base'), revision: 1 };
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        remote = { configSnapshot: body.configSnapshot, revision: body.revision + 1 };
      }
      return respond(200, { success: true, data: remote });
    }) as typeof fetch;
    const { result } = await renderLoaded();

    act(() => result.current.contextValue.setDefaults(withTitle('mine')));
    await waitFor(() =>
      expect(queryClient.getQueryData(['admin', 'preferences', 'exam-defaults'])).toMatchObject({ revision: 2 }),
    );

    remote = { configSnapshot: withTitle('later remote'), revision: 3 };
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['admin', 'preferences', 'exam-defaults'] });
    });
    await waitFor(() => expect(result.current.contextValue.defaults.general.title).toBe('later remote'));
  });

  it('starts a new staff session from the server, not the previous actor\'s cache', async () => {
    let remote = { configSnapshot: withTitle('base'), revision: 4 };
    const puts: Array<{ revision: number }> = [];
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        remote = { configSnapshot: body.configSnapshot, revision: body.revision + 1 };
      }
      return respond(200, { success: true, data: remote });
    }) as typeof fetch;
    const first = await renderLoaded();
    first.unmount();

    // Logout clears the staff cache; another admin changes defaults meanwhile.
    queryClient.clear();
    remote = { configSnapshot: withTitle('changed elsewhere'), revision: 9 };
    const { result } = await renderLoaded();
    expect(result.current.contextValue.defaults.general.title).toBe('changed elsewhere');

    act(() => result.current.contextValue.setDefaults(withTitle('mine')));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]!.revision).toBe(9);
  });
});
