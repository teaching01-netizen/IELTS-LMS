import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let liveUpdateHandler: ((event: { kind: string; id: string; revision: number; event: string }) => void) | null = null;

vi.mock('@shared/hooks/useLiveUpdates', () => ({
  useLiveUpdates: (options: { onEvent: (event: { kind: string; id: string; revision: number; event: string }) => void }) => {
    liveUpdateHandler = options.onEvent;
  },
}));

vi.mock('@app/hooks/useAsyncPolling', () => ({
  useAsyncPolling: () => {},
}));

import { useProctorRouteController } from '../useProctorRouteController';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function buildSchedule() {
  return {
    id: 'sched-1',
    examId: 'exam-1',
    examTitle: 'Mock Exam',
    publishedVersionId: 'ver-1',
    cohortName: 'Cohort A',
    institution: 'Center',
    startTime: '2026-01-01T09:00:00.000Z',
    endTime: '2026-01-01T12:00:00.000Z',
    plannedDurationMinutes: 180,
    deliveryMode: 'proctor_start',
    recurrenceType: 'none',
    recurrenceInterval: 1,
    autoStart: false,
    autoStop: false,
    status: 'live',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'admin-1',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 1,
  };
}

function buildRuntime() {
  return {
    id: 'runtime-1',
    scheduleId: 'sched-1',
    examId: 'exam-1',
    status: 'live',
    planSnapshot: [],
    actualStartAt: '2026-01-01T09:00:00.000Z',
    actualEndAt: null,
    activeSectionKey: 'reading',
    currentSectionKey: 'reading',
    currentSectionRemainingSeconds: 1200,
    waitingForNextSection: false,
    isOverrun: false,
    totalPausedSeconds: 0,
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt: '2026-01-01T09:00:00.000Z',
    revision: 1,
    sections: [
      {
        id: 'section-1',
        runtimeId: 'runtime-1',
        sectionKey: 'reading',
        label: 'Reading',
        sectionOrder: 2,
        plannedDurationMinutes: 60,
        gapAfterMinutes: 0,
        status: 'live',
        availableAt: '2026-01-01T09:00:00.000Z',
        actualStartAt: '2026-01-01T09:00:00.000Z',
        actualEndAt: null,
        pausedAt: null,
        accumulatedPausedSeconds: 0,
        extensionMinutes: 0,
        completionReason: null,
        projectedStartAt: '2026-01-01T09:00:00.000Z',
        projectedEndAt: '2026-01-01T10:00:00.000Z',
      },
    ],
  };
}

function buildDetail() {
  return {
    schedule: buildSchedule(),
    runtime: buildRuntime(),
    sessions: [
      {
        attemptId: 'attempt-1',
        studentId: 'alice',
        studentName: 'Alice Roe',
        studentEmail: 'alice@example.com',
        scheduleId: 'sched-1',
        status: 'warned',
        currentSection: 'reading',
        timeRemaining: 1200,
        runtimeStatus: 'live',
        runtimeCurrentSection: 'reading',
        runtimeTimeRemainingSeconds: 1200,
        runtimeSectionStatus: 'live',
        runtimeWaiting: false,
        violations: [],
        warnings: 1,
        lastActivity: '2026-01-01T09:03:00.000Z',
        examId: 'exam-1',
        examName: 'Mock Exam',
      },
    ],
    alerts: [
      {
        id: 'alert-1',
        severity: 'high',
        type: 'VIOLATION_DETECTED',
        studentName: 'Alice Roe',
        studentId: 'alice',
        timestamp: '2026-01-01T09:03:00.000Z',
        message: 'Tab switch detected.',
        isAcknowledged: false,
      },
    ],
    auditLogs: [],
    notes: [],
    presence: [],
    violationRules: [],
    degradedLiveMode: false,
  };
}

describe('useProctorRouteController live updates', () => {
  beforeEach(() => {
    liveUpdateHandler = null;
    localStorage.clear();
    sessionStorage.clear();
  });

  it('refreshes only the affected schedule detail for roster and alert websocket events', async () => {
    const fetchUrls: string[] = [];
    const originalFetch = global.fetch;

    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchUrls.push(url);

      if (url === '/api/v1/proctor/sessions') {
        return new Response(
          JSON.stringify({
            success: true,
            data: [
              {
                schedule: buildSchedule(),
                runtime: buildRuntime(),
                studentCount: 1,
                activeCount: 1,
                alertCount: 1,
                violationCount: 0,
                degradedLiveMode: false,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (url === '/api/v1/proctor/sessions/sched-1?mode=dashboard&auditLimit=200&alertLimit=100') {
        return new Response(
          JSON.stringify({
            success: true,
            data: buildDetail(),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      return new Response(JSON.stringify({ success: false, error: { message: `Unhandled ${url}` } }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const { result } = renderHook(() => useProctorRouteController(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      await waitFor(() => {
        expect(liveUpdateHandler).not.toBeNull();
      });

      const initialListCalls = fetchUrls.filter((url) => url === '/api/v1/proctor/sessions');
      const initialDetailCalls = fetchUrls.filter((url) =>
        url === '/api/v1/proctor/sessions/sched-1?mode=dashboard&auditLimit=200&alertLimit=100'
      );
      expect(initialListCalls).toHaveLength(1);
      expect(initialDetailCalls).toHaveLength(0);

      await act(async () => {
        result.current.setSelectedScheduleId('sched-1');
      });

      await waitFor(() => {
        const detailCalls = fetchUrls.filter((url) =>
          url === '/api/v1/proctor/sessions/sched-1?mode=dashboard&auditLimit=200&alertLimit=100'
        );
        expect(detailCalls).toHaveLength(1);
      });

      await act(async () => {
        liveUpdateHandler?.({
          kind: 'schedule_alert',
          id: 'sched-1',
          revision: 0,
          event: 'alert_changed',
        });
      });

      await waitFor(() => {
        const listCalls = fetchUrls.filter((url) => url === '/api/v1/proctor/sessions');
        const detailCalls = fetchUrls.filter((url) =>
          url === '/api/v1/proctor/sessions/sched-1?mode=dashboard&auditLimit=200&alertLimit=100'
        );
        expect(listCalls).toHaveLength(2);
        expect(detailCalls).toHaveLength(2);
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('a selected SAT room event refreshes the SAT summary family, not only the all-provider list (F5)', async () => {
    const fetchUrls: string[] = [];
    const originalFetch = global.fetch;
    const summary = [{ schedule: { ...buildSchedule(), providerKey: 'sat' }, runtime: buildRuntime(), studentCount: 1, activeCount: 1, degradedLiveMode: false }];
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchUrls.push(url);
      if (url === '/api/v1/proctor/sessions?providerKey=sat' || url === '/api/v1/proctor/sessions') {
        return new Response(JSON.stringify({ success: true, data: summary }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === '/api/v1/proctor/sessions/sched-1?mode=dashboard&auditLimit=200&alertLimit=100') {
        return new Response(JSON.stringify({ success: true, data: buildDetail() }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: false, error: { message: `Unhandled ${url}` } }), { status: 500, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    try {
      // Real QueryClient shared by a SAT room observer and an all-provider observer.
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
      const sat = renderHook(() => useProctorRouteController({ providerKey: 'sat', initialScheduleId: 'sched-1' }), { wrapper });
      const satHandler = await waitFor(() => {
        expect(liveUpdateHandler).not.toBeNull();
        return liveUpdateHandler!;
      });
      renderHook(() => useProctorRouteController(), { wrapper });

      await waitFor(() => {
        expect(sat.result.current.isLoading).toBe(false);
        expect(fetchUrls.filter((url) => url === '/api/v1/proctor/sessions')).toHaveLength(1);
      });
      const satListBefore = fetchUrls.filter((url) => url === '/api/v1/proctor/sessions?providerKey=sat').length;
      const detailBefore = fetchUrls.filter((url) => url.startsWith('/api/v1/proctor/sessions/sched-1')).length;

      await act(async () => {
        satHandler({ kind: 'schedule_alert', id: 'sched-1', revision: 0, event: 'alert_changed' });
      });

      await waitFor(() => {
        expect(fetchUrls.filter((url) => url === '/api/v1/proctor/sessions?providerKey=sat').length).toBe(satListBefore + 1);
        expect(fetchUrls.filter((url) => url.startsWith('/api/v1/proctor/sessions/sched-1')).length).toBe(detailBefore + 1);
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('surfaces a failed live refresh instead of swallowing it', async () => {
    const originalFetch = global.fetch;
    let failReads = false;
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (failReads) {
        // Non-retryable, so the test observes the propagated failure promptly.
        return new Response(JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'monitoring access revoked' } }), { status: 403, headers: { 'content-type': 'application/json' } });
      }
      if (url === '/api/v1/proctor/sessions') {
        return new Response(JSON.stringify({ success: true, data: [{ schedule: buildSchedule(), runtime: buildRuntime(), studentCount: 1, activeCount: 1, degradedLiveMode: false }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: true, data: buildDetail() }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    try {
      const { result } = renderHook(() => useProctorRouteController(), { wrapper: createWrapper() });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      failReads = true;
      await act(async () => {
        liveUpdateHandler?.({ kind: 'schedule_alert', id: 'sched-1', revision: 0, event: 'alert_changed' });
      });
      await waitFor(() => expect(result.current.error).toBeTruthy());
      // The last good snapshot stays on screen; the error is reported beside it.
      expect(result.current.schedules).toHaveLength(1);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
