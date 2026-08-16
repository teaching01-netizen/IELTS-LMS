import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  libraryKeys,
  useDeleteLibraryPassageMutation,
  useLibraryPassagesQuery,
} from '../libraryQueries';

const mockGetAllPassages = vi.fn();
const mockDeletePassage = vi.fn();

vi.mock('../../infrastructure/libraryGateway', () => ({
  libraryGateway: {
    passages: {
      getAll: (...args: unknown[]) => mockGetAllPassages(...args),
      delete: (...args: unknown[]) => mockDeletePassage(...args),
    },
  },
}));

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('content-library query boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllPassages.mockResolvedValue([]);
    mockDeletePassage.mockResolvedValue(true);
  });

  it('loads passages from the feature-owned query', async () => {
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useLibraryPassagesQuery(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
    expect(mockGetAllPassages).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(libraryKeys.passages())).toEqual([]);
  });

  it('invalidates passages after a successful deletion', async () => {
    const queryClient = createQueryClient();
    const list = renderHook(() => useLibraryPassagesQuery(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));

    const deletion = renderHook(() => useDeleteLibraryPassageMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await deletion.result.current.mutateAsync('passage-1');
    });

    await waitFor(() => expect(mockGetAllPassages).toHaveBeenCalledTimes(2));
    expect(mockDeletePassage).toHaveBeenCalledWith('passage-1');
  });
});
