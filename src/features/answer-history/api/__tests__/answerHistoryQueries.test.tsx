import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchOverviewBySubmission: vi.fn(),
}));

vi.mock('../../infrastructure/answerHistoryGateway', () => ({
  answerHistoryGateway: {
    fetchOverviewBySubmission: mocks.fetchOverviewBySubmission,
  },
}));

import {
  answerHistoryKeys,
  useAnswerHistoryOverviewBySubmission,
} from '../answerHistoryQueries';

describe('answer history queries', () => {
  it('loads overview data through the feature gateway and owns its query key', async () => {
    mocks.fetchOverviewBySubmission.mockResolvedValue({ attemptId: 'attempt-1' });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useAnswerHistoryOverviewBySubmission('submission-1'), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    await waitFor(() => expect(result.current.data).toEqual({ attemptId: 'attempt-1' }));

    expect(mocks.fetchOverviewBySubmission).toHaveBeenCalledWith('submission-1');
    expect(queryClient.getQueryData(answerHistoryKeys.overviewBySubmission('submission-1'))).toEqual({
      attemptId: 'attempt-1',
    });
  });
});
