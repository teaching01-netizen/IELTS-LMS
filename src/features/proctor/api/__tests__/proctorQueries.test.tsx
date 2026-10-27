import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  backendGet: vi.fn(),
}));

vi.mock('../../application/proctorFacade', () => ({
  proctorFacade: {
    backendGet: mocks.backendGet,
  },
}));

import {
  fetchProctorSessionDetail,
  fetchProctorSessionSummaries,
  proctorKeys,
  useProctorSessionSummaries,
} from '../proctorQueries';

const schedule = {
  id: 'schedule-1',
  examId: 'exam-1',
  providerKey: 'ielts',
  publishedVersionId: 'ver-1',
  cohortName: 'Cohort A',
  startTime: '2026-01-01T09:00:00.000Z',
  endTime: '2026-01-01T12:00:00.000Z',
  status: 'live',
  revision: 2,
};

const runtime = {
  id: 'runtime-1',
  scheduleId: 'schedule-1',
  examId: 'exam-1',
  status: 'live',
  revision: 4,
  activeSectionKey: 'reading',
  currentSectionKey: 'reading',
  currentSectionRemainingSeconds: 600,
  currentSectionDeadlineAt: '2026-01-01T10:00:00.000Z',
  sections: [{ sectionKey: 'reading', status: 'live' }],
};

const summary = { schedule, runtime, studentCount: 1, activeCount: 1, degradedLiveMode: false };

const detail = {
  schedule,
  runtime,
  sessions: [{ attemptId: 'attempt-1', studentId: 'stu-1', studentName: 'Ana', scheduleId: 'schedule-1', status: 'active', violations: [] }],
  alerts: [],
  auditLogs: [],
  notes: [],
  presence: [],
  violationRules: [],
  degradedLiveMode: false,
};

afterEach(() => {
  mocks.backendGet.mockReset();
});

describe('proctor queries', () => {
  it('loads summaries through the feature gateway and owns its query key', async () => {
    mocks.backendGet.mockResolvedValue([summary]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useProctorSessionSummaries(0), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    await waitFor(() => expect(result.current.data).toHaveLength(1));

    expect(mocks.backendGet).toHaveBeenCalledWith('/v1/proctor/sessions', { signal: expect.any(AbortSignal) });
    expect(queryClient.getQueryData(proctorKeys.sessions())).toHaveLength(1);
  });

  it('cancels an obsolete summary read at the transport boundary', async () => {
    let seenSignal: AbortSignal | undefined;
    mocks.backendGet.mockImplementation((_endpoint: string, config?: { signal?: AbortSignal }) => {
      seenSignal = config?.signal;
      return new Promise(() => {});
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useProctorSessionSummaries(0, 'sat'), {
      wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(seenSignal).toBeDefined());

    await queryClient.cancelQueries({ queryKey: proctorKeys.sessions('sat') });
    expect(seenSignal?.aborted).toBe(true);
  });
});

describe('monitoring contract', () => {
  it('accepts additive server fields', async () => {
    mocks.backendGet.mockResolvedValue([{ ...summary, newServerField: 1, schedule: { ...schedule, satTimingModel: 'x' } }]);
    await expect(fetchProctorSessionSummaries()).resolves.toHaveLength(1);
  });

  it('rejects a malformed summary instead of rendering it', async () => {
    mocks.backendGet.mockResolvedValue([{ ...summary, runtime: { ...runtime, revision: 'four' } }]);
    await expect(fetchProctorSessionSummaries()).rejects.toThrow(/revision/);
  });

  it('rejects a summary that pairs a runtime with another schedule', async () => {
    mocks.backendGet.mockResolvedValue([{ ...summary, runtime: { ...runtime, scheduleId: 'schedule-2' } }]);
    await expect(fetchProctorSessionSummaries()).rejects.toThrow('different schedule');
  });

  it('rejects a detail payload for a different room', async () => {
    mocks.backendGet.mockResolvedValue(detail);
    await expect(fetchProctorSessionDetail('schedule-2')).rejects.toThrow('different room');
  });

  it('rejects a roster row from another room', async () => {
    mocks.backendGet.mockResolvedValue({
      ...detail,
      sessions: [{ ...detail.sessions[0], scheduleId: 'schedule-9' }],
    });
    await expect(fetchProctorSessionDetail('schedule-1')).rejects.toThrow('different room');
  });

  it('forwards the read signal for room detail', async () => {
    mocks.backendGet.mockResolvedValue(detail);
    const controller = new AbortController();
    await fetchProctorSessionDetail('schedule-1', controller.signal);
    expect(mocks.backendGet).toHaveBeenCalledWith(expect.stringContaining('/v1/proctor/sessions/schedule-1'), { signal: controller.signal });
  });
});
