import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let liveUpdateHandler: ((event: { kind: string; id: string; revision: number; event: string }) => void) | null = null;

vi.mock('@app/hooks/useLiveUpdates', () => ({
  useLiveUpdates: (options: { onEvent: (event: { kind: string; id: string; revision: number; event: string }) => void }) => {
    liveUpdateHandler = options.onEvent;
  },
}));

vi.mock('@app/hooks/useAsyncPolling', () => ({
  useAsyncPolling: () => {},
}));

import { useProctorRouteController } from '../useProctorRouteController';

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

      if (url === '/api/v1/proctor/sessions/sched-1') {
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
      const { result } = renderHook(() => useProctorRouteController());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
      await waitFor(() => {
        expect(liveUpdateHandler).not.toBeNull();
      });

      const initialListCalls = fetchUrls.filter((url) => url === '/api/v1/proctor/sessions');
      const initialDetailCalls = fetchUrls.filter((url) => url === '/api/v1/proctor/sessions/sched-1');
      expect(initialListCalls).toHaveLength(1);
      expect(initialDetailCalls).toHaveLength(1);

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
        const detailCalls = fetchUrls.filter((url) => url === '/api/v1/proctor/sessions/sched-1');
        expect(listCalls).toHaveLength(1);
        expect(detailCalls).toHaveLength(2);
      });
    } finally {
      global.fetch = originalFetch;
    }
  });
});
