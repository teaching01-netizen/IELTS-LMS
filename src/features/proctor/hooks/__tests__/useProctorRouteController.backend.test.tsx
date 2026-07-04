import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { examDeliveryService } from '@services/examDeliveryService';
import { useProctorRouteController } from '../useProctorRouteController';

const originalFetch = global.fetch;

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function jsonFailure(message: string) {
  return new Response(JSON.stringify({ success: false, error: { message } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

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

function buildSchedule2() {
  return {
    ...buildSchedule(),
    id: 'sched-2',
    examId: 'exam-2',
    examTitle: 'Mock Exam 2',
    publishedVersionId: 'ver-2',
    cohortName: 'Cohort B',
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

function buildRuntime2() {
  return {
    ...buildRuntime(),
    id: 'runtime-2',
    scheduleId: 'sched-2',
    examId: 'exam-2',
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
        violations: [
          {
            id: 'warning-1',
            type: 'PROCTOR_WARNING',
            severity: 'medium',
            timestamp: '2026-01-01T09:01:00.000Z',
            description: 'Please keep your eyes on the screen.',
          },
        ],
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
    auditLogs: [
      {
        id: 'audit-1',
        scheduleId: 'sched-1',
        actor: 'student-system',
        actionType: 'VIOLATION_DETECTED',
        targetStudentId: 'attempt-1',
        payload: {
          message: 'Tab switch detected.',
          severity: 'high',
        },
        acknowledgedAt: null,
        acknowledgedBy: null,
        createdAt: '2026-01-01T09:03:00.000Z',
      },
    ],
    notes: [
      {
        id: 'note-1',
        scheduleId: 'sched-1',
        author: 'Proctor',
        category: 'incident',
        content: 'Monitoring closely.',
        isResolved: false,
        createdAt: '2026-01-01T09:04:00.000Z',
        updatedAt: '2026-01-01T09:04:00.000Z',
      },
    ],
    presence: [],
    violationRules: [
      {
        id: 'rule-1',
        scheduleId: 'sched-1',
        triggerType: 'violation_count',
        threshold: 1,
        specificViolationType: null,
        specificSeverity: null,
        action: 'warn',
        isEnabled: true,
        createdAt: '2026-01-01T09:00:00.000Z',
        createdBy: 'Admin',
      },
    ],
    degradedLiveMode: true,
  };
}

function buildDetail2() {
  const detail = buildDetail();
  return {
    ...detail,
    schedule: buildSchedule2(),
    runtime: buildRuntime2(),
    sessions: detail.sessions.map((session) => ({
      ...session,
      attemptId: 'attempt-2',
      studentId: 'bob',
      studentName: 'Bob Roe',
      studentEmail: 'bob@example.com',
      scheduleId: 'sched-2',
      examId: 'exam-2',
      examName: 'Mock Exam 2',
    })),
    alerts: [],
    auditLogs: [],
    notes: [],
    violationRules: [],
  };
}

describe('useProctorRouteController backend mode', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('polls summaries for all schedules but fetches detail only for the selected schedule', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_PROCTORING', 'true');
    const fetchMock = vi
      .fn()
      .mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/v1/proctor/sessions') {
          return jsonResponse([
            {
              schedule: buildSchedule(),
              runtime: buildRuntime(),
              studentCount: 1,
              activeCount: 1,
              alertCount: 1,
              violationCount: 0,
              degradedLiveMode: false,
            },
            {
              schedule: buildSchedule2(),
              runtime: buildRuntime2(),
              studentCount: 1,
              activeCount: 1,
              alertCount: 0,
              violationCount: 0,
              degradedLiveMode: false,
            },
          ]);
        }

        if (url === '/api/v1/proctor/sessions/sched-1?mode=dashboard&auditLimit=200&alertLimit=100') {
          return jsonResponse(buildDetail());
        }

        if (url === '/api/v1/proctor/sessions/sched-2?mode=dashboard&auditLimit=200&alertLimit=100') {
          return jsonResponse(buildDetail2());
        }

        return jsonFailure(`Unhandled ${url}`);
      });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useProctorRouteController(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.schedules).toHaveLength(2);
    });

    const sched1DetailCalls = fetchMock.mock.calls.filter(
      ([url]) => url === '/api/v1/proctor/sessions/sched-1?mode=dashboard&auditLimit=200&alertLimit=100',
    );
    const sched2DetailCalls = fetchMock.mock.calls.filter(
      ([url]) => url === '/api/v1/proctor/sessions/sched-2?mode=dashboard&auditLimit=200&alertLimit=100',
    );

    expect(sched1DetailCalls).toHaveLength(0);
    expect(sched2DetailCalls).toHaveLength(0);

    await act(async () => {
      result.current.setSelectedScheduleId('sched-2');
    });

    await waitFor(() => {
      const nextSched2Calls = fetchMock.mock.calls.filter(
        ([url]) =>
          url === '/api/v1/proctor/sessions/sched-2?mode=dashboard&auditLimit=200&alertLimit=100',
      );
      expect(nextSched2Calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('defaults to all-cohorts view and keeps it when selection is cleared manually', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_PROCTORING', 'true');
    const fetchMock = vi
      .fn()
      .mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/v1/proctor/sessions') {
          return jsonResponse([
            {
              schedule: buildSchedule(),
              runtime: buildRuntime(),
              studentCount: 1,
              activeCount: 1,
              alertCount: 1,
              violationCount: 0,
              degradedLiveMode: false,
            },
            {
              schedule: buildSchedule2(),
              runtime: buildRuntime2(),
              studentCount: 1,
              activeCount: 1,
              alertCount: 0,
              violationCount: 0,
              degradedLiveMode: false,
            },
          ]);
        }

        if (url === '/api/v1/proctor/sessions/sched-1?mode=dashboard&auditLimit=200&alertLimit=100') {
          return jsonResponse(buildDetail());
        }

        if (url === '/api/v1/proctor/sessions/sched-2?mode=dashboard&auditLimit=200&alertLimit=100') {
          return jsonResponse(buildDetail2());
        }

        return jsonFailure(`Unhandled ${url}`);
      });
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useProctorRouteController(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.selectedScheduleId).toBeNull();
    });

    const sched1DetailCallsBeforeSelection = fetchMock.mock.calls.filter(
      ([url]) => url === '/api/v1/proctor/sessions/sched-1?mode=dashboard&auditLimit=200&alertLimit=100',
    );
    expect(sched1DetailCallsBeforeSelection).toHaveLength(0);

    await act(async () => {
      await result.current.reload();
    });

    await waitFor(() => {
      expect(result.current.selectedScheduleId).toBeNull();
    });

    await act(async () => {
      result.current.setSelectedScheduleId('sched-2');
    });

    await waitFor(() => {
      const sched2DetailCalls = fetchMock.mock.calls.filter(
        ([url]) =>
          url === '/api/v1/proctor/sessions/sched-2?mode=dashboard&auditLimit=200&alertLimit=100',
      );
      expect(sched2DetailCalls.length).toBeGreaterThanOrEqual(1);
    });

    await act(async () => {
      result.current.setSelectedScheduleId(null);
    });

    await waitFor(() => {
      expect(result.current.selectedScheduleId).toBeNull();
    });
  });

  it('keeps completed and cancelled summaries hydrated for the overview Past bucket', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_PROCTORING', 'true');
    const completedSchedule = {
      ...buildSchedule(),
      id: 'sched-completed',
      status: 'completed',
      cohortName: 'Completed Cohort',
    };
    const cancelledSchedule = {
      ...buildSchedule2(),
      id: 'sched-cancelled',
      status: 'cancelled',
      cohortName: 'Cancelled Cohort',
    };
    const completedRuntime = {
      ...buildRuntime(),
      id: 'runtime-completed',
      scheduleId: 'sched-completed',
      status: 'completed',
      actualEndAt: '2026-01-01T12:00:00.000Z',
      activeSectionKey: null,
      currentSectionKey: null,
      currentSectionRemainingSeconds: 0,
      sections: buildRuntime().sections.map((section) => ({ ...section, status: 'completed' })),
    };
    const cancelledRuntime = {
      ...buildRuntime2(),
      id: 'runtime-cancelled',
      scheduleId: 'sched-cancelled',
      status: 'cancelled',
      actualEndAt: '2026-01-01T12:00:00.000Z',
      activeSectionKey: null,
      currentSectionKey: null,
      currentSectionRemainingSeconds: 0,
      sections: buildRuntime2().sections.map((section) => ({
        ...section,
        runtimeId: 'runtime-cancelled',
        status: 'completed',
        completionReason: 'cancelled',
      })),
    };
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          schedule: completedSchedule,
          runtime: completedRuntime,
          studentCount: 2,
          activeCount: 0,
          alertCount: 0,
          violationCount: 1,
          degradedLiveMode: false,
        },
        {
          schedule: cancelledSchedule,
          runtime: cancelledRuntime,
          studentCount: 3,
          activeCount: 0,
          alertCount: 0,
          violationCount: 0,
          degradedLiveMode: false,
        },
      ]),
    );
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useProctorRouteController(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.schedules.map((schedule) => schedule.status)).toEqual(['completed', 'cancelled']);
    });

    expect(result.current.runtimeSnapshots.map((runtime) => runtime.status)).toEqual(['completed', 'cancelled']);
    expect(result.current.scheduleMetrics).toMatchObject({
      'sched-completed': { studentCount: 2, activeCount: 0, violationCount: 1 },
      'sched-cancelled': { studentCount: 3, activeCount: 0, violationCount: 0 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/proctor/sessions',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('hydrates roster, alerts, and audit data through the backend proctor endpoints', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_PROCTORING', 'true');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([
          {
            schedule: buildSchedule(),
            runtime: buildRuntime(),
            studentCount: 1,
            activeCount: 1,
            alertCount: 1,
            degradedLiveMode: true,
          },
        ]),
      )
      .mockResolvedValue(jsonResponse(buildDetail()));
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useProctorRouteController(), { wrapper: createWrapper() });
    await act(async () => {
      result.current.setSelectedScheduleId('sched-1');
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.sessions).toHaveLength(1);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.schedules[0]).toMatchObject({
      id: 'sched-1',
      examTitle: 'Mock Exam',
    });
    expect(result.current.runtimeSnapshots[0]).toMatchObject({
      scheduleId: 'sched-1',
      status: 'live',
    });
    expect(result.current.sessions[0]).toMatchObject({
      id: 'attempt-1',
      studentId: 'alice',
      status: 'warned',
      warnings: 1,
    });
    expect(result.current.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          studentId: 'alice',
          severity: 'high',
          message: 'Tab switch detected.',
        }),
      ]),
    );
    expect(result.current.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'audit-1',
          sessionId: 'sched-1',
          actionType: 'VIOLATION_DETECTED',
        }),
      ]),
    );
    expect(result.current.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'note-1',
          scheduleId: 'sched-1',
          category: 'incident',
        }),
      ]),
    );
    expect(result.current.violationRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'rule-1',
          threshold: 1,
          action: 'warn',
        }),
      ]),
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/proctor/sessions',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/proctor/sessions/sched-1?mode=dashboard&auditLimit=200&alertLimit=100',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('evaluates enabled violation rules, dispatches actions, and reloads monitoring state (happy path)', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_PROCTORING', 'true');

    const detail = buildDetail();
    detail.sessions[0] = {
      ...detail.sessions[0],
      violations: [
        {
          id: 'violation-1',
          type: 'TAB_SWITCH',
          severity: 'high',
          timestamp: '2026-01-01T09:01:00.000Z',
          description: 'Tab switch detected.',
        },
      ],
    };
    detail.violationRules = [
      {
        id: 'rule-warn',
        scheduleId: 'sched-1',
        triggerType: 'violation_count',
        threshold: 1,
        specificViolationType: null,
        specificSeverity: null,
        action: 'warn',
        isEnabled: true,
        createdAt: '2026-01-01T09:00:00.000Z',
        createdBy: 'Admin',
      },
      {
        id: 'rule-pause',
        scheduleId: 'sched-1',
        triggerType: 'specific_violation_type',
        threshold: 1,
        specificViolationType: 'TAB_SWITCH',
        specificSeverity: null,
        action: 'pause',
        isEnabled: true,
        createdAt: '2026-01-01T09:00:00.000Z',
        createdBy: 'Admin',
      },
      {
        id: 'rule-terminate',
        scheduleId: 'sched-1',
        triggerType: 'severity_threshold',
        threshold: 1,
        specificViolationType: null,
        specificSeverity: 'high',
        action: 'terminate',
        isEnabled: true,
        createdAt: '2026-01-01T09:00:00.000Z',
        createdBy: 'Admin',
      },
      {
        id: 'rule-notify',
        scheduleId: 'sched-1',
        triggerType: 'violation_count',
        threshold: 1,
        specificViolationType: null,
        specificSeverity: null,
        action: 'notify_proctor',
        isEnabled: true,
        createdAt: '2026-01-01T09:00:00.000Z',
        createdBy: 'Admin',
      },
    ];

    const summaries = [
      {
        schedule: buildSchedule(),
        runtime: buildRuntime(),
        studentCount: 1,
        activeCount: 1,
        alertCount: 1,
        degradedLiveMode: false,
      },
    ];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(summaries))
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse(summaries))
      .mockResolvedValueOnce(jsonResponse(detail));
    global.fetch = fetchMock as typeof fetch;

    const warnSpy = vi
      .spyOn(examDeliveryService, 'warnStudent')
      .mockResolvedValue({ success: true });
    const pauseSpy = vi
      .spyOn(examDeliveryService, 'pauseStudentAttempt')
      .mockResolvedValue({ success: true });
    const terminateSpy = vi
      .spyOn(examDeliveryService, 'terminateStudentAttempt')
      .mockResolvedValue({ success: true });

    const { result } = renderHook(() => useProctorRouteController(), { wrapper: createWrapper() });
    await act(async () => {
      result.current.setSelectedScheduleId('sched-1');
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.sessions).toHaveLength(1);
      expect(result.current.violationRules).toHaveLength(4);
    });

    await act(async () => {
      await result.current.evaluateViolationRules('sched-1', result.current.sessions);
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'attempt-1',
      'Auto-warning triggered by violation_count',
      'system',
    );
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(pauseSpy).toHaveBeenCalledWith('attempt-1', 'system');
    expect(terminateSpy).toHaveBeenCalledTimes(1);
    expect(terminateSpy).toHaveBeenCalledWith('attempt-1', 'system');
    await waitFor(() => {
      expect(result.current.alerts.some((alert) => alert.type === 'RULE_NOTIFY_PROCTOR')).toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/proctor/sessions',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/v1/proctor/sessions/sched-1?mode=dashboard&auditLimit=200&alertLimit=100',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('skips evaluation and avoids reload when no enabled rules exist (worst case)', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_PROCTORING', 'true');

    const detail = buildDetail();
    detail.violationRules = [
      {
        id: 'rule-disabled',
        scheduleId: 'sched-1',
        triggerType: 'violation_count',
        threshold: 1,
        specificViolationType: null,
        specificSeverity: null,
        action: 'warn',
        isEnabled: false,
        createdAt: '2026-01-01T09:00:00.000Z',
        createdBy: 'Admin',
      },
    ];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([
          {
            schedule: buildSchedule(),
            runtime: buildRuntime(),
            studentCount: 1,
            activeCount: 1,
            alertCount: 0,
            degradedLiveMode: false,
          },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse(detail));
    global.fetch = fetchMock as typeof fetch;

    const warnSpy = vi
      .spyOn(examDeliveryService, 'warnStudent')
      .mockResolvedValue({ success: true });
    const pauseSpy = vi
      .spyOn(examDeliveryService, 'pauseStudentAttempt')
      .mockResolvedValue({ success: true });
    const terminateSpy = vi
      .spyOn(examDeliveryService, 'terminateStudentAttempt')
      .mockResolvedValue({ success: true });

    const { result } = renderHook(() => useProctorRouteController(), { wrapper: createWrapper() });
    await act(async () => {
      result.current.setSelectedScheduleId('sched-1');
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.sessions).toHaveLength(1);
    });

    await act(async () => {
      await result.current.evaluateViolationRules('sched-1', result.current.sessions);
    });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(pauseSpy).not.toHaveBeenCalled();
    expect(terminateSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reloads state even when thresholds are not met, without dispatching actions (worst case)', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_PROCTORING', 'true');

    const detail = buildDetail();
    detail.violationRules = [
      {
        id: 'rule-high-threshold',
        scheduleId: 'sched-1',
        triggerType: 'violation_count',
        threshold: 2,
        specificViolationType: null,
        specificSeverity: null,
        action: 'warn',
        isEnabled: true,
        createdAt: '2026-01-01T09:00:00.000Z',
        createdBy: 'Admin',
      },
    ];

    const summaries = [
      {
        schedule: buildSchedule(),
        runtime: buildRuntime(),
        studentCount: 1,
        activeCount: 1,
        alertCount: 0,
        degradedLiveMode: false,
      },
    ];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(summaries))
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse(summaries))
      .mockResolvedValueOnce(jsonResponse(detail));
    global.fetch = fetchMock as typeof fetch;

    const warnSpy = vi
      .spyOn(examDeliveryService, 'warnStudent')
      .mockResolvedValue({ success: true });

    const { result } = renderHook(() => useProctorRouteController(), { wrapper: createWrapper() });
    await act(async () => {
      result.current.setSelectedScheduleId('sched-1');
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.sessions).toHaveLength(1);
    });

    await act(async () => {
      await result.current.evaluateViolationRules('sched-1', result.current.sessions);
    });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('ignores failed session detail fetches and still hydrates schedule summaries (worst case)', async () => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_PROCTORING', 'true');

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([
          {
            schedule: buildSchedule(),
            runtime: buildRuntime(),
            studentCount: 1,
            activeCount: 1,
            alertCount: 0,
            degradedLiveMode: false,
          },
        ]),
      )
      .mockResolvedValueOnce(jsonFailure('detail down'));
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useProctorRouteController(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.schedules).toHaveLength(1);
    expect(result.current.runtimeSnapshots).toHaveLength(1);
    expect(result.current.sessions).toHaveLength(0);
    expect(result.current.alerts).toHaveLength(0);
    expect(result.current.auditLogs).toHaveLength(0);
    expect(result.current.notes).toHaveLength(0);
    expect(result.current.violationRules).toHaveLength(0);
  });
});
