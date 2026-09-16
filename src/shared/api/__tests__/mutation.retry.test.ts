import { createElement, type PropsWithChildren } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../apiClient';
import { createQueryClient } from '../queryClient';
import { useStartReview } from '../../../features/grading/api/gradingQueries';

const mockStartReview = vi.fn();

vi.mock('../../../features/grading/infrastructure/gradingGateway', () => ({
  gradingGateway: {
    service: {
      startReview: (...args: unknown[]) => mockStartReview(...args),
    },
  },
}));

function createWrapper(queryClient: ReturnType<typeof createQueryClient>) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('mutation retry policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not retry a grading mutation after a 429', async () => {
    const rateLimited = new ApiClientError({
      message: 'rate limited',
      statusCode: 429,
      backendCode: 'RATE_LIMIT_EXCEEDED',
      backendDetails: { retryAfterSeconds: 12, tier: 'writes' },
      backendRequestId: undefined,
    });
    mockStartReview.mockResolvedValue({ success: false, error: rateLimited });

    const client = createQueryClient();
    const hook = renderHook(() => useStartReview(), {
      wrapper: createWrapper(client),
    });

    await expect(hook.result.current.mutateAsync({
      submissionId: 'submission-1',
      teacherId: 'teacher-1',
      teacherName: 'Teacher',
    })).rejects.toMatchObject({ statusCode: 429 });

    expect(mockStartReview).toHaveBeenCalledTimes(1);
  });
});
