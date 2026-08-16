import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gradingKeys, useGradingSessions, useStartReview } from '../gradingQueries';

const mockGetSessionQueue = vi.fn();
const mockStartReview = vi.fn();

vi.mock('../../infrastructure/gradingGateway', () => ({
  gradingGateway: {
    service: {
      getSessionQueue: (...args: unknown[]) => mockGetSessionQueue(...args),
      startReview: (...args: unknown[]) => mockStartReview(...args),
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
