import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
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
  gradingDisplayName: 'Practice Test 06', publishedVersionId: 'v1', cohortName: 'Morning', startTime: '2026-08-30T02:00:00Z',
  endTime: '2026-08-30T06:00:00Z', plannedDurationMinutes: 180, deliveryMode: 'proctor_start', autoStart: false, autoStop: false,
  status: 'live', createdAt: '2026-08-30T00:00:00Z', createdBy: 'Admin', updatedAt: '2026-08-30T00:00:00Z',
};
const runtime = {
  id: 'runtime-1', scheduleId: 'sched-1', examId: 'sat-1', providerKey: 'sat', examTitle: 'Practice Test 06', cohortName: 'Morning',
  deliveryMode: 'proctor_start', status: 'live', timingModel: 'cohort_section_v3', actualStartAt: '2026-08-30T02:00:00Z', actualEndAt: null,
  activeSectionKey: 'reading', currentSectionKey: 'reading', currentSectionRemainingSeconds: 1603, waitingForNextSection: false, isOverrun: false,
  totalPausedSeconds: 0, sections: [{ sectionKey: 'reading', label: 'Reading & Writing · Module 1', order: 1, plannedDurationMinutes: 32,
    gapAfterMinutes: 0, status: 'live', availableAt: null, actualStartAt: '2026-08-30T02:00:00Z', actualEndAt: null, pausedAt: null,
    accumulatedPausedSeconds: 0, extensionMinutes: 0 }], createdAt: '2026-08-30T02:00:00Z', updatedAt: '2026-08-30T02:05:00Z',
};
const student = {
  id: 'attempt-1', studentId: 'W2501', name: 'Ananda S.', email: 'a@example.com', scheduleId: 'sched-1', status: 'active',
  currentSection: 'reading', timeRemaining: 1500, runtimeStatus: 'live', runtimeCurrentSection: 'reading', runtimeTimeRemainingSeconds: 1500,
  violations: [], warnings: 0, lastActivity: '2026-08-30T02:05:00Z', examId: 'sat-1', examName: 'Practice Test 06',
};

describe('SatSessionRoomRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student], alerts: [], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
  });

  it('opens the controller explicitly in the SAT provider boundary', () => {
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    expect(controllerMock).toHaveBeenCalledWith({ providerKey: 'sat', initialScheduleId: 'sched-1' });
    expect(screen.getAllByText('Reading & Writing · Module 1')).toHaveLength(2);
    expect(screen.getByText('Server-authoritative session clock')).toBeInTheDocument();
    expect(screen.getAllByText('Ananda S.')).toHaveLength(2);
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

  it('moves through the roster with arrow keys from a single tab stop', () => {
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    const rail = screen.getByRole('listbox', { name: /students in this session/i });
    expect(rail).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Open Ananda S.' })).toHaveAttribute('aria-selected', 'true');
  });

  it('pins the attention queue when alerts are open', () => {
    controllerMock.mockReset();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student],
      alerts: [{ id: 'a1', isAcknowledged: false }], error: null, isLoading: false,
      reload: vi.fn().mockResolvedValue(undefined), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByRole('button', { name: /student needs? attention/ })).toHaveTextContent('needs attention');
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
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    const chip = screen.getByRole('button', { name: 'Needs attention' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
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
    expect(screen.getByText('Overrun')).toBeInTheDocument();
  });

  it('shows Reconnecting in the header while stale', () => {
    controllerMock.mockReset();
    controllerMock.mockReturnValue({
      schedules: [schedule], runtimeSnapshots: [runtime], sessions: [student], alerts: [], error: 'Network unavailable', isLoading: false,
      lastSuccessfulRefreshAt: '2026-08-30T02:05:00.000Z', reload: vi.fn(), handleStartScheduledSession: vi.fn(), handlePauseCohort: vi.fn(), handleResumeCohort: vi.fn(),
      handleExtendCurrentSection: vi.fn(), handleCompleteExam: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByText('Reconnecting')).toBeInTheDocument();
  });

  it('keeps timers on tabular-nums so 1s ticks do not shift layout', () => {
    render(<MemoryRouter initialEntries={['/sat/sessions/sched-1']}><Routes><Route path="/sat/sessions/:scheduleId" element={<SatSessionRoomRoute />} /></Routes></MemoryRouter>);
    // Stage hero timer (36px) + roster-row timer each carry tabular-nums.
    const timers = document.querySelectorAll('.tabular-nums');
    expect(timers.length).toBeGreaterThanOrEqual(2);
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
    fireEvent.click(screen.getByRole('button', { name: 'Needs attention' }));
    expect(screen.getByRole('option', { name: 'Open Ananda S.' })).toBeInTheDocument();
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
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Add 5 minutes to Reading & Writing · Module 1?');
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
      // stays a separate tabular p on the right per the Step 5 structure.
      expect(row.querySelector('div.min-w-0')?.querySelectorAll('p')).toHaveLength(2);
      expect(row).toHaveTextContent(/reading/);
      expect(row).toHaveTextContent(/active/);
      expect(row.querySelector('.tabular-nums')).toBeInTheDocument();
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
      const hero = container.querySelector('[class*="text-[36px]"]');
      expect(hero).toBeInTheDocument();
      expect(hero?.className).toMatch(/tabular-nums/);
      const row = screen.getByRole('option', { name: 'Open Ananda S.' });
      expect(row.querySelector('.tabular-nums')).toBeInTheDocument();
    });

    it('sits InfoRow labels on the eyebrow floor', () => {
      room();
      const labels = document.querySelectorAll('aside dt');
      expect(labels.length).toBeGreaterThan(0);
      labels.forEach((label) => {
        expect(label.className).toMatch(/text-\[11px\]/);
        expect(label.className).toMatch(/uppercase/);
      });
    });
  });
});
