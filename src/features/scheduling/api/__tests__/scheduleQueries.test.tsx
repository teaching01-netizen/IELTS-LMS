import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleKeys, useSaveScheduleMutation, useScheduleListQuery } from '../scheduleQueries';

const mockGetAllSchedules = vi.fn();
const mockSaveSchedule = vi.fn();

vi.mock('../../infrastructure/schedulingGateway', () => ({
  schedulingGateway: {
    repository: {
      getAllSchedules: (...args: unknown[]) => mockGetAllSchedules(...args),
      saveSchedule: (...args: unknown[]) => mockSaveSchedule(...args),
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

describe('scheduling query boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllSchedules.mockResolvedValue([]);
    mockSaveSchedule.mockResolvedValue(undefined);
  });

  it('loads schedules from the feature-owned list query', async () => {
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useScheduleListQuery(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
    expect(mockGetAllSchedules).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(scheduleKeys.list())).toEqual([]);
  });

  it('invalidates the list after saving a schedule', async () => {
    const queryClient = createQueryClient();
    const list = renderHook(() => useScheduleListQuery(), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));

    const save = renderHook(() => useSaveScheduleMutation(), {
      wrapper: createWrapper(queryClient),
    });
    const schedule = {
      id: 'schedule-1',
    } as Parameters<typeof save.result.current.mutateAsync>[0];

    await act(async () => {
      await save.result.current.mutateAsync(schedule);
    });

    await waitFor(() => expect(mockGetAllSchedules).toHaveBeenCalledTimes(2));
    expect(mockSaveSchedule).toHaveBeenCalledWith(schedule);
  });
});
