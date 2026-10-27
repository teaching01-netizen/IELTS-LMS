import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SatSessionRoomRoute } from '../SatSessionRoomRoute';
import { examDeliveryService } from '../../../../features/proctor/infrastructure/proctorGateway';

const controllerMock = vi.hoisted(() => vi.fn());
const entryInfoMock = vi.hoisted(() => vi.fn());
const roleMock = vi.hoisted(() => ({ role: undefined as string | undefined }));
const proctorGetMock = vi.hoisted(() => vi.fn());
const recoveryCommandMock = vi.hoisted(() => vi.fn());
// The real controller always reports `scheduleMetrics`; fixtures only list what they exercise.
const formStateMock = vi.hoisted(() => vi.fn(() => ({ data: undefined as unknown, refetch: vi.fn(async () => ({ data: undefined })) })));
// Room form state has its own suite; rooms here have no Eva SIM.
vi.mock('@/src/features/assessment-forms/api/assessmentForms', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/features/assessment-forms/api/assessmentForms')>()),
  useScheduleFormState: () => formStateMock(),
}));
vi.mock('../../../../features/proctor/hooks/useProctorRouteController', () => ({
  useProctorRouteController: (...args: unknown[]) => ({ scheduleMetrics: {}, commands: { resolveRecovery: recoveryCommandMock }, ...controllerMock(...args) }),
}));
vi.mock('../../api/satRoomEntryInfo', () => ({ useSatRoomEntryInfo: entryInfoMock }));
vi.mock('../../../../features/auth/authSession', () => ({
  useAuthSession: () => ({ session: { user: { displayName: 'SAT Proctor', email: 'p@example.com', role: roleMock.role } } }),
}));
vi.mock('qrcode', () => ({ toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,QR') }));
vi.mock('../../../../features/proctor/infrastructure/proctorGateway', () => ({
  examDeliveryService: {
    extendCurrentSection: vi.fn(),
    completeRuntime: vi.fn(),
    extendStudentAttempt: vi.fn(), warnStudent: vi.fn(), pauseStudentAttempt: vi.fn(), resumeStudentAttempt: vi.fn(), terminateStudentAttempt: vi.fn(),
  },
  // Staff route queue reports disabled, so the panel stays hidden and raises no alert.
  proctorGateway: { backendGet: (...args: unknown[]) => proctorGetMock(...args), backendPost: async () => undefined },
}));
vi.mock('../../../../features/proctor/api/deviceTransfers', () => ({
  listDeviceTransfers: async () => [],
  decideDeviceTransfer: async () => undefined,
}));
vi.mock('../../ui/SatStaffRoutePanel', () => ({ SatStaffRoutePanel: () => null }));
vi.mock('../../ui/SatDeviceTransferRequests', () => ({ SatDeviceTransferRequests: () => null }));

const schedule = {
  id: 'sched-1', examId: 'sat-1', providerKey: 'sat', examTitle: 'Practice Test 06', proctorDisplayName: 'Practice Test 06',
  gradingDisplayName: 'Practice Test 06', publishedVersionId: 'v1', publishScope: 'reading-writing', cohortName: 'Morning', startTime: '2026-08-30T02:00:00Z',
  endTime: '2026-08-30T06:00:00Z', plannedDurationMinutes: 180, deliveryMode: 'proctor_start', autoStart: false, autoStop: false,
  status: 'live', createdAt: '2026-08-30T00:00:00Z', createdBy: 'Admin', updatedAt: '2026-08-30T00:00:00Z',
};
const runtime = {
  revision: 7,
  id: 'runtime-1', scheduleId: 'sched-1', examId: 'sat-1', providerKey: 'sat', examTitle: 'Practice Test 06', cohortName: 'Morning',
  deliveryMode: 'proctor_start', status: 'live', timingModel: 'cohort_section_v3', actualStartAt: '2026-08-30T02:00:00Z', actualEndAt: null,
  activeSectionKey: 'reading-writing', currentSectionKey: 'reading-writing', currentSectionRemainingSeconds: 1603, waitingForNextSection: false, isOverrun: false,
  totalPausedSeconds: 0, sections: [{ sectionKey: 'reading-writing', label: 'Reading & Writing', order: 0, plannedDurationMinutes: 64,
    gapAfterMinutes: 10, status: 'live', availableAt: null, actualStartAt: '2026-08-30T02:00:00Z', actualEndAt: null, pausedAt: null,
    accumulatedPausedSeconds: 0, extensionMinutes: 0 }], serverNow: '2026-08-30T02:05:00Z',
  // Authored run sheet (proctor detail reads carry it): section one is live in
  // the runtime above, section two is still ahead.
  examPlan: [
    { sectionKey: 'reading-writing', label: 'Reading & Writing', order: 0, durationMinutes: 64, gapAfterMinutes: 10, modules: [
      { moduleKey: 'rw-m1', title: 'Module 1', adaptiveRole: 'base', durationMinutes: 32 },
      { moduleKey: 'rw-m2-lower', title: 'Module 2 — Lower', adaptiveRole: 'lower_branch', durationMinutes: 32 },
      { moduleKey: 'rw-m2-higher', title: 'Module 2 — Higher', adaptiveRole: 'higher_branch', durationMinutes: 32 },
    ] },
    { sectionKey: 'math', label: 'Math', order: 1, durationMinutes: 70, gapAfterMinutes: 0, modules: [
      { moduleKey: 'math-m1', title: 'Module 1', adaptiveRole: 'base', durationMinutes: 35 },
      { moduleKey: 'math-m2-lower', title: 'Module 2 — Lower', adaptiveRole: 'lower_branch', durationMinutes: 35 },
      { moduleKey: 'math-m2-higher', title: 'Module 2 — Higher', adaptiveRole: 'higher_branch', durationMinutes: 35 },
    ] },
  ],
  createdAt: '2026-08-30T02:00:00Z', updatedAt: '2026-08-30T02:05:00Z',
};
const student = {
  id: 'attempt-1', studentId: 'W2501', name: 'Ananda S.', email: 'a@example.com', scheduleId: 'sched-1', status: 'active',
  currentSection: 'reading', timeRemaining: 1500, runtimeStatus: 'live', runtimeCurrentSection: 'reading', runtimeTimeRemainingSeconds: 1500,
  violations: [], warnings: 0, lastActivity: '2026-08-30T02:05:00Z', examId: 'sat-1', examName: 'Practice Test 06',
};

/**
 * The room clock a mocked controller hands the route. Resolving it is the
 * controller's job now (the accepted server instant, else the selected runtime's
 * own stamp; `receivedAt: 0` is that same fallback's unknown receipt), and the
 * route decides nothing — so a mock that omits `roomClock` renders an uncorrected
 * clock. Every fixture here anchors its run sheet on `runtime.serverNow`, so the
 * mocks whose assertions depend on the room's clock pass this.
 */
const resolvedRoomClock = { serverNow: runtime.serverNow, receivedAt: 0 };

/** The room measures its own width (sidebar and zoom already applied); 1000px is below the 1280px needed to dock the inspector. */
function mockMeasuredRoomWidth(width: number) {
  const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}),
  });
  return () => spy.mockRestore();
}

function TestSessionsProbe() {
  const location = useLocation();
  return <p data-testid="test-sessions">{`${location.pathname}${location.search}`}</p>;
}

function SwitchRoom() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/sat/sessions/sched-2')}>Switch room</button>;
}

describe('SatSessionRoomRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recoveryCommandMock.mockReset().mockResolvedValue({ kind: 'confirmed' });
    proctorGetMock.mockImplementation(async () => ({ enabled: false, items: [] }));
    roleMock.role = undefined;
    entryInfoMock.mockReturnValue({ data: { link: null, roster: [] }, isLoading: false, isError: false, refetch: vi.fn() });
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student], alerts: [], error: null, isLoading: false,
      roomClock: resolvedRoomClock,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
  });

  it('carries confirmed creation into the ready room and focuses its title', async () => {
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    render(<MemoryRouter initialEntries={[{ pathname: '/sat/sessions/sched-1', state: { satCreatedRoom: 'sched-1' } }]}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByText('Room created.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Morning', level: 1 })).toHaveFocus());
    expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss room creation confirmation' }));
    expect(screen.queryByText('Room created.')).not.toBeInTheDocument();
    scroll.mockRestore();
  });

  it('keeps a rejected recovery decision open and reuses its resolution identity on retry', async () => {
    const recovering = {
      ...student,
      satRecoveryPhase: 'blocked',
      satRecoveryKind: 'entry',
      satRecoveryModuleAttemptId: 'module-attempt-1',
      satRecoveryBoundaryRevision: 4,
    };
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [recovering], alerts: [], error: null, isLoading: false,
      roomClock: resolvedRoomClock, reload: vi.fn().mockResolvedValue(undefined),
      handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    recoveryCommandMock.mockResolvedValueOnce({ kind: 'rejected', error: 'Recovery decision rejected' });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: /review recovery decision/i }));
    fireEvent.change(screen.getByLabelText('Reason for the recovery decision'), { target: { value: 'Device was checked.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start module' }));
    await screen.findAllByText('Recovery decision rejected');
    expect(screen.getByRole('group', { name: 'Recovery decision preview' })).toBeInTheDocument();
    expect(screen.getByLabelText('Reason for the recovery decision')).toHaveValue('Device was checked.');

    fireEvent.click(screen.getByRole('button', { name: 'Start module' }));
    await waitFor(() => expect(recoveryCommandMock).toHaveBeenCalledTimes(2));
    expect(recoveryCommandMock.mock.calls[1]?.[0].resolutionId).toBe(recoveryCommandMock.mock.calls[0]?.[0].resolutionId);
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Recovery decision preview' })).not.toBeInTheDocument());
  });

  it('refreshes the room and retains the decision when a recovery response is uncertain', async () => {
    const recovering = {
      ...student, satRecoveryPhase: 'blocked', satRecoveryKind: 'entry',
      satRecoveryModuleAttemptId: 'module-attempt-1', satRecoveryBoundaryRevision: 4,
    };
    const reload = vi.fn().mockResolvedValue(undefined);
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [recovering], alerts: [], error: null, isLoading: false,
      roomClock: resolvedRoomClock, reload, handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(),
      handleResumeCohort: vi.fn(), handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    recoveryCommandMock.mockResolvedValueOnce({ kind: 'uncertain', error: 'The action may have been applied. Check the room before trying again.' });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: /review recovery decision/i }));
    fireEvent.change(screen.getByLabelText('Reason for the recovery decision'), { target: { value: 'Device was checked.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start module' }));
    await screen.findAllByText(/may have been applied/i);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('group', { name: 'Recovery decision preview' })).toBeInTheDocument();
    expect(recoveryCommandMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a pending room action and its feedback bound to the room where it started', async () => {
    let finishPauseA: () => void = () => {};
    let finishPauseB: () => void = () => {};
    const pause = vi.fn((roomId: string) => new Promise<void>((resolve) => {
      if (roomId === 'sched-1') finishPauseA = resolve;
      else finishPauseB = resolve;
    }));
    const otherSchedule = { ...schedule, id: 'sched-2', cohortName: 'Afternoon' };
    const otherRuntime = { ...runtime, id: 'runtime-2', scheduleId: 'sched-2', cohortName: 'Afternoon' };
    const otherStudent = { ...student, id: 'attempt-2', scheduleId: 'sched-2', name: 'Another student' };
    controllerMock.mockReturnValue({
      schedules: [schedule, otherSchedule], runtimeSnapshots: [runtime, otherRuntime], sessions: [student, otherStudent],
      alerts: [], error: null, isLoading: false, roomClock: resolvedRoomClock, reload: vi.fn().mockResolvedValue(undefined),
      handleStartScheduledSession: vi.fn(), handlePauseCohort: pause, handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><SwitchRoom /><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'Pause exam' }));
    await waitFor(() => expect(pause).toHaveBeenCalledWith('sched-1'));
    fireEvent.click(screen.getByRole('button', { name: 'Switch room' }));
    expect(await screen.findByRole('heading', { name: 'Afternoon' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause exam' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Pause exam' }));
    await waitFor(() => expect(pause).toHaveBeenCalledWith('sched-2'));
    await act(async () => { finishPauseA(); });
    expect(screen.queryByText('Exam paused.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pausing/i })).toHaveAttribute('aria-busy', 'true');
    await act(async () => { finishPauseB(); });
    expect(await screen.findByText('Exam paused.')).toBeInTheDocument();
  });

  it('dismisses a room confirmation when the route changes to another room', async () => {
    const otherSchedule = { ...schedule, id: 'sched-2', cohortName: 'Afternoon' };
    const otherRuntime = { ...runtime, id: 'runtime-2', scheduleId: 'sched-2', cohortName: 'Afternoon' };
    controllerMock.mockReturnValue({
      schedules: [schedule, otherSchedule], runtimeSnapshots: [runtime, otherRuntime], sessions: [student],
      alerts: [], error: null, isLoading: false, roomClock: resolvedRoomClock, reload: vi.fn().mockResolvedValue(undefined),
      handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><SwitchRoom /><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'End exam' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Switch room', hidden: true }));
    expect(await screen.findByRole('heading', { name: 'Afternoon' })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(examDeliveryService.completeRuntime).not.toHaveBeenCalled();
  });

  it('keeps creation confirmed while its page loads, including a partial snapshot', () => {
    controllerMock.mockReturnValue({ schedules: [schedule], runtimeSnapshots: [], sessions: [], alerts: [], error: null, isLoading: true, reload: vi.fn() });
    render(<MemoryRouter initialEntries={[{ pathname: '/sat/sessions/sched-1', state: { satCreatedRoom: 'sched-1' } }]}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByText('Room created. Opening your room…')).toBeInTheDocument();
    expect(screen.queryByText('SAT room not found')).not.toBeInTheDocument();
  });

  it('retries loading the confirmed room without suggesting creation again', () => {
    const reload = vi.fn();
    controllerMock.mockReturnValue({ schedules: [], runtimeSnapshots: [], sessions: [], alerts: [], error: 'Connection interrupted', isLoading: false, reload });
    render(<MemoryRouter initialEntries={[{ pathname: '/sat/sessions/sched-1', state: { satCreatedRoom: 'sched-1' } }]}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByText('Room created, but its page could not load')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does not show another room’s creation confirmation on an ordinary visit', () => {
    render(<MemoryRouter initialEntries={[{ pathname: '/sat/sessions/sched-1', state: { satCreatedRoom: 'different-room' } }]}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    expect(screen.queryByText('Room created.')).not.toBeInTheDocument();
  });

  it('returns Back to the originating test and selected room', () => {
    const from = '/sat/exams/sat-1/access?link=link-1';
    render(
      <MemoryRouter initialEntries={[{ pathname: '/sat/sessions/sched-1', state: { from } }]}>
        <Routes>
          <Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} />
          <Route path="/sat/exams/:examId/access" element={<TestSessionsProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rooms' }));
    expect(screen.getByTestId('test-sessions')).toHaveTextContent(from);
  });

  it('shows its loading state before the first runtime snapshot arrives', () => {
    controllerMock.mockReturnValue({
      schedules: [], runtimeSnapshots: [], sessions: [], alerts: [], error: null, isLoading: true,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });

    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);

    expect(screen.getByText('Opening SAT room…')).toBeInTheDocument();
  });

  it('opens the controller explicitly in the SAT provider boundary', () => {
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    expect(controllerMock).toHaveBeenCalledWith({ providerKey: 'sat', initialScheduleId: 'sched-1' });
    expect(document.querySelector('.sat-room')).toHaveAttribute('data-sat-room-mode', 'live');
    expect(screen.getByRole('heading', { level: 1, name: 'Morning' })).toBeInTheDocument();
    expect(screen.getByText('Practice Test 06 · Reading & Writing only')).toBeInTheDocument();
    // The runtime section label is what the room shows as the current stage.
    expect(screen.getAllByText('Reading & Writing')).toHaveLength(1);
    expect(screen.getByText('Section remaining')).toBeInTheDocument();
    expect(screen.getByText('Module 2 · Adaptive branches')).toBeInTheDocument();
    expect(screen.getAllByText('Ananda S.')).toHaveLength(2);
    // Staff run sheet: every stage with its Thailand-time window, anchored to
    // the proctor's start.
    expect(screen.getByText('Run sheet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Jump to selected student/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Thailand time · ICT \(UTC\+7\)/)).toBeInTheDocument();
    expect(screen.getByText('Section 1 · Reading & Writing')).toBeInTheDocument();
    expect(screen.getByText('Section 2 · Math')).toBeInTheDocument();
    expect(screen.getByText('Break · 10 min')).toBeInTheDocument();
    expect(screen.getByText('09:00–09:32')).toBeInTheDocument();
    expect(screen.getByText(/Anchored to the proctor's start at 09:00/)).toBeInTheDocument();
  });

  it('uses the prestart presentation with the complete projected run sheet', () => {
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [{ ...runtime, status: 'not_started', actualStartAt: null, currentSectionKey: null, sections: [] }], sessions: [], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);

    expect(document.querySelector('.sat-room')).toHaveAttribute('data-sat-room-mode', 'prestart');
    expect(document.querySelector('.sat-room__stage > p')).toHaveTextContent('Ready to begin');
    expect(screen.getByRole('heading', { name: 'Reading & Writing' })).toBeInTheDocument();
    expect(screen.getByText('Starts when the proctor starts the session.')).toBeInTheDocument();
    expect(screen.getByText('Run sheet')).toBeInTheDocument();
    expect(screen.getByText('Section 2 · Math')).toBeInTheDocument();
  });

  it('gives staff the student link and QR before the room starts', async () => {
    roleMock.role = 'admin';
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [{ ...runtime, status: 'not_started', actualStartAt: null, currentSectionKey: null, sections: [] }], sessions: [], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);

    const url = window.location.origin + '/student/sched-1';
    const card = document.querySelector<HTMLElement>('[data-sat-room-student-link]');
    expect(card).toHaveTextContent(url);
    expect(await within(card as HTMLElement).findByAltText('QR code for Morning')).toHaveAttribute('src', 'data:image/png;base64,QR');
    // Empty roster and empty inspector both lead to the link instead of a dead end.
    expect(screen.getAllByRole('button', { name: 'Share student link' })).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Share with students' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share Morning with students' });
    expect(dialog).toHaveTextContent(url);
    expect(await within(dialog).findByRole('link', { name: 'Download QR' })).toHaveAttribute('download', 'morning-qr.png');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Present QR' }));
    const presenter = await screen.findByRole('dialog', { name: 'Morning' });
    expect(presenter).toHaveTextContent('Scan to join');
    expect(presenter).toHaveTextContent('0Joined');
  });

  it('keeps sharing available while live and drops it in review', () => {
    roleMock.role = 'admin';
    const view = render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Share with students' })).toBeInTheDocument();
    expect(document.querySelector('[data-sat-room-student-link]')).toBeInTheDocument();
    view.unmount();

    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [{ ...runtime, status: 'completed', actualEndAt: '2026-08-30T04:30:00Z' }], sessions: [], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    expect(screen.queryByRole('button', { name: 'Share with students' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share student link' })).not.toBeInTheDocument();
  });

  it('starts a prestart room through the existing controller action', async () => {
    const startSession = vi.fn().mockResolvedValue(undefined);
    const prestartRuntime = { ...runtime, status: 'not_started', actualStartAt: null, currentSectionKey: null, sections: [] };
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [prestartRuntime], sessions: [], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: startSession, handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'Review and start exam' }));
    // Starting is reviewed first: nothing runs until the confirm.
    const review = screen.getByRole('alertdialog');
    expect(review).toHaveTextContent('Start the exam for this room?');
    expect(review).toHaveTextContent('Starting cannot be undone.');
    expect(startSession).not.toHaveBeenCalled();
    fireEvent.click(within(review).getByRole('button', { name: 'Start exam' }));

    expect(await screen.findByText('Exam started.')).toBeInTheDocument();
    expect(startSession).toHaveBeenCalledWith('sched-1');
  });

  it('does not submit an already-open room confirmation after the room becomes stale', async () => {
    const completeSession = vi.fn().mockResolvedValue(undefined);
    const renderApp = () => <MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>;
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student], alerts: [], error: null, isLoading: false,
      roomClock: resolvedRoomClock,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: completeSession,
    });
    const view = render(renderApp());

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'End exam' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student], alerts: [], error: 'Network unavailable', isLoading: false,
      roomClock: resolvedRoomClock,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: completeSession,
    });
    view.rerender(renderApp());
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'End exam' }));

    expect(completeSession).not.toHaveBeenCalled();
    expect(await screen.findByText(/This action was not completed because room data is out of date/)).toBeInTheDocument();
  });

  describe('waiting room and status line', () => {
    const prestartRuntime = { ...runtime, status: 'not_started', actualStartAt: null, currentSectionKey: null, sections: [] };
    const accessLink = {
      id: 'link-1', name: 'Morning class', versionNumber: 3, enabledSections: null,
      publishScope: 'reading-writing', audienceType: 'cohort', audienceLabel: 'Morning',
      accessMode: 'student_code', availabilityType: 'anytime', status: 'live', selectedStudentCount: 0,
    };
    const renderRoom = () => render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    const prestartController = (overrides: Record<string, unknown> = {}) => controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [prestartRuntime], sessions: [student], alerts: [], error: null, isLoading: false,
      scheduleMetrics: { 'sched-1': { joinReadyCount: 1 } },
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(), ...overrides,
    });

    it('states check-in and exam run state separately, and puts the start review in the waiting room with its facts', () => {
      roleMock.role = 'admin';
      entryInfoMock.mockReturnValue({ data: { link: accessLink, roster: [] }, isLoading: false, isError: false, refetch: vi.fn() });
      prestartController();
      renderRoom();

      expect(screen.getByTestId('sat-room-status-line')).toHaveTextContent('Check-in open · Exam not started');
      const waiting = within(screen.getByRole('region', { name: 'Waiting room' }));
      expect(waiting.getByRole('button', { name: 'Review and start exam' })).toBeEnabled();
      expect(waiting.getByText('Version 3')).toBeInTheDocument();
      expect(waiting.getByText('Reading & Writing')).toBeInTheDocument();
      // Joined and ready counts are read once, in the room summary.
      const counts = within(screen.getByRole('group', { name: 'Student counts' }));
      expect(counts.getByText(/Joined/)).toHaveTextContent('1 Joined');
      expect(counts.getByText(/Ready/)).toHaveTextContent('1 Ready');
      // The header no longer carries a competing Start control.
      expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
    });

    it('reports check-in as paused without claiming the exam stopped', () => {
      roleMock.role = 'admin';
      entryInfoMock.mockReturnValue({ data: { link: { ...accessLink, status: 'paused' }, roster: [] }, isLoading: false, isError: false, refetch: vi.fn() });
      prestartController({ runtimeSnapshots: [{ ...runtime }], schedules: [schedule] });
      renderRoom();

      expect(screen.getByTestId('sat-room-status-line')).toHaveTextContent('Check-in paused · Exam running');
    });

    it('gives an assigned proctor the same canonical join setup as an admin', () => {
      roleMock.role = 'proctor';
      entryInfoMock.mockReturnValue({ data: { link: accessLink, roster: [] }, isLoading: false, isError: false, refetch: vi.fn() });
      prestartController();
      renderRoom();

      expect(screen.getByTestId('sat-room-status-line')).toHaveTextContent('Check-in open · Exam not started');
      expect(entryInfoMock).toHaveBeenCalledWith('sched-1', true);
      expect(screen.getByText(/Student ID\/WCODE, name, and email\. The code identifies them but is not checked against a roster\./)).toBeInTheDocument();
      const waiting = within(screen.getByRole('region', { name: 'Waiting room' }));
      expect(waiting.getByText('Version 3')).toBeInTheDocument();
    });

    it('automatically retrieves the shared start code in code-start rooms', async () => {
      roleMock.role = 'proctor';
      const codeView = {
        code: '047218', generation: 2, cohortName: 'Morning', examTitle: 'Practice Test 06',
        opensAt: '2026-08-30T02:00:00Z', closesAt: '2026-08-30T06:00:00Z', acceptingNewStarts: true,
      };
      proctorGetMock.mockImplementation(async (path: string) => path.endsWith('/start-code') ? codeView : { enabled: false, items: [] });
      entryInfoMock.mockReturnValue({ data: { link: accessLink, roster: [] }, isLoading: false, isError: false, refetch: vi.fn() });
      prestartController({ schedules: [{ ...schedule, satStartMode: 'access_code' }] });
      renderRoom();

      expect(await screen.findByLabelText('6-digit exam start code')).toHaveTextContent('047218');
      expect(proctorGetMock).toHaveBeenCalledWith('/v1/proctor/sessions/sched-1/start-code');
      expect(screen.getByText('After check-in, students enter the six-digit exam start code shown here.')).toBeInTheDocument();
      // Code-start rooms have no room-wide start: each student's code starts their clock.
      expect(screen.queryByRole('button', { name: 'Review and start exam' })).not.toBeInTheDocument();
      expect(screen.getByText('Each student starts when they enter the exam start code.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Share with students' }));
      const shareDialog = await screen.findByRole('dialog', { name: 'Share Morning class with students' });
      expect(within(shareDialog).getByText('047218')).toBeInTheDocument();
      expect(within(shareDialog).getByText(/enter the six-digit exam start code shown here/)).toBeInTheDocument();
      expect(within(shareDialog).queryByText(/wait until you start the exam/i)).not.toBeInTheDocument();
    });

    it('shows invited students who have not joined in a restricted room roster', () => {
      roleMock.role = 'proctor';
      entryInfoMock.mockReturnValue({
        data: {
          link: { ...accessLink, audienceType: 'selected_students', selectedStudentCount: 2 },
          roster: [
            { ordinal: 1, name: 'Ananda S.', state: 'working', attemptId: 'attempt-1' },
            { ordinal: 2, name: 'Budi T.', state: 'not_joined', attemptId: null },
          ],
        },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      });
      prestartController();
      renderRoom();

      expect(screen.getByText('Listed students enter their assigned Student ID/WCODE. Any name or email included in the list must match.')).toBeInTheDocument();
      const invited = within(screen.getByRole('region', { name: 'Invited students' }));
      expect(invited.getByText('Budi T.')).toBeInTheDocument();
      expect(invited.getByText('Invited · Not joined')).toBeInTheDocument();
      expect(invited.queryByText('Ananda S.')).not.toBeInTheDocument();
    });

    it('hands a finished room to results the viewer can open', () => {
      const finished = { ...runtime, status: 'completed', actualEndAt: '2026-08-30T04:00:00Z' };
      prestartController({ runtimeSnapshots: [finished] });
      roleMock.role = 'admin';
      const { unmount } = renderRoom();
      expect(screen.getByRole('button', { name: 'View responses' })).toBeInTheDocument();
      unmount();

      // Proctors cannot open the test's Results tab, so they get the global, filtered Results page.
      roleMock.role = 'proctor';
      renderRoom();
      expect(screen.getByRole('button', { name: 'View responses' })).toBeInTheDocument();
    });
  });

  // Bug fix: the staff page must say which SECTION and which MODULE the room is
  // in, with each module's own clock. Before this the stage header named only the
  // section, the roster row read "reading · active" (a section key), and the
  // detail panel labelled a section key "Current module", so nothing on the page
  // could tell Module 1 from Module 2.
  it('names the section and the module clock for the room and for each student', () => {
    const clocked = {
      ...student,
      runtimeCurrentSection: 'reading-writing',
      runtimeSectionStatus: 'live' as const,
      runtimeModuleRole: 'base' as const,
      runtimeModuleRemainingSeconds: 780,
      runtimeModuleDeadlineAt: '2026-08-30T02:18:00Z',
    };
    controllerMock.mockReset();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [clocked], alerts: [], error: null, isLoading: false,
      roomClock: resolvedRoomClock,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);

    // The stage header: the section's ordinal plus the module the room's clock
    // has reached, with that module's own countdown.
    const slot = document.querySelector('[data-sat-room-stage-slot]');
    expect(slot?.textContent).toContain('Section 1 · Module 1');
    expect(document.querySelector('.sat-room__stage-note')?.textContent).toMatch(/Module ends \d{2}:\d{2} ICT · section ends \d{2}:\d{2} ICT/);
    // The hero figure stays the room's shared clock, and says so.
    expect(document.querySelector('.sat-room__stage-clock-caption')?.textContent).toBe('Section remaining');

    // The roster row: section label, module slot, then the candidate's module
    // clock beside the room's shared section clock.
    const row = screen.getByRole('option', { name: 'Open Ananda S.' });
    expect(row).toHaveTextContent('Reading & Writing · Module 1 · Working');
    expect(row.querySelector('.sat-room__row-time')?.textContent).toMatch(/^\d{1,2}:\d{2}$/);
    expect(row.querySelector('.sat-room__row-sub')?.textContent).toBe('Section clock 25:00');

    // The right inspector separates the two, and names the module slot rather
    // than repeating the section key in the module field.
    const detailValue = (label: string) =>
      Array.from(document.querySelectorAll('.sat-room__inspector-panel dl dt')).find((node) => node.textContent === label)?.parentElement?.querySelector('dd')?.textContent ?? null;
    expect(detailValue('Current section')).toBe('Reading & Writing');
    expect(detailValue('Current module')).toBe('Module 1');
    expect(detailValue('Module clock')).toMatch(/^\d{1,2}:\d{2}$/);
    expect(detailValue('Section clock')).toBe('25:00');

    // Session-level facts now have one home in the compact context bar.
    expect(document.querySelector('[data-sat-room-context]')).toHaveTextContent('Live data');
    expect(document.querySelector('[data-sat-room-context]')).not.toHaveTextContent('Server clock');
  });

  // The projection's module clock is absent until a module is started, and the
  // page must show the absence rather than a synthesized 0:00.
  it('shows no module clock for a student who has not started a module', () => {
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    const row = screen.getByRole('option', { name: 'Open Ananda S.' });
    expect(row.querySelector('.sat-room__row-sub')).toBeNull();
    expect(row).not.toHaveTextContent('Module 1');
  });

  it('keeps per-action pending isolated: one student action never freezes room controls', async () => {
    const { examDeliveryService } = await import('../../../../features/proctor/infrastructure/proctorGateway');
    let releaseExtend: (value: { success: boolean }) => void = () => { throw new Error('Extension request did not start'); };
    (examDeliveryService.extendStudentAttempt as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => { releaseExtend = resolve; }),
    );
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Add 5 minutes…' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Add 5 minutes for Ananda S.?');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Add 5 minutes' }));
    expect(screen.getByRole('button', { name: 'Pause exam' })).toBeEnabled();
    releaseExtend({ success: true });
    await screen.findByText(/Added 5 minutes for Ananda S/);
  });

  it('tones error banners as alerts and success banners as status', async () => {
    controllerMock.mockReset();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockRejectedValue(new Error('reload failed')), handleStartScheduledSession: vi.fn().mockResolvedValue(undefined), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Pause exam' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Exam paused. However, the live view could not refresh. Retry to confirm.');
  });

  it('reports a confirmed room completion accurately if the follow-up refresh fails', async () => {
    const reload = vi.fn().mockRejectedValue(new Error('reload failed'));
    vi.mocked(examDeliveryService.completeRuntime).mockResolvedValue({ success: true });
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student], alerts: [], error: null, isLoading: false,
      roomClock: resolvedRoomClock, reload, handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'End exam' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'End exam' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Room completed. However, the live view could not refresh. Retry to confirm.');
    expect(examDeliveryService.completeRuntime).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('asks staff to check the room when a warning response is lost', async () => {
    vi.mocked(examDeliveryService.warnStudent).mockResolvedValue({
      success: false, error: 'Connection lost', errorCause: new TypeError('Connection lost'), commandDispatched: true,
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Send warning…' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Send warning' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('may have been applied');
    expect(screen.getByRole('alert')).toHaveTextContent('Check the room before trying again.');
    expect(examDeliveryService.warnStudent).toHaveBeenCalledTimes(1);
  });

  it('moves through the roster with an arrow key from its single tab stop', () => {
    const second = { ...student, id: 'attempt-2', studentId: 'W2502', name: 'Budi T.', email: 'b@example.com' };
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student, second], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    const rail = screen.getByRole('listbox', { name: /students in this session/i });
    rail.focus();
    fireEvent.keyDown(rail, { key: 'ArrowDown' });

    const next = screen.getByRole('option', { name: 'Open Budi T.' });
    expect(next).toHaveAttribute('aria-selected', 'true');
    expect(next).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Budi T.' })).toBeInTheDocument();
  });

  it('opens the inspector as a modal when the room is too narrow to dock it, and restores focus to its roster trigger', async () => {
    const restoreMediaQuery = mockMeasuredRoomWidth(1000);
    const view = render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    try {
      const row = screen.getByRole('option', { name: 'Open Ananda S.' });
      fireEvent.click(row);

      const dialog = await screen.findByRole('dialog', { name: 'Selected student inspector' });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      expect(screen.getByRole('button', { name: 'Close student inspector' })).toHaveFocus();

      fireEvent.keyDown(dialog, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Selected student inspector' })).not.toBeInTheDocument());
      expect(row).toHaveFocus();
    } finally {
      view.unmount();
      restoreMediaQuery();
    }
  });

  it('keeps open alerts and student attention counts in the context bar', () => {
    controllerMock.mockReset();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student],
      alerts: [{ id: 'a1', isAcknowledged: false }], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    const counts = within(screen.getByLabelText('Student counts'));
    expect(counts.getByText(/Needs attention/)).toHaveTextContent('0 Needs attention');
    expect(counts.getByText(/Open alert/)).toHaveTextContent('1 Open alert');
  });

  it('previews a warning with exact copy before sending', async () => {
    const { examDeliveryService } = await import('../../../../features/proctor/infrastructure/proctorGateway');
    (examDeliveryService.warnStudent as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Send warning…' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Send warning to Ananda S.?');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Please return your attention to the exam.');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Send warning' }));
    expect(await screen.findByText(/Warning sent to Ananda S/)).toBeInTheDocument();
    expect(examDeliveryService.warnStudent).toHaveBeenCalledWith('attempt-1', 'Please return your attention to the exam.', expect.anything());
  });

  it('keeps student action pending and feedback on the selected attempt', async () => {
    const otherStudent = { ...student, id: 'attempt-2', studentId: 'W2502', name: 'Becky S.' };
    let finishWarning: (result: { success: boolean }) => void = () => {};
    vi.mocked(examDeliveryService.warnStudent).mockImplementationOnce(() => new Promise((resolve) => { finishWarning = resolve; }));
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student, otherStudent], alerts: [], error: null, isLoading: false,
      roomClock: resolvedRoomClock, reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(),
      handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(), handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Send warning…' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Send warning' }));
    await waitFor(() => expect(examDeliveryService.warnStudent).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('option', { name: 'Open Becky S.' }));
    expect(screen.getByRole('button', { name: 'Send warning…' })).toBeEnabled();
    await act(async () => { finishWarning({ success: true }); });
    expect(screen.queryByText(/Warning sent to Ananda S/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Open Ananda S.' }));
    expect(await screen.findByText(/Warning sent to Ananda S/)).toBeInTheDocument();
  });

  it('previews a time extension with remaining context before applying', async () => {
    const { examDeliveryService } = await import('../../../../features/proctor/infrastructure/proctorGateway');
    (examDeliveryService.extendStudentAttempt as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Add 5 minutes…' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Add 5 minutes for Ananda S.?');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Add 5 minutes' }));
    expect(await screen.findByText(/Added 5 minutes for Ananda S/)).toBeInTheDocument();
  });

  it('filters the roster to students with an open issue', () => {
    const flagged = { ...student, warnings: 1 };
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [flagged], alerts: [{
        id: 'alert-1', severity: 'medium', type: 'connection_lost', studentName: 'Ananda S.', studentId: 'W2501',
        timestamp: runtime.serverNow, message: 'Connection lost', isAcknowledged: false,
      }], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    const chip = screen.getByRole('button', { name: /Filter roster to students needing attention/ });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('uses the finished-room summary without removing the run sheet or student detail', () => {
    const finishedAt = '2026-08-30T03:00:00Z';
    const finishedRuntime = {
      ...runtime,
      status: 'completed',
      actualEndAt: finishedAt,
      currentSectionKey: null,
      sections: [{ ...runtime.sections[0], status: 'completed' as const, actualEndAt: finishedAt }],
    };
    controllerMock.mockReset();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [finishedRuntime], sessions: [student], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });

    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);

    expect(screen.getByRole('heading', { name: 'Room finished' })).toBeInTheDocument();
    expect(document.querySelector('.sat-room')).toHaveAttribute('data-sat-room-mode', 'review');
    expect(screen.getByTestId('sat-room-session-timing')).toHaveTextContent('09:00–10:00 ICT · 1 hr 0 min');
    expect(document.querySelector('.sat-room__clock')).toBeNull();
    const inspector = document.querySelector<HTMLElement>('.sat-room__inspector');
    expect(inspector).not.toBeNull();
    if (!inspector) throw new Error('room summary did not render');
    expect(screen.queryByRole('heading', { name: 'Waiting to begin' })).not.toBeInTheDocument();
    expect(screen.getByText('Run sheet')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ananda S.' })).toBeInTheDocument();
  });

  it('shows cancelled rooms in review without an active hero clock', () => {
    const cancelledRuntime = { ...runtime, status: 'cancelled', actualEndAt: '2026-08-30T02:30:00Z', currentSectionKey: null };
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [cancelledRuntime], sessions: [student], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);

    expect(document.querySelector('.sat-room')).toHaveAttribute('data-sat-room-mode', 'review');
    expect(screen.getByRole('heading', { name: 'Room cancelled' })).toBeInTheDocument();
    expect(document.querySelector('.sat-room__clock')).toBeNull();
    expect(screen.getByText('Run sheet')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ananda S.' })).toBeInTheDocument();
  });

  it('filters from the context attention count while keeping the inspector selected', () => {
    const flagged = { ...student, warnings: 1 };
    const clean = { ...student, id: 'attempt-2', studentId: 'W2502', name: 'Budi T.', email: 'b@example.com', warnings: 0, violations: [] as typeof student.violations };
    controllerMock.mockReset();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [flagged, clean], alerts: [{
        id: 'alert-1', severity: 'medium', type: 'connection_lost', studentName: 'Ananda S.', studentId: 'W2501',
        timestamp: runtime.serverNow, message: 'Connection lost', isAcknowledged: false,
      }], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);

    const workspace = document.querySelector<HTMLElement>('.sat-room__workspace');
    const inspector = document.querySelector<HTMLElement>('.sat-room__inspector');
    expect(workspace).not.toBeNull();
    expect(inspector).not.toBeNull();
    if (!workspace || !inspector) throw new Error('room workspace or inspector did not render');
    fireEvent.click(screen.getByRole('option', { name: 'Open Budi T.' }));
    expect(screen.getByRole('heading', { name: 'Budi T.' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Needs attention 1' }));
    expect(screen.getByRole('option', { name: /^Open Ananda S\., needs attention: / })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Open Budi T.' })).not.toBeInTheDocument();
    expect(screen.getByRole('listbox')).not.toHaveAttribute('aria-activedescendant');
    expect(screen.getByRole('heading', { name: 'Budi T.' })).toBeInTheDocument();
    expect(document.querySelector('.sat-room__workspace')).toBe(workspace);
  });

  it('falls back to the first remaining student when the selected student leaves', () => {
    const second = { ...student, id: 'attempt-2', studentId: 'W2502', name: 'Budi T.', email: 'b@example.com' };
    const base = {
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student, second], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    };
    controllerMock.mockReturnValue(base);
    const renderRoom = () => <MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>;
    const { rerender } = render(renderRoom());
    fireEvent.click(screen.getByRole('option', { name: 'Open Budi T.' }));
    expect(within(document.querySelector('.sat-room__inspector') as HTMLElement).getByRole('heading', { name: 'Budi T.' })).toBeInTheDocument();

    controllerMock.mockReturnValue({ ...base, sessions: [student] });
    rerender(renderRoom());
    expect(within(document.querySelector('.sat-room__inspector') as HTMLElement).getByRole('heading', { name: 'Ananda S.' })).toBeInTheDocument();
  });

  it('does not present a zero-count attention filter as an action', () => {
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByText('0', { selector: '.sat-room__attention-count' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Filter roster to students needing attention/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Needs attention 0' })).not.toBeInTheDocument();
  });

  it('binds the terminate confirm to the student captured at open, even if selection moves', async () => {
    const { examDeliveryService } = await import('../../../../features/proctor/infrastructure/proctorGateway');
    (examDeliveryService.terminateStudentAttempt as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
    const second = { ...student, id: 'attempt-2', studentId: 'W2502', name: 'Budi T.', email: 'b@example.com' };
    controllerMock.mockReset();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student, second], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'End attempt…' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('End Ananda S.’s attempt?');
    fireEvent.click(screen.getByRole('option', { name: 'Open Budi T.' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('End Ananda S.’s attempt?');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'End attempt' }));
    await waitFor(() => expect(examDeliveryService.terminateStudentAttempt).toHaveBeenCalledWith('attempt-1', expect.anything()));
    expect(screen.queryByText(/Ananda S.*attempt ended/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Open Ananda S.' }));
    expect(await screen.findByText(/Ananda S.*attempt ended/)).toBeInTheDocument();
  });

  it('shows an error instead of acting when the bound student left the roster', async () => {
    const { examDeliveryService } = await import('../../../../features/proctor/infrastructure/proctorGateway');
    (examDeliveryService.terminateStudentAttempt as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
    const second = { ...student, id: 'attempt-2', studentId: 'W2502', name: 'Budi T.', email: 'b@example.com' };
    const base = {
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student, second], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    };
    controllerMock.mockReset();
    controllerMock.mockReturnValue(base);
    const { rerender } = render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'End attempt…' }));
    controllerMock.mockReturnValue({ ...base, sessions: [second] });
    rerender(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'End attempt' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ananda S. is no longer in this room');
    expect(examDeliveryService.terminateStudentAttempt).not.toHaveBeenCalled();
  });

  it('marks loaded room data stale and disables risky actions while reconnecting', () => {
    controllerMock.mockReset();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student], alerts: [], error: 'Network unavailable', isLoading: false,
      lastSuccessfulRefreshAt: '2026-08-30T02:05:00.000Z', reload: vi.fn(), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('Data may be out of date');
    expect(screen.getByRole('button', { name: 'Pause exam' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('renders the Overrun badge when the room runs beyond its window', () => {
    controllerMock.mockReset();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [{ ...runtime, isOverrun: true }], sessions: [student], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByText(/Overrun · review extensions/)).toBeInTheDocument();
  });

  it('shows Reconnecting in the header while stale', () => {
    controllerMock.mockReset();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student], alerts: [], error: 'Network unavailable', isLoading: false,
      lastSuccessfulRefreshAt: '2026-08-30T02:05:00.000Z', reload: vi.fn(), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    expect(within(screen.getByRole('banner')).getByText('Reconnecting')).toBeInTheDocument();
  });

  it('keeps timers on tabular-nums so 1s ticks do not shift layout', () => {
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    expect(document.querySelector('.sat-room__clock')).toBeInTheDocument();
    expect(document.querySelector('.sat-room__row-time')).toBeInTheDocument();
    const css = readFileSync(resolve(__dirname, '../../ui/sat-session-room.css'), 'utf8');
    expect(css).toMatch(/\.sat-room__clock \{[^}]*font-variant-numeric: tabular-nums/);
  });

  it('filters to students with current open issues, not historical warnings', () => {
    const flagged = { ...student, warnings: 2 };
    const clean = { ...student, id: 'attempt-2', studentId: 'W2502', name: 'Budi T.', email: 'b@example.com', warnings: 0, violations: [] as string[] };
    controllerMock.mockReset();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [flagged, clean], alerts: [{
        id: 'alert-1', severity: 'medium', type: 'connection_lost', studentName: 'Ananda S.', studentId: 'W2501',
        timestamp: runtime.serverNow, message: 'Connection lost', isAcknowledged: false,
      }], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Filter roster to students needing attention/ }));
    expect(screen.getByRole('option', { name: /^Open Ananda S\., needs attention: / })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Open Budi T.' })).not.toBeInTheDocument();
  });

  it('disables student menu items while stale', () => {
    controllerMock.mockReset();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student], alerts: [], error: 'Network unavailable', isLoading: false,
      lastSuccessfulRefreshAt: '2026-08-30T02:05:00.000Z', reload: vi.fn(), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Add 5 minutes…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'End attempt…' })).toBeDisabled();
  });

  it('keeps banners on the entrance hook and confirms extend-room success copy', async () => {
    (examDeliveryService.extendCurrentSection as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
    controllerMock.mockReset();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn().mockResolvedValue(undefined), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add 5 minutes for the room' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Add 5 minutes to Reading & Writing?');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Add 5 minutes' }));
    expect(await screen.findByText('Added 5 minutes to Reading & Writing.')).toBeInTheDocument();
    expect(examDeliveryService.extendCurrentSection).toHaveBeenCalledWith('sched-1', 'SAT Proctor', 5, 'reading-writing', 7);
    expect(document.querySelector('.sat-banner-enter')).toBeInTheDocument();
  });

  it('refuses a time grant when the runtime revision has not arrived', () => {
    controllerMock.mockReturnValue({
      ...controllerMock(), runtimeSnapshots: [{ ...runtime, revision: undefined }],
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add 5 minutes for the room' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Refresh the room before adding time.');
    expect(examDeliveryService.extendCurrentSection).not.toHaveBeenCalled();
  });

  // The room's timers are the one thing a proctor cross-checks by eye: the hero
  // clock, the run sheet, the roster row and the inspector all name the same
  // section clock, so they must read the same instant. They used to be four
  // independent corrections — two bands, three sources — and drifted seconds
  // apart, which is what "the timer is not in sync" looked like on screen.
  describe('one clock across the room', () => {
    const readingOf = (label: string) =>
      Array.from(document.querySelectorAll('.sat-room__inspector-panel dl dt'))
        .find((node) => node.textContent === label)
        ?.parentElement?.querySelector('dd')?.textContent ?? null;

    function renderClockedRoom() {
      const now = Date.now();
      const deadline = new Date(now + 9 * 60_000).toISOString();
      const serverNow = new Date(now).toISOString();
      const clockedRuntime = {
        ...runtime,
        currentSectionDeadlineAt: deadline,
        currentSectionRemainingSeconds: 540,
        serverNow,
      };
      const clockedStudent = {
        ...student,
        runtimeStatus: 'live' as const,
        runtimeSectionStatus: 'live' as const,
        runtimeDeadlineAt: deadline,
        runtimeServerNow: serverNow,
        runtimeModuleRole: 'base' as const,
        runtimeModuleDeadlineAt: new Date(now + 5 * 60_000).toISOString(),
        runtimeModuleRemainingSeconds: 300,
      };
      controllerMock.mockReset();
      controllerMock.mockReturnValue({
        schedules: [schedule], runtimeSnapshots: [clockedRuntime], sessions: [clockedStudent], alerts: [], error: null, isLoading: false,
        roomClock: { serverNow, receivedAt: now },
        reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
        handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
      });
      render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
      return {
        hero: document.querySelector('.sat-room__clock')?.textContent ?? null,
        row: screen.getByRole('option', { name: 'Open Ananda S.' }),
        sheetSection: document.querySelector('[data-sat-run-sheet-remaining="section"] span:last-child')?.textContent ?? null,
      };
    }

    it('reads the same section clock on the hero, the roster, the run sheet and the inspector', () => {
      const { hero, row, sheetSection } = renderClockedRoom();

      expect(hero).toMatch(/^\d{1,2}:\d{2}$/);
      // The roster row names the room's clock beside the candidate's module clock.
      expect(row.querySelector('.sat-room__row-sub')?.textContent).toBe(`Section clock ${hero}`);
      // The run sheet's live section row counts the same deadline.
      expect(sheetSection).toBe(hero);
      // The inspector's section clock is the candidate's window on that same clock.
      expect(readingOf('Section clock')).toBe(hero);
      // The module clock stays the candidate's own window, not the section's.
      expect(readingOf('Module clock')).toMatch(/^\d{1,2}:\d{2}$/);
      expect(readingOf('Module clock')).not.toBe(hero);
    });

    it('keeps the roster row precise for the selected student instead of riding the 15s band', () => {
      const { hero, row } = renderClockedRoom();
      // Same instant, both surfaces: a coarse row could show this clock up to 15
      // seconds away from the hero clock the proctor is reading beside it.
      expect(row.querySelector('.sat-room__row-sub')?.textContent).toBe(`Section clock ${hero}`);
    });
  });

  describe('room ops hierarchy (phase 04)', () => {
    const room = () => render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);

    it('renders roster rows with at most two text lines', () => {
      room();
      const row = screen.getByRole('option', { name: 'Open Ananda S.' });
      // Left cell holds name + single merged section-status line; the timer
      // stays in its own tabular group on the right.
      expect(row.querySelector('.sat-room__row-name')).not.toBeNull();
      // The left cell owns exactly one name line and one merged status line.
      expect(row.querySelectorAll('.sat-room__row-name, .sat-room__row-meta')).toHaveLength(2);
      expect(row.querySelector('.sat-room__row-meta')).not.toBeNull();
      expect(row).toHaveTextContent(/reading/);
      expect(row).toHaveTextContent(/Working/);
      expect(row.querySelector('.sat-room__row-time')).toBeInTheDocument();
    });

    it('keeps the type floor at 11px in owned room markup', () => {
      // Scope the floor gate to Phase 04-owned Room markup: the shared
      // SatStatusPill primitive still bridges at text-[10px] (Phase 01
      // exception), so assert the owned source, not rendered output.
      const source = readFileSync(resolve(__dirname, '../SatSessionRoomRoute.tsx'), 'utf8');
      expect(source).not.toMatch(/text-\[8px\]/);
      expect(source).not.toMatch(/text-\[9px\]/);
      expect(source).not.toMatch(/text-\[10px\]/);
    });

    it('resolves dots to staff tokens, not slate literals', () => {
      const { container } = room();
      expect(container.querySelector('[class*="bg-slate-300"]')).toBeNull();
      expect(container.querySelector('[class*="bg-emerald-500"]')).toBeNull();
      const row = screen.getByRole('option', { name: 'Open Ananda S.' });
      expect(row.querySelector('[class*="--sat-staff-"]')).toBeInTheDocument();
    });

    it('keeps the hero clock and tabular timers after compress', () => {
      const { container } = room();
      const hero = container.querySelector('.sat-room__clock');
      expect(hero).toBeInTheDocument();
      // The clock earns its 32px scale from the room stylesheet, and the
      // tabular figures live there too so the digits never jitter.
      const css = readFileSync(resolve(__dirname, '../../ui/sat-session-room.css'), 'utf8');
      expect(css).toMatch(/\.sat-room__clock \{[^}]*font-variant-numeric: tabular-nums/);
      const row = screen.getByRole('option', { name: 'Open Ananda S.' });
      expect(row.querySelector('.sat-room__row-time')).toBeInTheDocument();
    });
  });
});
