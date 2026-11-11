import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { createLibraryFolder } from '../api';
import { useCreateFolderMutation } from '../queries';

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  createLibraryFolder: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(createLibraryFolder).mockReset();
  vi.mocked(createLibraryFolder).mockResolvedValue({ id: 'new-folder', name: 'Math', scopeKey: 'scope', providerKey: 'sat', revision: 0, createdBy: 'staff', createdAt: '', updatedAt: '' });
});

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return renderHook(() => useCreateFolderMutation(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

it('uses a new creation intent after success, even when reusing a folder name', async () => {
  const { result } = setup();
  await act(async () => { await result.current.mutateAsync({ name: 'Math' }); });
  await act(async () => { await result.current.mutateAsync({ name: 'Math' }); });
  const [first, second] = vi.mocked(createLibraryFolder).mock.calls;
  expect(first?.[0].operationKey).toEqual(expect.any(String));
  expect(second?.[0].operationKey).toEqual(expect.any(String));
  expect(second?.[0].operationKey).not.toBe(first?.[0].operationKey);
});

it('reuses a creation intent after a lost response, and changes it for a different payload', async () => {
  vi.mocked(createLibraryFolder).mockRejectedValueOnce(new Error('Response lost'));
  const { result } = setup();
  await act(async () => { await expect(result.current.mutateAsync({ name: 'Math' })).rejects.toThrow('Response lost'); });
  await act(async () => { await result.current.mutateAsync({ name: 'Math' }); });
  const [first, retry] = vi.mocked(createLibraryFolder).mock.calls;
  expect(first?.[0].operationKey).toEqual(expect.any(String));
  expect(retry?.[0].operationKey).toBe(first?.[0].operationKey);
  vi.mocked(createLibraryFolder).mockRejectedValueOnce(new Error('Response lost'));
  await act(async () => { await expect(result.current.mutateAsync({ name: 'Science' })).rejects.toThrow(); });
  await act(async () => { await result.current.mutateAsync({ name: 'Science', parentId: 'other' }); });
  const calls = vi.mocked(createLibraryFolder).mock.calls;
  expect(calls[3]?.[0].operationKey).not.toBe(calls[2]?.[0].operationKey);
});

it('starts a fresh intent when a failed creation is dismissed', async () => {
  vi.mocked(createLibraryFolder).mockRejectedValueOnce(new Error('Response lost'));
  const { result } = setup();
  await act(async () => { await expect(result.current.mutateAsync({ name: 'Math' })).rejects.toThrow(); });
  act(() => result.current.reset());
  await act(async () => { await result.current.mutateAsync({ name: 'Math' }); });
  const [first, second] = vi.mocked(createLibraryFolder).mock.calls;
  expect(first?.[0].operationKey).toEqual(expect.any(String));
  expect(second?.[0].operationKey).not.toBe(first?.[0].operationKey);
});
