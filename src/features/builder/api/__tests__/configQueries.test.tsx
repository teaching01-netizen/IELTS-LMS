import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConfigSnapshotQuery } from '../configQueries';

function QueryWrapper({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('configuration query cancellation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(['exam', 'version'] as const)('cancels the %s read at fetch when its observer leaves', async (stage) => {
    let pendingSignal: AbortSignal | undefined;
    const fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (stage === 'version' && String(url).includes('/v1/exams/')) {
        return Promise.resolve(new Response(JSON.stringify({ id: 'a', currentDraftVersionId: 'v1' }), {
          status: 200, headers: { 'content-type': 'application/json' },
        }));
      }
      pendingSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        pendingSignal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
      });
    });
    vi.stubGlobal('fetch', fetch);
    const { unmount } = renderHook(() => useConfigSnapshotQuery('a'), { wrapper: QueryWrapper });
    await waitFor(() => expect(pendingSignal).toBeDefined());
    unmount();
    await waitFor(() => expect(pendingSignal?.aborted).toBe(true));
    expect(fetch).toHaveBeenCalledTimes(stage === 'exam' ? 1 : 2);
  });
});
