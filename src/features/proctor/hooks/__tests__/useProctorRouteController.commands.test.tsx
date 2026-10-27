import { act, renderHook, waitFor } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { examDeliveryService } from '@services/examDeliveryService';
import { examRepository } from '@services/examRepository';
import { proctorKeys } from '../../api/proctorQueries';
import { proctorMutations } from '../../api/proctorMutations';

vi.mock('@shared/hooks/useLiveUpdates', () => ({ useLiveUpdates: () => {} }));
vi.mock('@app/hooks/useAsyncPolling', () => ({ useAsyncPolling: () => {} }));

import { useProctorRouteController } from '../useProctorRouteController';

const originalFetch = global.fetch;
const SUMMARIES_URL = '/api/v1/proctor/sessions';
const DETAIL_URL = '/api/v1/proctor/sessions/sched-1?mode=dashboard&auditLimit=200&alertLimit=100';

const schedule = {
  id: 'sched-1', examId: 'exam-1', examTitle: 'Mock Exam', publishedVersionId: 'ver-1', cohortName: 'Cohort A',
  institution: 'Center', startTime: '2026-01-01T09:00:00.000Z', endTime: '2026-01-01T12:00:00.000Z',
  plannedDurationMinutes: 180, deliveryMode: 'proctor_start', recurrenceType: 'none', recurrenceInterval: 1,
  autoStart: false, autoStop: false, status: 'live', createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'admin-1',
  updatedAt: '2026-01-01T00:00:00.000Z', revision: 1,
};
const runtime = {
  id: 'runtime-1', scheduleId: 'sched-1', examId: 'exam-1', status: 'live', planSnapshot: [],
  actualStartAt: '2026-01-01T09:00:00.000Z', actualEndAt: null, activeSectionKey: 'reading', currentSectionKey: 'reading',
  currentSectionRemainingSeconds: 1200, waitingForNextSection: false, isOverrun: false, totalPausedSeconds: 0,
  createdAt: '2026-01-01T09:00:00.000Z', updatedAt: '2026-01-01T09:00:00.000Z', revision: 1, sections: [],
};
const session = {
  attemptId: 'attempt-1', studentId: 'alice', studentName: 'Alice Roe', studentEmail: 'alice@example.com',
  scheduleId: 'sched-1', status: 'active', currentSection: 'reading', timeRemaining: 1200, runtimeStatus: 'live',
  runtimeCurrentSection: 'reading', runtimeTimeRemainingSeconds: 1200, runtimeCurrentModuleId: 'module-1',
  runtimeSectionStatus: 'live', runtimeWaiting: false, violations: [], warnings: 0,
  lastActivity: '2026-01-01T09:03:00.000Z', examId: 'exam-1', examName: 'Mock Exam',
};
const alert = {
  id: 'alert-1', severity: 'high', type: 'VIOLATION_DETECTED', studentName: 'Alice Roe', studentId: 'alice',
  timestamp: '2026-01-01T09:03:00.000Z', message: 'Tab switch detected.', isAcknowledged: false,
};
const note = {
  id: 'note-1', scheduleId: 'sched-1', author: 'Proctor', category: 'incident', content: 'Monitoring closely.',
  isResolved: false, createdAt: '2026-01-01T09:04:00.000Z', updatedAt: '2026-01-01T09:04:00.000Z',
};

type Detail = Record<string, unknown>;
const detail = (overrides: Detail = {}): Detail => ({
  schedule, runtime, sessions: [session], alerts: [alert], auditLogs: [], notes: [note], presence: [],
  violationRules: [], degradedLiveMode: false, ...overrides,
});

function ok(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
}

/** A backend whose room detail the test can change, recording every request. */
function installBackend(initial: Detail) {
  const server = {
    detail: initial,
    ackStatus: 200,
    summaryStatus: 200,
    summaries: [{ schedule, runtime, studentCount: 1, activeCount: 1, alertCount: 1, violationCount: 0, degradedLiveMode: false }],
    otherDetails: {} as Record<string, Detail>,
    nextDetailResponse: null as Promise<Detail> | null,
  };
  const calls: Array<{ url: string; method: string }> = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    if (url === SUMMARIES_URL) {
      if (server.summaryStatus !== 200) return new Response('Unavailable', { status: server.summaryStatus });
      return ok(server.summaries);
    }
    if (url === DETAIL_URL) {
      const pending = server.nextDetailResponse;
      server.nextDetailResponse = null;
      return ok(pending ? await pending : server.detail);
    }
    const otherRoom = Object.keys(server.otherDetails).find((id) => url === `/api/v1/proctor/sessions/${id}?mode=dashboard&auditLimit=200&alertLimit=100`);
    if (otherRoom) return ok(server.otherDetails[otherRoom]);
    if (url.startsWith('/api/v1/proctor/alerts/') && method === 'POST') {
      return server.ackStatus === 200
        ? ok({})
        : new Response(JSON.stringify({ success: false, error: { message: 'Not allowed' } }), {
          status: server.ackStatus, headers: { 'content-type': 'application/json' },
        });
    }
    return new Response(JSON.stringify({ success: false, error: { message: `Unhandled ${url}` } }), { status: 404 });
  }) as typeof fetch;
  const detailReads = () => calls.filter((call) => call.url === DETAIL_URL).length;
  return { server, calls, detailReads };
}

function renderController() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => useProctorRouteController({ initialScheduleId: 'sched-1' }), { wrapper }), queryClient };
}

async function renderLoadedRoom() {
  const view = renderController();
  await waitFor(() => {
    expect(view.result.current.sessions).toHaveLength(1);
    expect(view.result.current.notes).toHaveLength(1);
  });
  return view;
}

describe('proctor commands', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_FEATURE_USE_BACKEND_PROCTORING', 'true');
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('acknowledges an alert on the server and keeps it acknowledged when a delayed read still lists it', async () => {
    const backend = installBackend(detail());
    const { result } = await renderLoadedRoom();
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.commands.acknowledgeAlerts('sched-1', ['alert-1'], true);
    });

    expect(outcome).toEqual({ kind: 'confirmed' });
    expect(backend.calls.filter((call) => call.method === 'POST')).toEqual([
      { url: '/api/v1/proctor/alerts/alert-1/ack', method: 'POST' },
    ]);
    // A replica read that predates the acknowledgement must not re-open it.
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.alerts.find((row) => row.id === 'alert-1')?.isAcknowledged).toBe(true);
  });

  it('rolls an acknowledgement back when the server refuses it', async () => {
    const backend = installBackend(detail());
    backend.server.ackStatus = 403;
    const { result } = await renderLoadedRoom();
    await waitFor(() => expect(result.current.alerts).toHaveLength(1));

    let outcome: { kind: string } | undefined;
    await act(async () => {
      outcome = await result.current.commands.acknowledgeAlerts('sched-1', ['alert-1'], true);
    });

    expect(outcome?.kind).toBe('rejected');
    await waitFor(() => expect(result.current.alerts.find((row) => row.id === 'alert-1')?.isAcknowledged).toBe(false));
  });

  it('shares a confirmed alert acknowledgement even when the server window is full', async () => {
    const otherAlerts = Array.from({ length: 99 }, (_, index) => ({ ...alert, id: `other-${index}` }));
    const backend = installBackend(detail({ alerts: [alert, ...otherAlerts] }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => [
      useProctorRouteController({ initialScheduleId: 'sched-1' }),
      useProctorRouteController({ initialScheduleId: 'sched-1' }),
    ] as const, { wrapper });
    await waitFor(() => expect(result.current.every((controller) => controller.alerts.length === 100)).toBe(true));

    // In a full unacknowledged window, an omitted alert could also have been
    // pushed out by a newer one. The confirmed command supplies the missing fact.
    backend.server.detail = detail({ alerts: [{ ...alert, id: 'new-alert' }, ...otherAlerts] });
    await act(async () => {
      await result.current[0].commands.acknowledgeAlerts('sched-1', ['alert-1'], true);
    });
    await waitFor(() => {
      for (const controller of result.current) {
        expect(controller.alerts.find((row) => row.id === 'alert-1')?.isAcknowledged).toBe(true);
      }
    });
  });

  it('reconciles an unanswered student command by reading the room, never by resending it', async () => {
    const backend = installBackend(detail());
    const warn = vi.spyOn(examDeliveryService, 'warnStudent').mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = await renderLoadedRoom();
    const readsBefore = backend.detailReads();

    let outcome: { kind: string } | undefined;
    await act(async () => {
      outcome = await result.current.commands.studentAction(result.current.sessions[0]!, 'warn', 'Proctor');
    });

    expect(outcome?.kind).toBe('uncertain');
    expect(warn).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(backend.detailReads()).toBeGreaterThan(readsBefore));
    // Unconfirmed: the roster does not claim the warning landed.
    expect(result.current.sessions[0]?.warnings).toBe(0);
  });

  it('shows a confirmed student extension on the roster row', async () => {
    installBackend(detail());
    const extend = vi.spyOn(examDeliveryService, 'extendStudentAttempt').mockResolvedValue({ success: true });
    const { result } = await renderLoadedRoom();

    await act(async () => {
      await result.current.commands.extendStudent(result.current.sessions[0]!, 5, 'Proctor');
    });

    expect(extend).toHaveBeenCalledWith('attempt-1', 'Proctor', 5, 'module-1');
    await waitFor(() => expect(result.current.sessions[0]?.runtimeTimeRemainingSeconds).toBe(1500));
  });

  it('shares confirmed student actions and full roster removals across room observers', async () => {
    const backend = installBackend(detail());
    vi.spyOn(examDeliveryService, 'warnStudent').mockResolvedValue({ success: true });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => [
      useProctorRouteController({ initialScheduleId: 'sched-1' }),
      useProctorRouteController({ initialScheduleId: 'sched-1' }),
    ] as const, { wrapper });
    await waitFor(() => expect(result.current.every((controller) => controller.sessions.length === 1)).toBe(true));

    await act(async () => {
      await result.current[0].commands.studentAction(result.current[0].sessions[0]!, 'warn', 'Proctor');
    });
    await waitFor(() => expect(result.current.map((controller) => controller.sessions[0]?.warnings)).toEqual([1, 1]));

    // The backend returns the complete room roster, so a missing attempt must
    // not linger in either view after the next accepted read.
    backend.server.detail = detail({ sessions: [] });
    await act(async () => { await result.current[0].reload(); });
    await waitFor(() => expect(result.current.map((controller) => controller.sessions.length)).toEqual([0, 0]));
  });

  it('keeps a confirmed student action when a pre-command room read finishes late', async () => {
    const initial = detail({ sessions: [{ ...session, runtimeServerNow: '2026-01-01T09:00:00.000Z' }] });
    const backend = installBackend(initial);
    vi.spyOn(examDeliveryService, 'warnStudent').mockResolvedValue({ success: true });
    const { result, queryClient } = await renderLoadedRoom();
    let finishOldRead: (value: Detail) => void = () => {};
    backend.server.nextDetailResponse = new Promise<Detail>((resolve) => { finishOldRead = resolve; });
    const readsBefore = backend.detailReads();
    let oldRead!: Promise<void>;
    act(() => { oldRead = queryClient.refetchQueries({ queryKey: proctorKeys.detail('sched-1') }); });
    await waitFor(() => expect(backend.detailReads()).toBeGreaterThan(readsBefore));

    await act(async () => {
      await result.current.commands.studentAction(result.current.sessions[0]!, 'warn', 'Proctor');
    });
    await act(async () => {
      finishOldRead(detail({ sessions: [{ ...session, runtimeServerNow: '2026-01-01T09:01:00.000Z' }] }));
      await oldRead;
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
    expect(result.current.sessions[0]?.warnings).toBe(1);

    backend.server.detail = detail({ sessions: [{ ...session, warnings: 1, runtimeServerNow: '2026-01-01T09:02:00.000Z' }] });
    await act(async () => { await result.current.reload(); });
    expect(result.current.sessions[0]?.warnings).toBe(1);
  });

  it('hides a deleted note at once, restores it when refused, and drops it once the server confirms', async () => {
    const backend = installBackend(detail());
    let refuse: (error: Error) => void = () => {};
    const remove = vi.spyOn(examRepository, 'deleteSessionNote').mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => { refuse = reject; }),
    );
    const { result } = await renderLoadedRoom();

    let pending: Promise<{ kind: string }> | undefined;
    act(() => {
      pending = result.current.commands.deleteNote({ id: 'note-1', scheduleId: 'sched-1' });
    });
    await waitFor(() => expect(result.current.notes).toHaveLength(0));

    await act(async () => {
      refuse(Object.assign(new Error('Not allowed'), { status: 403 }));
      await pending;
    });
    await waitFor(() => expect(result.current.notes.map((row) => row.id)).toEqual(['note-1']));

    remove.mockResolvedValueOnce(undefined);
    await act(async () => {
      await result.current.commands.deleteNote({ id: 'note-1', scheduleId: 'sched-1' });
    });
    expect(result.current.notes).toHaveLength(0);
    // The server's full snapshot no longer has it; the overlay is no longer needed.
    backend.server.detail = detail({ notes: [] });
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.notes).toHaveLength(0);
  });

  it('does not let a room read started before a confirmed note edit overwrite it', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => ++now);
    const backend = installBackend(detail());
    vi.spyOn(examRepository, 'saveSessionNote').mockResolvedValue(undefined);
    const { result, queryClient } = await renderLoadedRoom();
    const original = result.current.notes[0]!;
    const readsBefore = backend.detailReads();
    let finishOldRead: (value: Detail) => void = () => {};
    backend.server.nextDetailResponse = new Promise<Detail>((resolve) => { finishOldRead = resolve; });
    let oldRead!: Promise<void>;
    act(() => { oldRead = queryClient.refetchQueries({ queryKey: proctorKeys.detail('sched-1') }); });
    await waitFor(() => expect(backend.detailReads()).toBeGreaterThan(readsBefore));
    // Exercise the ordering fence even if a pre-command read cannot be cancelled.
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);

    await act(async () => {
      await result.current.commands.saveNote({ ...original, content: 'Updated by the proctor.' });
    });
    await act(async () => { finishOldRead(detail()); await oldRead; });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
    expect(result.current.notes[0]?.content).toBe('Updated by the proctor.');

    invalidate.mockRestore();
    backend.server.detail = detail({ notes: [{ ...note, content: 'Updated by the proctor.' }] });
    await act(async () => { await result.current.reload(); });
    expect(result.current.notes[0]?.content).toBe('Updated by the proctor.');
    backend.server.detail = detail({ notes: [{ ...note, content: 'Later edit by another proctor.' }] });
    await act(async () => { await result.current.reload(); });
    await waitFor(() => expect(result.current.notes[0]?.content).toBe('Later edit by another proctor.'));
  });

  it('does not roll back a newer queued note edit when an older edit is rejected', async () => {
    installBackend(detail());
    let rejectFirst: (error: Error) => void = () => {};
    let resolveSecond: () => void = () => {};
    const save = vi.spyOn(examRepository, 'saveSessionNote')
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectFirst = reject; }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveSecond = resolve; }));
    const { result } = await renderLoadedRoom();
    const original = result.current.notes[0]!;
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;

    act(() => { first = result.current.commands.saveNote({ ...original, content: 'First edit' }); });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    act(() => { second = result.current.commands.saveNote({ ...original, content: 'Second edit' }); });
    await waitFor(() => expect(result.current.notes[0]?.content).toBe('Second edit'));
    await act(async () => {
      rejectFirst(Object.assign(new Error('Not allowed'), { status: 403 }));
      await first;
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(result.current.notes[0]?.content).toBe('Second edit');
    await act(async () => { resolveSecond(); await second; });
  });

  it('does not show a pending note from another room after selection changes', async () => {
    const backend = installBackend(detail());
    const secondSchedule = { ...schedule, id: 'sched-2', cohortName: 'Cohort B' };
    const secondRuntime = { ...runtime, id: 'runtime-2', scheduleId: 'sched-2' };
    backend.server.summaries.push({ schedule: secondSchedule, runtime: secondRuntime, studentCount: 0, activeCount: 0, alertCount: 0, violationCount: 0, degradedLiveMode: false });
    backend.server.otherDetails['sched-2'] = detail({ schedule: secondSchedule, runtime: secondRuntime, sessions: [], notes: [], alerts: [] });
    let resolveSave: () => void = () => {};
    vi.spyOn(examRepository, 'saveSessionNote').mockImplementation(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    const { result } = await renderLoadedRoom();
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.commands.saveNote({ ...result.current.notes[0]!, content: 'Room A only' }); });
    await waitFor(() => expect(result.current.notes[0]?.content).toBe('Room A only'));

    act(() => result.current.setSelectedScheduleId('sched-2'));
    await waitFor(() => expect(result.current.selectedScheduleId).toBe('sched-2'));
    await waitFor(() => expect(result.current.notes).toEqual([]));
    await act(async () => { resolveSave(); await pending; });
    expect(result.current.notes).toEqual([]);
  });

  it('does not show an automatic alert from another room after selection changes', async () => {
    const rule = {
      id: 'rule-notify', scheduleId: 'sched-1', triggerType: 'violation_count', threshold: 1,
      action: 'notify_proctor', isEnabled: true, createdAt: '2026-01-01T09:00:00.000Z', createdBy: 'admin-1',
    };
    const violation = { id: 'violation-notify', type: 'TAB_SWITCH', severity: 'medium', timestamp: '2026-01-01T09:02:00.000Z', description: 'Tab switch.' };
    const backend = installBackend(detail({ sessions: [{ ...session, violations: [violation] }], violationRules: [rule] }));
    const secondSchedule = { ...schedule, id: 'sched-2', cohortName: 'Cohort B' };
    const secondRuntime = { ...runtime, id: 'runtime-2', scheduleId: 'sched-2' };
    backend.server.summaries.push({ schedule: secondSchedule, runtime: secondRuntime, studentCount: 0, activeCount: 0, alertCount: 0, violationCount: 0, degradedLiveMode: false });
    backend.server.otherDetails['sched-2'] = detail({ schedule: secondSchedule, runtime: secondRuntime, sessions: [], notes: [], alerts: [], violationRules: [] });
    const { result } = await renderLoadedRoom();
    await waitFor(() => expect(result.current.alerts.some((row) => row.type === 'RULE_NOTIFY_PROCTOR')).toBe(true));

    act(() => result.current.setSelectedScheduleId('sched-2'));
    await waitFor(() => expect(result.current.selectedScheduleId).toBe('sched-2'));
    await waitFor(() => expect(result.current.alerts).toEqual([]));
  });

  it('does not repeat an automatic warning after its outcome becomes uncertain', async () => {
    const rule = {
      id: 'rule-1', scheduleId: 'sched-1', triggerType: 'violation_count', threshold: 1,
      action: 'warn', isEnabled: true, createdAt: '2026-01-01T09:00:00.000Z', createdBy: 'admin-1',
    };
    const violation = { id: 'violation-1', type: 'TAB_SWITCH', severity: 'medium', timestamp: '2026-01-01T09:02:00.000Z', description: 'Tab switch.' };
    const backend = installBackend(detail({ sessions: [{ ...session, violations: [violation] }], violationRules: [rule] }));
    const warn = vi.spyOn(examDeliveryService, 'warnStudent').mockResolvedValue({
      success: false, error: 'Connection lost', errorCause: new TypeError('Connection lost'), commandDispatched: true,
    });
    const { result } = await renderLoadedRoom();

    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(backend.detailReads()).toBeGreaterThan(1));
    await waitFor(() => expect(result.current.error).toMatch(/automatic action outcome is uncertain/i));
    await act(async () => { await result.current.evaluateViolationRules('sched-1', result.current.sessions); });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(result.current.error).toMatch(/automatic action outcome is uncertain/i);
    await act(async () => { await result.current.reload(); });
    await waitFor(() => expect(result.current.error).toBeNull());
  });

  it('does not issue a second automatic warning while the first is still pending', async () => {
    const rule = {
      id: 'rule-pending', scheduleId: 'sched-1', triggerType: 'violation_count', threshold: 1,
      action: 'warn', isEnabled: true, createdAt: '2026-01-01T09:00:00.000Z', createdBy: 'admin-1',
    };
    const violation = { id: 'violation-pending', type: 'TAB_SWITCH', severity: 'medium', timestamp: '2026-01-01T09:02:00.000Z', description: 'Tab switch.' };
    installBackend(detail({ sessions: [{ ...session, violations: [violation] }], violationRules: [rule] }));
    let finishWarning: (value: { success: boolean }) => void = () => {};
    const warning = new Promise<{ success: boolean }>((resolve) => { finishWarning = resolve; });
    const warn = vi.spyOn(examDeliveryService, 'warnStudent').mockImplementation(() => warning);
    const { result } = await renderLoadedRoom();
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));

    let second!: Promise<void>;
    act(() => { second = result.current.evaluateViolationRules('sched-1', result.current.sessions); });
    const callsWhilePending = warn.mock.calls.length;
    await act(async () => { finishWarning({ success: true }); await second; });
    expect(callsWhilePending).toBe(1);
  });

  it('does not issue duplicate automatic actions from two observers sharing one room cache', async () => {
    const rule = {
      id: 'rule-shared', scheduleId: 'sched-1', triggerType: 'violation_count', threshold: 1,
      action: 'warn', isEnabled: true, createdAt: '2026-01-01T09:00:00.000Z', createdBy: 'admin-1',
    };
    const violation = { id: 'violation-shared', type: 'TAB_SWITCH', severity: 'medium', timestamp: '2026-01-01T09:02:00.000Z', description: 'Tab switch.' };
    installBackend(detail({ sessions: [{ ...session, violations: [violation] }], violationRules: [rule] }));
    let finishWarning: (value: { success: boolean }) => void = () => {};
    const warning = new Promise<{ success: boolean }>((resolve) => { finishWarning = resolve; });
    const warn = vi.spyOn(examDeliveryService, 'warnStudent').mockImplementation(() => warning);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => [
      useProctorRouteController({ initialScheduleId: 'sched-1' }),
      useProctorRouteController({ initialScheduleId: 'sched-1' }),
    ] as const, { wrapper });
    await waitFor(() => expect(result.current.every((controller) => controller.sessions.length === 1)).toBe(true));
    await waitFor(() => expect(warn).toHaveBeenCalled());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
    const callsWhilePending = warn.mock.calls.length;
    await act(async () => { finishWarning({ success: true }); await warning; });
    expect(callsWhilePending).toBe(1);
  });

  it('allows a new threshold crossing after the previous action finishes', async () => {
    const rule = {
      id: 'rule-reset', scheduleId: 'sched-1', triggerType: 'violation_count', threshold: 1,
      action: 'warn', isEnabled: true, createdAt: '2026-01-01T09:00:00.000Z', createdBy: 'admin-1',
    };
    const violation = { id: 'violation-reset', type: 'TAB_SWITCH', severity: 'medium', timestamp: '2026-01-01T09:02:00.000Z', description: 'Tab switch.' };
    installBackend(detail({ sessions: [{ ...session, violations: [violation] }], violationRules: [rule] }));
    let finishWarning: (value: { success: boolean }) => void = () => {};
    const warning = new Promise<{ success: boolean }>((resolve) => { finishWarning = resolve; });
    const warn = vi.spyOn(examDeliveryService, 'warnStudent').mockReturnValueOnce(warning).mockResolvedValue({ success: true });
    const { result } = await renderLoadedRoom();
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    const current = result.current.sessions[0]!;

    await act(async () => {
      await result.current.evaluateViolationRules('sched-1', [{ ...current, violations: [] }]);
      await result.current.evaluateViolationRules('sched-1', [current]);
    });
    expect(warn).toHaveBeenCalledTimes(1);
    await act(async () => { finishWarning({ success: true }); await warning; });
    await act(async () => { await result.current.evaluateViolationRules('sched-1', [current]); });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('clears automatic-rule memory when the query cache is cleared for a new staff session', async () => {
    const rule = {
      id: 'rule-auth', scheduleId: 'sched-1', triggerType: 'violation_count', threshold: 1,
      action: 'warn', isEnabled: true, createdAt: '2026-01-01T09:00:00.000Z', createdBy: 'admin-1',
    };
    const violation = { id: 'violation-auth', type: 'TAB_SWITCH', severity: 'medium', timestamp: '2026-01-01T09:02:00.000Z', description: 'Tab switch.' };
    const backend = installBackend(detail({ sessions: [{ ...session, violations: [violation] }], violationRules: [rule] }));
    const warn = vi.spyOn(examDeliveryService, 'warnStudent').mockResolvedValue({ success: true });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const first = renderHook(() => useProctorRouteController({ initialScheduleId: 'sched-1' }), { wrapper });
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(backend.detailReads()).toBeGreaterThan(1));
    first.unmount();
    act(() => queryClient.clear());

    renderHook(() => useProctorRouteController({ initialScheduleId: 'sched-1' }), { wrapper });
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
  });

  it('refreshes the original room when its command completes after switching rooms', async () => {
    const backend = installBackend(detail());
    const secondSchedule = { ...schedule, id: 'sched-2', cohortName: 'Cohort B' };
    const secondRuntime = { ...runtime, id: 'runtime-2', scheduleId: 'sched-2' };
    backend.server.summaries.push({ schedule: secondSchedule, runtime: secondRuntime, studentCount: 0, activeCount: 0, alertCount: 0, violationCount: 0, degradedLiveMode: false });
    backend.server.otherDetails['sched-2'] = detail({ schedule: secondSchedule, runtime: secondRuntime, sessions: [], notes: [], alerts: [] });
    let finishPause: (value: { success: boolean }) => void = () => {};
    vi.spyOn(examDeliveryService, 'pauseRuntime').mockImplementation(() => new Promise((resolve) => { finishPause = resolve; }));
    const { result, queryClient } = await renderLoadedRoom();
    let pending!: Promise<void>;
    act(() => { pending = result.current.handlePauseCohort('sched-1'); });
    await waitFor(() => expect(examDeliveryService.pauseRuntime).toHaveBeenCalledTimes(1));
    act(() => result.current.setSelectedScheduleId('sched-2'));
    await waitFor(() => expect(result.current.selectedScheduleId).toBe('sched-2'));
    await waitFor(() => expect(queryClient.getQueryState(proctorKeys.detail('sched-2'))?.status).toBe('success'));

    backend.server.detail = detail({ runtime: { ...runtime, status: 'paused', revision: 2 } });
    await act(async () => { finishPause({ success: true }); await pending; });
    expect(queryClient.getQueryData<{ detail: { runtime: { status: string } } }>(proctorKeys.detail('sched-1'))?.detail.runtime.status).toBe('paused');
    expect(result.current.selectedScheduleId).toBe('sched-2');
  });

  it('marks the original room stale when recovery completes after switching rooms', async () => {
    const backend = installBackend(detail());
    const secondSchedule = { ...schedule, id: 'sched-2', cohortName: 'Cohort B' };
    const secondRuntime = { ...runtime, id: 'runtime-2', scheduleId: 'sched-2' };
    backend.server.summaries.push({ schedule: secondSchedule, runtime: secondRuntime, studentCount: 0, activeCount: 0, alertCount: 0, violationCount: 0, degradedLiveMode: false });
    backend.server.otherDetails['sched-2'] = detail({ schedule: secondSchedule, runtime: secondRuntime, sessions: [], notes: [], alerts: [] });
    let finish: (value: { kind: 'confirmed' }) => void = () => {};
    vi.spyOn(proctorMutations, 'resolveRecovery').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { result, queryClient } = await renderLoadedRoom();
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.commands.resolveRecovery({
        scheduleId: 'sched-1', attemptId: 'attempt-1', resolutionId: 'decision-1', moduleAttemptId: 'module-attempt-1',
        expectedBoundaryRevision: 4, action: 'activate_entry', reason: 'Device checked.',
      });
    });
    await waitFor(() => expect(proctorMutations.resolveRecovery).toHaveBeenCalledTimes(1));
    act(() => result.current.setSelectedScheduleId('sched-2'));
    await waitFor(() => expect(result.current.selectedScheduleId).toBe('sched-2'));
    await act(async () => { finish({ kind: 'confirmed' }); await pending; });

    expect(queryClient.getQueryState(proctorKeys.detail('sched-1'))?.isInvalidated).toBe(true);
    expect(result.current.selectedScheduleId).toBe('sched-2');
  });

  it('does not report an uncertain command as confirmed when reconciliation also fails', async () => {
    const backend = installBackend(detail());
    vi.spyOn(examDeliveryService, 'pauseRuntime').mockResolvedValue({
      success: false, error: 'Connection lost', errorCause: new TypeError('Connection lost'), commandDispatched: true,
    });
    const { result } = await renderLoadedRoom();
    backend.server.summaryStatus = 403;

    await act(async () => {
      await expect(result.current.handlePauseCohort('sched-1')).rejects.toThrow('Check the room before trying again');
    });
    await waitFor(() => expect(result.current.error).toMatch(/uncertain/i));
    expect(result.current.error).not.toMatch(/action confirmed/i);
  });

  it('reports a confirmed command as stale when the follow-up reads are paused offline', async () => {
    installBackend(detail());
    vi.spyOn(examDeliveryService, 'pauseRuntime').mockResolvedValue({ success: true });
    const { result, queryClient, unmount } = await renderLoadedRoom();
    act(() => onlineManager.setOnline(false));

    await act(async () => { await result.current.handlePauseCohort('sched-1'); });
    expect(result.current.error).toMatch(/action confirmed.*could not be refreshed/i);
    await act(async () => { await queryClient.cancelQueries(); unmount(); onlineManager.setOnline(true); });
  });
});
