import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gradingKeys, useGradingSessions, useSessionSubmissions, useStartReview } from '../gradingQueries';

const mockGetSessionQueue = vi.fn();
const mockStartReview = vi.fn();
const mockGetSessionStudentSubmissions = vi.fn();

vi.mock('../../infrastructure/gradingGateway', async () => ({
  filterStudentSubmissions: (await import('../../../../services/gradingFilters')).filterStudentSubmissions,
  gradingGateway: {
    service: {
      getSessionQueue: (...args: unknown[]) => mockGetSessionQueue(...args),
      startReview: (...args: unknown[]) => mockStartReview(...args),
      getSessionStudentSubmissions: (...args: unknown[]) => mockGetSessionStudentSubmissions(...args),
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

describe('grading query boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionQueue.mockResolvedValue({ success: true, data: [] });
    mockStartReview.mockResolvedValue({
      success: true,
      data: { submissionId: 'submission-1' },
    });
  });

  it('loads the session queue from the feature-owned API', async () => {
    const queryClient = createQueryClient();
    const { result } = renderHook(() => useGradingSessions(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
    expect(mockGetSessionQueue).toHaveBeenCalledWith();
    expect(queryClient.getQueryData(gradingKeys.sessions())).toEqual([]);
  });

  it('invalidates the selected submission after starting a review', async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(gradingKeys.submission('submission-1'), { stale: false });
    const review = renderHook(() => useStartReview(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await review.result.current.mutateAsync({
        submissionId: 'submission-1',
        teacherId: 'teacher-1',
        teacherName: 'Teacher',
      });
    });

    expect(mockStartReview).toHaveBeenCalledWith('submission-1', 'teacher-1', 'Teacher');
    expect(queryClient.getQueryState(gradingKeys.submission('submission-1'))?.isInvalidated).toBe(true);
  });
});

describe('session submissions with local filters (F7)', () => {
  const submissions = [
    { id: 's-1', studentName: 'Alice', gradingStatus: 'submitted', isFlagged: false, isOverdue: false },
    { id: 's-2', studentName: 'Bob', gradingStatus: 'released', isFlagged: true, isOverdue: false },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    // The service filters client-side; the cache must hold the unfiltered list.
    mockGetSessionStudentSubmissions.mockImplementation(async (_sessionId: string, filters?: { status?: string[] }) => ({
      success: true,
      data: filters?.status ? submissions.filter((row) => filters.status!.includes(row.gradingStatus)) : submissions,
    }));
  });

  it('gives each observer its own filtered view while the cache keeps every submission', async () => {
    const queryClient = createQueryClient();
    const wrapper = createWrapper(queryClient);
    const pending = renderHook(() => useSessionSubmissions('session-1', { status: ['submitted'] }), { wrapper });
    await waitFor(() => expect(pending.result.current.isSuccess).toBe(true));
    const released = renderHook(() => useSessionSubmissions('session-1', { status: ['released'] }), { wrapper });
    await waitFor(() => expect(released.result.current.isSuccess).toBe(true));
    const all = renderHook(() => useSessionSubmissions('session-1'), { wrapper });
    await waitFor(() => expect(all.result.current.isSuccess).toBe(true));

    expect(pending.result.current.data?.map((row) => row.id)).toEqual(['s-1']);
    expect(released.result.current.data?.map((row) => row.id)).toEqual(['s-2']);
    expect(all.result.current.data?.map((row) => row.id)).toEqual(['s-1', 's-2']);
    expect((queryClient.getQueryData(gradingKeys.submissions('session-1')) as unknown[]).length).toBe(2);
    // Within the stale window the observers share one request.
    expect(mockGetSessionStudentSubmissions).toHaveBeenCalledTimes(1);
  });

  it('rerendering with a new filter inside the stale window shows the new filter', async () => {
    const queryClient = createQueryClient();
    const view = renderHook(({ status }) => useSessionSubmissions('session-1', { status }), {
      wrapper: createWrapper(queryClient),
      initialProps: { status: ['submitted'] as Array<'submitted' | 'released'> },
    });
    await waitFor(() => expect(view.result.current.data?.map((row) => row.id)).toEqual(['s-1']));
    view.rerender({ status: ['released'] });
    await waitFor(() => expect(view.result.current.data?.map((row) => row.id)).toEqual(['s-2']));
  });
});
