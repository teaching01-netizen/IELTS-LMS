import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  backendGet: vi.fn(),
}));

vi.mock('../../application/proctorFacade', () => ({
  proctorFacade: {
    backendGet: mocks.backendGet,
  },
}));

import { proctorKeys, useProctorSessionSummaries } from '../proctorQueries';

describe('proctor queries', () => {
  it('loads summaries through the feature gateway and owns its query key', async () => {
    mocks.backendGet.mockResolvedValue([
      {
        schedule: { id: 'schedule-1' },
        runtime: { scheduleId: 'schedule-1' },
        degradedLiveMode: false,
      },
    ]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useProctorSessionSummaries(0), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));

    expect(mocks.backendGet).toHaveBeenCalledWith('/v1/proctor/sessions');
    expect(queryClient.getQueryData(proctorKeys.sessions())).toHaveLength(1);
  });
});
