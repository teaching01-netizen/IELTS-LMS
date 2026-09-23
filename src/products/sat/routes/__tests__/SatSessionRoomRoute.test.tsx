import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SatSessionRoomRoute } from '../SatSessionRoomRoute';

const controllerMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../features/proctor/hooks/useProctorRouteController', () => ({ useProctorRouteController: controllerMock }));
vi.mock('../../../../features/auth/authSession', () => ({
  useAuthSession: () => ({ session: { user: { displayName: 'SAT Proctor', email: 'p@example.com' } } }),
}));
vi.mock('../../../../features/proctor/infrastructure/proctorGateway', () => ({
  examDeliveryService: {
    extendStudentAttempt: vi.fn(), warnStudent: vi.fn(), pauseStudentAttempt: vi.fn(), resumeStudentAttempt: vi.fn(), terminateStudentAttempt: vi.fn(),
  },
}));

const schedule = {
  id: 'sched-1', examId: 'sat-1', providerKey: 'sat', examTitle: 'Practice Test 06', proctorDisplayName: 'Practice Test 06',
  gradingDisplayName: 'Practice Test 06', publishedVersionId: 'v1', publishScope: 'reading-writing', cohortName: 'Morning', startTime: '2026-08-30T02:00:00Z',
  endTime: '2026-08-30T06:00:00Z', plannedDurationMinutes: 180, deliveryMode: 'proctor_start', autoStart: false, autoStop: false,
  status: 'live', createdAt: '2026-08-30T00:00:00Z', createdBy: 'Admin', updatedAt: '2026-08-30T00:00:00Z',
};
const runtime = {
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

function useTabletMediaQuery() {
  const previous = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  const mediaQuery = {
    matches: true,
    media: '(min-width: 1024px) and (max-width: 1439px)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  };
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => mediaQuery),
  });

  return () => {
    if (previous) Object.defineProperty(window, 'matchMedia', previous);
    else Reflect.deleteProperty(window, 'matchMedia');
  };
}

describe('SatSessionRoomRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
  });

  it('shows its loading state before the first runtime snapshot arrives', () => {
    controllerMock.mockReturnValue({
      schedules: [], runtimeSnapshots: [], sessions: [], alerts: [], error: null, isLoading: true,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });

    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);

    expect(screen.getByText('Opening SAT session…')).toBeInTheDocument();
  });

  it('opens the controller explicitly in the SAT provider boundary', () => {
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    expect(controllerMock).toHaveBeenCalledWith({ providerKey: 'sat', initialScheduleId: 'sched-1' });
    expect(document.querySelector('.sat-room')).toHaveAttribute('data-sat-room-mode', 'live');
    expect(screen.getByText('Morning · Reading & Writing only')).toBeInTheDocument();
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

  it('starts a prestart session through the existing controller action', async () => {
    const startSession = vi.fn().mockResolvedValue(undefined);
    const prestartRuntime = { ...runtime, status: 'not_started', actualStartAt: null, currentSectionKey: null, sections: [] };
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [prestartRuntime], sessions: [], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: startSession, handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect(await screen.findByText('Session started.')).toBeInTheDocument();
    expect(startSession).toHaveBeenCalledWith('sched-1');
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
    expect(row).toHaveTextContent('Reading & Writing · Module 1 · active');
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
    expect(document.querySelector('[data-sat-room-context]')).toHaveTextContent('Online');
    expect(document.querySelector('[data-sat-room-context]')).toHaveTextContent('Server clock');
  });

  // The projection's module clock is absent until a module is started, and the
  // page must show the absence rather than a synthesized 0:00.
  it('shows no module clock for a student who has not started a module', () => {
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    const row = screen.getByRole('option', { name: 'Open Ananda S.' });
    expect(row.querySelector('.sat-room__row-sub')).toBeNull();
    expect(row).not.toHaveTextContent('Module 1');
  });

  it('keeps per-action pending isolated: one student action never freezes session controls', async () => {
    const { examDeliveryService } = await import('../../../../features/proctor/infrastructure/proctorGateway');
    let releaseExtend: ((value: { success: boolean }) => void) | null = null;
    (examDeliveryService.extendStudentAttempt as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => { releaseExtend = resolve; }),
    );
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Student actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add 5 minutes…' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Add 5 minutes for Ananda S.?');
    fireEvent.click(screen.getByRole('button', { name: 'Add 5 Minutes' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
    releaseExtend?.({ success: true });
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
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Session paused. However, the live view could not refresh. Retry to confirm.');
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

  it('opens the tablet inspector as a modal and restores focus to its roster trigger', async () => {
    const restoreMediaQuery = useTabletMediaQuery();
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
    expect(screen.getByText('0 need attention')).toBeInTheDocument();
    expect(document.querySelector('[data-sat-room-context]')).toHaveTextContent('1 open alert');
  });

  it('previews a warning with exact copy before sending', async () => {
    const { examDeliveryService } = await import('../../../../features/proctor/infrastructure/proctorGateway');
    (examDeliveryService.warnStudent as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Student actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Send warning…' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Send warning to Ananda S.?');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Please return your attention to the exam.');
    fireEvent.click(screen.getByRole('button', { name: 'Send Warning' }));
    expect(await screen.findByText(/Warning sent to Ananda S/)).toBeInTheDocument();
    expect(examDeliveryService.warnStudent).toHaveBeenCalledWith('attempt-1', 'Please return your attention to the exam.', expect.anything());
  });

  it('previews a time extension with remaining context before applying', async () => {
    const { examDeliveryService } = await import('../../../../features/proctor/infrastructure/proctorGateway');
    (examDeliveryService.extendStudentAttempt as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Student actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add 5 minutes…' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Add 5 minutes for Ananda S.?');
    fireEvent.click(screen.getByRole('button', { name: 'Add 5 Minutes' }));
    expect(await screen.findByText(/Added 5 minutes for Ananda S/)).toBeInTheDocument();
  });

  it('filters the roster to students needing attention', () => {
    const flagged = { ...student, warnings: 1 };
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [flagged], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    const chip = screen.getByRole('button', { name: /Filter roster to students needing attention/ });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('uses the finished-session summary without removing the run sheet or student detail', () => {
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

    expect(screen.getByRole('heading', { name: 'Session finished' })).toBeInTheDocument();
    expect(document.querySelector('.sat-room')).toHaveAttribute('data-sat-room-mode', 'review');
    expect(screen.getByTestId('sat-room-session-timing')).toHaveTextContent('09:00–10:00 ICT · 1 hr 0 min');
    expect(document.querySelector('.sat-room__clock')).toBeNull();
    const inspector = document.querySelector<HTMLElement>('.sat-room__inspector');
    expect(inspector).not.toBeNull();
    if (!inspector) throw new Error('session summary did not render');
    expect(screen.queryByRole('heading', { name: 'Waiting to begin' })).not.toBeInTheDocument();
    expect(screen.getByText('Run sheet')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ananda S.' })).toBeInTheDocument();
  });

  it('shows cancelled sessions in review without an active hero clock', () => {
    const cancelledRuntime = { ...runtime, status: 'cancelled', actualEndAt: '2026-08-30T02:30:00Z', currentSectionKey: null };
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [cancelledRuntime], sessions: [student], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);

    expect(document.querySelector('.sat-room')).toHaveAttribute('data-sat-room-mode', 'review');
    expect(screen.getByRole('heading', { name: 'Session cancelled' })).toBeInTheDocument();
    expect(document.querySelector('.sat-room__clock')).toBeNull();
    expect(screen.getByText('Run sheet')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ananda S.' })).toBeInTheDocument();
  });

  it('filters from the context attention count while keeping the inspector selected', () => {
    const flagged = { ...student, warnings: 1 };
    const clean = { ...student, id: 'attempt-2', studentId: 'W2502', name: 'Budi T.', email: 'b@example.com', warnings: 0, violations: [] as typeof student.violations };
    controllerMock.mockReset();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [flagged, clean], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);

    const workspace = document.querySelector<HTMLElement>('.sat-room__workspace');
    const inspector = document.querySelector<HTMLElement>('.sat-room__inspector');
    expect(workspace).not.toBeNull();
    expect(inspector).not.toBeNull();
    if (!workspace || !inspector) throw new Error('session workspace or inspector did not render');
    fireEvent.click(screen.getByRole('option', { name: 'Open Budi T.' }));
    expect(screen.getByRole('heading', { name: 'Budi T.' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Needs attention 1' }));
    expect(screen.getByRole('option', { name: 'Open Ananda S., needs attention' })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Student actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'End attempt…' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('End Ananda S.’s attempt?');
    fireEvent.click(screen.getByRole('option', { name: 'Open Budi T.' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('End Ananda S.’s attempt?');
    fireEvent.click(screen.getByRole('button', { name: 'End Attempt' }));
    expect(await screen.findByText(/Ananda S.*attempt ended/)).toBeInTheDocument();
    expect(examDeliveryService.terminateStudentAttempt).toHaveBeenCalledWith('attempt-1', expect.anything());
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
    fireEvent.click(screen.getByRole('button', { name: 'Student actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'End attempt…' }));
    controllerMock.mockReturnValue({ ...base, sessions: [second] });
    rerender(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'End Attempt' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ananda S. is no longer in this session');
    expect(examDeliveryService.terminateStudentAttempt).not.toHaveBeenCalled();
  });

  it('marks loaded session data stale and disables risky actions while reconnecting', () => {
    controllerMock.mockReset();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student], alerts: [], error: 'Network unavailable', isLoading: false,
      lastSuccessfulRefreshAt: '2026-08-30T02:05:00.000Z', reload: vi.fn(), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('Data may be out of date');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('renders the Overrun badge when the session runs beyond its window', () => {
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
    expect(css).toMatch(/\.sat-room__row-time \{[^}]*font-variant-numeric: tabular-nums/);
  });

  it('combines search and attention filters with AND semantics', () => {
    const flagged = { ...student, warnings: 2 };
    const clean = { ...student, id: 'attempt-2', studentId: 'W2502', name: 'Budi T.', email: 'b@example.com', warnings: 0, violations: [] as string[] };
    controllerMock.mockReset();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [flagged, clean], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Filter roster to students needing attention/ }));
    expect(screen.getByRole('option', { name: 'Open Ananda S., needs attention' })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Student actions' }));
    expect(screen.getByRole('menuitem', { name: 'Add 5 minutes…' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'End attempt…' })).toBeDisabled();
  });

  it('keeps banners on the entrance hook and confirms extend-session success copy', async () => {
    controllerMock.mockReset();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn().mockResolvedValue(undefined), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Session actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add 5 minutes' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Add 5 minutes to Reading & Writing?');
    fireEvent.click(screen.getByRole('button', { name: 'Add 5 Minutes' }));
    expect(await screen.findByText('Added 5 minutes to the current stage.')).toBeInTheDocument();
    expect(document.querySelector('.sat-banner-enter')).toBeInTheDocument();
  });

  describe('session room ops hierarchy (phase 04)', () => {
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
      expect(row).toHaveTextContent(/active/);
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

    it('keeps selected-student inspector labels on the eyebrow floor', () => {
      room();
      const labels = document.querySelectorAll('.sat-room__inspector dt.sat-room__eyebrow');
      expect(labels.length).toBeGreaterThan(0);
      const css = readFileSync(resolve(__dirname, '../../ui/sat-session-room.css'), 'utf8');
      expect(css).toMatch(/\.sat-room__eyebrow \{[^}]*text-transform: uppercase/);
      expect(css).toMatch(/\.sat-room__student-state-grid dd \{[^}]*font-size: 13px/);
    });
  });
});
