import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProctorDashboard } from '../ProctorDashboard';
import { examDeliveryService } from '../../../services/examDeliveryService';
import { proctorMutations } from '../../../features/proctor/api/proctorMutations';
import type { CommandOutcome } from '../../../features/proctor/domain/commandOutcome';
import type { ProctorViewCommands } from '../../../features/proctor/contracts';
import type { ExamSchedule, ExamSessionRuntime } from '../../../types/domain';

const CONFIRMED: CommandOutcome = { kind: 'confirmed' };

/** View commands that reach the real delivery seam, so service spies still observe the wire call. */
function fakeCommands() {
  return {
    resolveRecovery: vi.fn<ProctorViewCommands['resolveRecovery']>(async () => CONFIRMED),
    studentAction: vi.fn<ProctorViewCommands['studentAction']>((session, action, actor, message) =>
      action === 'warn' ? proctorMutations.warnStudent(session.id, message ?? 'Warning issued by proctor', actor)
      : action === 'pause' ? proctorMutations.pauseStudent(session.id, actor)
      : action === 'resume' ? proctorMutations.resumeStudent(session.id, actor)
      : proctorMutations.terminateStudent(session.id, actor)),
    extendStudent: vi.fn<ProctorViewCommands['extendStudent']>((session, minutes, actor) =>
      proctorMutations.extendStudent(session.id, actor, minutes, session.runtimeCurrentModuleId)),
    acknowledgeAlerts: vi.fn<ProctorViewCommands['acknowledgeAlerts']>(async () => CONFIRMED),
    saveNote: vi.fn<ProctorViewCommands['saveNote']>((note) => proctorMutations.saveNote(note)),
    deleteNote: vi.fn<ProctorViewCommands['deleteNote']>((note) => proctorMutations.deleteNote(note.id)),
    saveRule: vi.fn<ProctorViewCommands['saveRule']>((rule) => proctorMutations.saveRule(rule)),
    deleteRule: vi.fn<ProctorViewCommands['deleteRule']>((rule) => proctorMutations.deleteRule(rule.id)),
  } satisfies ProctorViewCommands;
}

describe('ProctorDashboard runtime controls', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  type DashboardProps = React.ComponentProps<typeof ProctorDashboard>;

  function DashboardHarness({
    scheduleMetrics = {},
    commands,
    ...props
  }: Omit<DashboardProps, 'selectedScheduleId' | 'onSelectScheduleId' | 'scheduleMetrics' | 'commands'> & {
    scheduleMetrics?: DashboardProps['scheduleMetrics'];
    commands?: ProctorViewCommands;
    selectedScheduleId?: string | null;
    onSelectScheduleId?: (id: string | null) => void;
  }) {
    const [selectedScheduleId, onSelectScheduleId] = React.useState<string | null>(null);
    const [defaultCommands] = React.useState(fakeCommands);
    return (
      <ProctorDashboard
        {...props}
        commands={commands ?? defaultCommands}
        scheduleMetrics={scheduleMetrics}
        selectedScheduleId={selectedScheduleId}
        onSelectScheduleId={onSelectScheduleId}
      />
    );
  }

  const baseSchedule: ExamSchedule = {
    id: 'sched-1',
    examId: 'exam-1',
    providerKey: 'ielts',
    examTitle: 'Mock Exam',
    proctorDisplayName: 'Mock Exam',
    gradingDisplayName: 'Mock Exam',
    publishedVersionId: 'ver-1',
    cohortName: 'Cohort A',
    startTime: '2026-01-01T00:10:00.000Z',
    endTime: '2026-01-01T03:10:00.000Z',
    plannedDurationMinutes: 180,
    deliveryMode: 'proctor_start',
    autoStart: false,
    autoStop: false,
    status: 'scheduled',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'Admin',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };

  const liveRuntime: ExamSessionRuntime = {
    id: 'runtime-1',
    scheduleId: 'sched-1',
    examId: 'exam-1',
    providerKey: 'ielts',
    examTitle: 'Mock Exam',
    cohortName: 'Cohort A',
    deliveryMode: 'proctor_start',
    status: 'live',
    actualStartAt: '2026-01-01T00:10:00.000Z',
    actualEndAt: null,
    activeSectionKey: 'reading',
    currentSectionKey: 'reading',
    currentSectionRemainingSeconds: 1200,
    waitingForNextSection: false,
    isOverrun: true,
    totalPausedSeconds: 0,
    sections: [
      {
        sectionKey: 'reading',
        label: 'Reading',
        order: 1,
        plannedDurationMinutes: 60,
        gapAfterMinutes: 0,
        status: 'live',
        availableAt: '2026-01-01T00:10:00.000Z',
        actualStartAt: '2026-01-01T00:10:00.000Z',
        actualEndAt: null,
        pausedAt: null,
        accumulatedPausedSeconds: 0,
        extensionMinutes: 10,
        projectedStartAt: '2026-01-01T00:10:00.000Z',
        projectedEndAt: '2026-01-01T01:20:00.000Z'
      }
    ],
    createdAt: '2026-01-01T00:10:00.000Z',
    updatedAt: '2026-01-01T00:10:00.000Z'
  };

  it('keeps start disabled until a cohort is selected', () => {
    render(
      <DashboardHarness
        schedules={[baseSchedule]}
        runtimeSnapshots={[]}
        sessions={[]}
        alerts={[]}
        onStartScheduledSession={vi.fn()}
        onPauseCohort={vi.fn()}
        onResumeCohort={vi.fn()}
        onEndSectionNow={vi.fn()}
        onExtendCurrentSection={vi.fn()}
        onCompleteExam={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /Start Exam/i })).toBeDisabled();
  });

  it('allows a proctor to force start a selected scheduled cohort before the window opens', async () => {
    const onStartScheduledSession = vi.fn();
    render(
      <DashboardHarness
        schedules={[baseSchedule]}
        runtimeSnapshots={[]}
        sessions={[]}
        alerts={[]}
        onStartScheduledSession={onStartScheduledSession}
        onPauseCohort={vi.fn()}
        onResumeCohort={vi.fn()}
        onEndSectionNow={vi.fn()}
        onExtendCurrentSection={vi.fn()}
        onCompleteExam={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /monitor mock exam for cohort cohort a/i }));

    const startButton = screen.getByRole('button', { name: /Start Exam/i });
    expect(startButton).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(startButton);
    });

    expect(onStartScheduledSession).toHaveBeenCalledWith('sched-1');
  });

  it('keeps completed and cancelled cohorts out of Active until Past is selected', () => {
    const completedSchedule: ExamSchedule = {
      ...baseSchedule,
      id: 'sched-completed',
      proctorDisplayName: 'Completed Exam',
      cohortName: 'Completed Cohort',
      status: 'completed',
      startTime: '2026-01-01T00:00:00.000Z',
    };
    const cancelledSchedule: ExamSchedule = {
      ...baseSchedule,
      id: 'sched-cancelled',
      proctorDisplayName: 'Cancelled Exam',
      cohortName: 'Cancelled Cohort',
      status: 'cancelled',
      startTime: '2026-01-01T00:05:00.000Z',
    };

    render(
      <DashboardHarness
        schedules={[baseSchedule, completedSchedule, cancelledSchedule]}
        runtimeSnapshots={[]}
        sessions={[]}
        alerts={[]}
        onStartScheduledSession={vi.fn()}
        onPauseCohort={vi.fn()}
        onResumeCohort={vi.fn()}
        onEndSectionNow={vi.fn()}
        onExtendCurrentSection={vi.fn()}
        onCompleteExam={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /monitor mock exam for cohort cohort a/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /monitor completed exam for cohort completed cohort/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /monitor cancelled exam for cohort cancelled cohort/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /past sessions/i }));

    expect(screen.queryByRole('button', { name: /monitor mock exam for cohort cohort a/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /monitor completed exam for cohort completed cohort/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /monitor cancelled exam for cohort cancelled cohort/i })).toBeInTheDocument();
  });

  it('filters Past cohorts by completed or cancelled status', () => {
    const completedSchedule: ExamSchedule = {
      ...baseSchedule,
      id: 'sched-completed',
      proctorDisplayName: 'Completed Exam',
      cohortName: 'Completed Cohort',
      status: 'completed',
      startTime: '2026-01-01T00:00:00.000Z',
    };
    const cancelledSchedule: ExamSchedule = {
      ...baseSchedule,
      id: 'sched-cancelled',
      proctorDisplayName: 'Cancelled Exam',
      cohortName: 'Cancelled Cohort',
      status: 'cancelled',
      startTime: '2026-01-01T00:05:00.000Z',
    };

    render(
      <DashboardHarness
        schedules={[completedSchedule, cancelledSchedule]}
        runtimeSnapshots={[]}
        sessions={[]}
        alerts={[]}
        onStartScheduledSession={vi.fn()}
        onPauseCohort={vi.fn()}
        onResumeCohort={vi.fn()}
        onEndSectionNow={vi.fn()}
        onExtendCurrentSection={vi.fn()}
        onCompleteExam={vi.fn()}
      />
    );

    expect(screen.getByText(/no active sessions/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /past sessions/i }));

    const pastStatusFilter = screen.getByRole('combobox', { name: /past status/i });
    fireEvent.change(pastStatusFilter, { target: { value: 'completed' } });

    expect(screen.getByRole('button', { name: /monitor completed exam for cohort completed cohort/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /monitor cancelled exam for cohort cancelled cohort/i })).not.toBeInTheDocument();

    fireEvent.change(pastStatusFilter, { target: { value: 'cancelled' } });

    expect(screen.queryByRole('button', { name: /monitor completed exam for cohort completed cohort/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /monitor cancelled exam for cohort cancelled cohort/i })).toBeInTheDocument();
  });

  it('shows an overrun warning when runtime extends past the scheduled window', () => {
    render(
      <DashboardHarness
        schedules={[{ ...baseSchedule, status: 'live', startTime: '2026-01-01T00:00:00.000Z' }]}
        runtimeSnapshots={[liveRuntime]}
        sessions={[]}
        alerts={[]}
        onStartScheduledSession={vi.fn()}
        onPauseCohort={vi.fn()}
        onResumeCohort={vi.fn()}
        onEndSectionNow={vi.fn()}
        onExtendCurrentSection={vi.fn()}
        onCompleteExam={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /monitor mock exam for cohort cohort a/i }));
    expect(screen.getByText(/running past the scheduled window/i)).toBeTruthy();
    // S3-C5: End Section is a live cohort control — present in the overrun
    // state, armed behind its own confirm dialog.
    expect(screen.getByRole('button', { name: /end section/i })).toBeInTheDocument();
  });

  it('opens the end-section confirm dialog from the End Section control', () => {
    render(
      <DashboardHarness
        schedules={[{ ...baseSchedule, status: 'live', startTime: '2026-01-01T00:00:00.000Z' }]}
        runtimeSnapshots={[liveRuntime]}
        sessions={[]}
        alerts={[]}
        onStartScheduledSession={vi.fn()}
        onPauseCohort={vi.fn()}
        onResumeCohort={vi.fn()}
        onEndSectionNow={vi.fn()}
        onExtendCurrentSection={vi.fn()}
        onCompleteExam={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /monitor mock exam for cohort cohort a/i }));
    fireEvent.click(screen.getByRole('button', { name: /^end section$/i }));
    expect(screen.getByText(/end the current section now/i)).toBeInTheDocument();
  });

  it('opens student detail in a full-page split view with roster rail', () => {
    render(
      <DashboardHarness
        schedules={[{ ...baseSchedule, status: 'live', startTime: '2026-01-01T00:00:00.000Z' }]}
        runtimeSnapshots={[liveRuntime]}
        sessions={[
          {
            id: 'student-1',
            studentId: 'STU-001',
            name: 'Jane Roe',
            email: 'jane@example.com',
            scheduleId: 'sched-1',
            status: 'active',
            currentSection: 'reading',
            timeRemaining: 1200,
            runtimeStatus: 'live',
            runtimeCurrentSection: 'reading',
            runtimeTimeRemainingSeconds: 1200,
            runtimeWaiting: false,
            violations: [],
            warnings: 0,
            lastActivity: '2026-01-01T00:12:00.000Z',
            examId: 'exam-1',
            examName: 'Mock Exam',
          },
        ]}
        alerts={[]}
        notes={[]}
        auditLogs={[]}
        onStartScheduledSession={vi.fn()}
        onPauseCohort={vi.fn()}
        onResumeCohort={vi.fn()}
        onEndSectionNow={vi.fn()}
        onExtendCurrentSection={vi.fn()}
        onCompleteExam={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /monitor mock exam for cohort cohort a/i }));
    expect(screen.getByText(/1 students/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /open jane roe session details/i }));
    expect(screen.getByText(/activity system scoped to cohort a/i)).toBeTruthy();
    expect(screen.getByText(/cohort roster/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /back to list/i })).toBeTruthy();
    expect(screen.getAllByText(/jane@example.com/i).length).toBeGreaterThan(0);
  });

  it('reacts to rail selection changes by opening the matching student activity tab', () => {
    const baseProps = {
      schedules: [{ ...baseSchedule, status: 'live' as const, startTime: '2026-01-01T00:00:00.000Z' }],
      runtimeSnapshots: [liveRuntime],
      sessions: [
        {
          id: 'student-1',
          studentId: 'STU-001',
          name: 'Jane Roe',
          email: 'jane@example.com',
          scheduleId: 'sched-1',
          status: 'active' as const,
          currentSection: 'reading' as const,
          timeRemaining: 1200,
          runtimeStatus: 'live' as const,
          runtimeCurrentSection: 'reading' as const,
          runtimeTimeRemainingSeconds: 1200,
          runtimeWaiting: false,
          violations: [],
          warnings: 0,
          lastActivity: '2026-01-01T00:12:00.000Z',
          examId: 'exam-1',
          examName: 'Mock Exam',
        },
      ],
      alerts: [],
      notes: [
        {
          id: 'note-1',
          scheduleId: 'sched-1',
          author: 'Sarah K.',
          timestamp: '2026-01-01T00:12:00.000Z',
          content: 'Jane Roe incident note',
          category: 'incident' as const,
          isResolved: false,
        },
      ],
      auditLogs: [
        {
          id: 'audit-1',
          timestamp: '2026-01-01T00:12:00.000Z',
          actor: 'Proctor',
          actionType: 'STUDENT_WARN' as const,
          targetStudentId: 'student-1',
          sessionId: 'sched-1',
          payload: {},
        },
      ],
      onStartScheduledSession: vi.fn(),
      onPauseCohort: vi.fn(),
      onResumeCohort: vi.fn(),
      onEndSectionNow: vi.fn(),
      onExtendCurrentSection: vi.fn(),
      onCompleteExam: vi.fn(),
    };

    const { rerender } = render(<DashboardHarness {...baseProps} railSelection="dashboard" />);

    fireEvent.click(screen.getByRole('button', { name: /monitor mock exam for cohort cohort a/i }));

    rerender(<DashboardHarness {...baseProps} railSelection="notes" />);
    expect(screen.getByText(/jane roe incident note/i)).toBeTruthy();

    rerender(<DashboardHarness {...baseProps} railSelection="audit" />);
    expect(screen.getByText(/student_warn/i)).toBeTruthy();
  });
  it('keeps the shared cohort deadline counting down while one student is disciplinarily paused', async () => {
    const pausedSession = {
      id: 'student-paused',
      studentId: 'STU-PAUSED',
      name: 'Paused Candidate',
      email: 'paused@example.com',
      scheduleId: 'sched-1',
      status: 'paused' as const,
      currentSection: 'reading' as const,
      timeRemaining: 1800,
      runtimeStatus: 'live' as const,
      runtimeCurrentSection: 'reading' as const,
      runtimeTimeRemainingSeconds: 1800,
      runtimeDeadlineAt: '2026-01-01T00:30:00.000Z',
      runtimeServerNow: '2026-01-01T00:00:00.000Z',
      runtimeSectionStatus: 'live' as const,
      runtimeWaiting: false,
      violations: [],
      warnings: 0,
      lastActivity: '2026-01-01T00:00:00.000Z',
      examId: 'exam-1',
      examName: 'Mock Exam',
    };

    render(
      <DashboardHarness
        schedules={[{ ...baseSchedule, status: 'live', startTime: '2026-01-01T00:00:00.000Z' }]}
        runtimeSnapshots={[{
          ...liveRuntime,
          currentSectionDeadlineAt: '2026-01-01T00:30:00.000Z',
          serverNow: '2026-01-01T00:00:00.000Z',
        }]}
        sessions={[pausedSession]}
        alerts={[]}
        onStartScheduledSession={vi.fn()}
        onPauseCohort={vi.fn()}
        onResumeCohort={vi.fn()}
        onEndSectionNow={vi.fn()}
        onExtendCurrentSection={vi.fn()}
        onCompleteExam={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /monitor mock exam for cohort cohort a/i }));
    expect(screen.getByText('30:00')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });

    expect(screen.getByText('29:59')).toBeInTheDocument();
  });

  it.each(['cohort_stage_v2', 'cohort_section_v3'] as const)(
    'removes per-student time extension controls for a %s SAT runtime',
    (timingModel) => {
    const sharedClockSession = {
      id: 'student-shared-clock',
      studentId: 'STU-SHARED',
      name: 'Shared Clock Candidate',
      email: 'shared@example.com',
      scheduleId: 'sched-1',
      status: 'active' as const,
      currentSection: 'reading' as const,
      timeRemaining: 1800,
      runtimeStatus: 'live' as const,
      runtimeCurrentSection: 'reading' as const,
      runtimeTimeRemainingSeconds: 1800,
      runtimeSectionStatus: 'live' as const,
      runtimeWaiting: false,
      violations: [],
      warnings: 0,
      lastActivity: '2026-01-01T00:00:00.000Z',
      examId: 'exam-1',
      examName: 'Mock Exam',
    };

    render(
      <DashboardHarness
        schedules={[{ ...baseSchedule, status: 'live', startTime: '2026-01-01T00:00:00.000Z' }]}
        runtimeSnapshots={[{ ...liveRuntime, timingModel }]}
        sessions={[sharedClockSession]}
        alerts={[]}
        notes={[]}
        auditLogs={[]}
        onStartScheduledSession={vi.fn()}
        onPauseCohort={vi.fn()}
        onResumeCohort={vi.fn()}
        onEndSectionNow={vi.fn()}
        onExtendCurrentSection={vi.fn()}
        onCompleteExam={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /monitor mock exam for cohort cohort a/i }));
    fireEvent.click(screen.getByRole('button', { name: /open shared clock candidate session details/i }));

      expect(screen.queryByRole('button', { name: /^\+5 min$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^\+10 min$/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /extend \+5/i })).toBeInTheDocument();
    },
  );

  it('preserves the SAT student clock and extends the selected student by five minutes', async () => {
    const extendSpy = vi
      .spyOn(examDeliveryService, 'extendStudentAttempt')
      .mockResolvedValue({ success: true });
    const commands = fakeCommands();
    const satSession = {
      id: 'student-1',
      studentId: 'STU-001',
      name: 'Jane Roe',
      email: 'jane@example.com',
      scheduleId: 'sched-1',
      status: 'active' as const,
      currentSection: 'reading' as const,
      timeRemaining: 1800,
      runtimeStatus: 'live' as const,
      runtimeCurrentSection: 'reading' as const,
      runtimeTimeRemainingSeconds: 1800,
      runtimeCurrentModuleId: 'module-1',
      runtimeSectionStatus: 'live' as const,
      runtimeWaiting: false,
      violations: [],
      warnings: 0,
      lastActivity: '2026-01-01T00:12:00.000Z',
      examId: 'exam-1',
      examName: 'Mock Exam',
    };

    render(
      <DashboardHarness
        schedules={[{ ...baseSchedule, status: 'live', startTime: '2026-01-01T00:00:00.000Z' }]}
        runtimeSnapshots={[liveRuntime]}
        sessions={[satSession]}
        alerts={[]}
        notes={[]}
        auditLogs={[]}
        commands={commands}
        onStartScheduledSession={vi.fn()}
        onPauseCohort={vi.fn()}
        onResumeCohort={vi.fn()}
        onEndSectionNow={vi.fn()}
        onExtendCurrentSection={vi.fn()}
        onCompleteExam={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /monitor mock exam for cohort cohort a/i }));
    expect(screen.getAllByText('30:00').length).toBeGreaterThan(0);
    expect(screen.queryByText('20:00')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /open jane roe session details/i }));
    const extendButton = screen.getByRole('button', { name: /\+5 min/i });
    await act(async () => {
      fireEvent.click(extendButton);
    });

    expect(commands.extendStudent).toHaveBeenCalledWith(expect.objectContaining({ id: 'student-1' }), 5, expect.any(String));
    expect(extendSpy).toHaveBeenCalledWith('student-1', expect.any(String), 5, 'module-1');
    expect(screen.getByText(/added 5 minutes to jane roe/i)).toBeInTheDocument();
  });

  it('binds a pending cohort action and its feedback to the room it was issued for', async () => {
    let resolvePause: () => void = () => {};
    const onPauseCohort = vi.fn(() => new Promise<void>((resolve) => { resolvePause = resolve; }));
    const roomA = { ...baseSchedule, status: 'live' as const, startTime: '2026-01-01T00:00:00.000Z' };
    const roomB = { ...roomA, id: 'sched-2', cohortName: 'Cohort B' };
    const props: Omit<DashboardProps, 'selectedScheduleId'> = {
      schedules: [roomA, roomB],
      runtimeSnapshots: [liveRuntime, { ...liveRuntime, id: 'runtime-2', scheduleId: 'sched-2', cohortName: 'Cohort B' }],
      sessions: [],
      alerts: [],
      scheduleMetrics: {},
      commands: fakeCommands(),
      onSelectScheduleId: vi.fn(),
      onStartScheduledSession: vi.fn(),
      onPauseCohort,
      onResumeCohort: vi.fn(),
      onEndSectionNow: vi.fn(),
      onExtendCurrentSection: vi.fn(),
      onCompleteExam: vi.fn(),
    };
    const { rerender } = render(<ProctorDashboard {...props} selectedScheduleId="sched-1" />);

    fireEvent.click(screen.getByRole('button', { name: /pause cohort/i }));
    expect(onPauseCohort).toHaveBeenCalledWith('sched-1');
    expect(screen.getByRole('button', { name: /pausing/i })).toBeDisabled();

    // Room B is not busy with room A's command.
    rerender(<ProctorDashboard {...props} selectedScheduleId="sched-2" />);
    expect(screen.getByRole('button', { name: /^pause cohort$/i })).not.toBeDisabled();

    // Room A's completion is reported as room A's, not as the visible room's.
    await act(async () => {
      resolvePause();
    });
    expect(screen.queryByText('Cohort paused.')).not.toBeInTheDocument();
    expect(screen.getByText('Cohort A: Cohort paused.')).toBeInTheDocument();
  });

  describe('appended coverage: states, filters, actions, empty/error', () => {
    beforeEach(() => {
      window.sessionStorage.clear();
    });

    const makeSession = (overrides: Record<string, unknown> = {}) => ({
      id: 'student-1',
      studentId: 'STU-001',
      name: 'Jane Roe',
      email: 'jane@example.com',
      scheduleId: 'sched-1',
      status: 'active' as const,
      currentSection: 'reading' as const,
      timeRemaining: 1800,
      runtimeStatus: 'live' as const,
      runtimeCurrentSection: 'reading' as const,
      runtimeTimeRemainingSeconds: 1800,
      runtimeCurrentModuleId: 'module-1',
      runtimeSectionStatus: 'live' as const,
      runtimeWaiting: false,
      violations: [] as Array<{ id: string; type: string; severity: 'medium'; timestamp: string; description: string }>,
      warnings: 0,
      lastActivity: '2026-01-01T00:12:00.000Z',
      examId: 'exam-1',
      examName: 'Mock Exam',
      ...overrides,
    });

    const baseProps = () => ({
      schedules: [{ ...baseSchedule, status: 'live' as const, startTime: '2026-01-01T00:00:00.000Z' }],
      runtimeSnapshots: [liveRuntime],
      sessions: [makeSession()],
      alerts: [] as DashboardProps['alerts'],
      notes: [] as NonNullable<DashboardProps['notes']>,
      auditLogs: [] as NonNullable<DashboardProps['auditLogs']>,
      onStartScheduledSession: vi.fn(),
      onPauseCohort: vi.fn(),
      onResumeCohort: vi.fn(),
      onEndSectionNow: vi.fn(),
      onExtendCurrentSection: vi.fn(),
      onCompleteExam: vi.fn(),
    });

    const selectCohort = () => {
      fireEvent.click(screen.getByRole('button', { name: /monitor mock exam for cohort cohort a/i }));
    };

    const openDetail = () => {
      selectCohort();
      fireEvent.click(screen.getByRole('button', { name: /open jane roe session details/i }));
    };

    const seededWarnedSession = () =>
      makeSession({
        status: 'warned' as const,
        warnings: 1,
        violations: [
          {
            id: 'v-1',
            type: 'PROCTOR_WARNING',
            severity: 'medium' as const,
            timestamp: '2026-01-01T00:11:00.000Z',
            description: 'Warning issued by proctor',
          },
        ],
      });

    it('marks completed cohorts complete and hides end-section and extend section controls', () => {
      render(
        <DashboardHarness
          schedules={[{ ...baseSchedule, status: 'completed' }]}
          runtimeSnapshots={[]}
          sessions={[]}
          alerts={[]}
          onStartScheduledSession={vi.fn()}
          onPauseCohort={vi.fn()}
          onResumeCohort={vi.fn()}
          onEndSectionNow={vi.fn()}
          onExtendCurrentSection={vi.fn()}
          onCompleteExam={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole('tab', { name: /past sessions/i }));
      fireEvent.click(screen.getByRole('button', { name: /monitor mock exam for cohort cohort a/i }));

      expect(screen.getByRole('button', { name: /start exam/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /pause cohort/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /resume cohort/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /^end section$/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /extend \+5/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /extend \+10/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /complete/i })).toBeDisabled();
    });

    it('disables start while a live cohort controls pause, resume, sections, and completion', () => {
      render(<DashboardHarness {...baseProps()} />);
      selectCohort();

      expect(screen.getByRole('button', { name: /start exam/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /pause cohort/i })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /resume cohort/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /^end section$/i })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /extend \+5/i })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /extend \+10/i })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /^complete$/i })).not.toBeDisabled();
    });

    it('enables resume only while the cohort is paused', () => {
      const pausedRuntime = { ...liveRuntime, status: 'paused' as const };
      render(
        <DashboardHarness
          {...baseProps()}
          schedules={[{ ...baseSchedule, status: 'live' as const, startTime: '2026-01-01T00:00:00.000Z' }]}
          runtimeSnapshots={[pausedRuntime]}
        />,
      );
      selectCohort();

      expect(screen.getByRole('button', { name: /start exam/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /pause cohort/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /resume cohort/i })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /^end section$/i })).not.toBeDisabled();
    });

    it('disables every cohort control until a cohort is selected', () => {
      render(
        <DashboardHarness
          schedules={[baseSchedule]}
          runtimeSnapshots={[]}
          sessions={[]}
          alerts={[]}
          onStartScheduledSession={vi.fn()}
          onPauseCohort={vi.fn()}
          onResumeCohort={vi.fn()}
          onEndSectionNow={vi.fn()}
          onExtendCurrentSection={vi.fn()}
          onCompleteExam={vi.fn()}
        />,
      );

      expect(screen.getByRole('button', { name: /start exam/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /pause cohort/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /resume cohort/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /^end section$/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /extend \+5/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /extend \+10/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /^complete$/i })).toBeDisabled();
    });

    it('runs pause cohort and reports success through a toast', async () => {
      const onPauseCohort = vi.fn().mockResolvedValue(undefined);
      render(<DashboardHarness {...baseProps()} onPauseCohort={onPauseCohort} />);
      selectCohort();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /pause cohort/i }));
      });

      expect(onPauseCohort).toHaveBeenCalledWith('sched-1');
      expect(screen.getByText('Cohort paused.')).toBeInTheDocument();
    });

    it('surfaces cohort action failures with an error toast', async () => {
      const onPauseCohort = vi.fn().mockRejectedValue(new Error('pause exploded'));
      render(<DashboardHarness {...baseProps()} onPauseCohort={onPauseCohort} />);
      selectCohort();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /pause cohort/i }));
      });

      expect(screen.getByText('pause exploded')).toBeInTheDocument();
    });

    it('confirms end section and completes through the cohort action pipeline', async () => {
      const onEndSectionNow = vi.fn().mockResolvedValue(undefined);
      render(<DashboardHarness {...baseProps()} onEndSectionNow={onEndSectionNow} />);
      selectCohort();

      fireEvent.click(screen.getByRole('button', { name: /^end section$/i }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /end section now/i }));
      });

      expect(onEndSectionNow).toHaveBeenCalledWith('sched-1');
      expect(screen.getByText('Current section ended for the cohort.')).toBeInTheDocument();
    });

    it('confirms exam completion for the cohort', async () => {
      const onCompleteExam = vi.fn().mockResolvedValue(undefined);
      render(<DashboardHarness {...baseProps()} onCompleteExam={onCompleteExam} />);
      selectCohort();

      fireEvent.click(screen.getByRole('button', { name: /^complete$/i }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^complete exam$/i }));
      });

      expect(onCompleteExam).toHaveBeenCalledWith('sched-1');
      expect(screen.getByText('Exam completed for the cohort.')).toBeInTheDocument();
    });

    it('extends the current section by ten minutes from the cohort controls', async () => {
      const onExtendCurrentSection = vi.fn().mockResolvedValue(undefined);
      render(<DashboardHarness {...baseProps()} onExtendCurrentSection={onExtendCurrentSection} />);
      selectCohort();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /extend \+10/i }));
      });

      expect(onExtendCurrentSection).toHaveBeenCalledWith('sched-1', 10);
      expect(screen.getByText('Current section extended by 10 minutes.')).toBeInTheDocument();
    });

    it('warns a student from the roster card and records the local violation', async () => {
      const warnSpy = vi.spyOn(examDeliveryService, 'warnStudent').mockResolvedValue({ success: true });
      const commands = fakeCommands();
      render(<DashboardHarness {...baseProps()} commands={commands} />);
      selectCohort();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^warn student$/i }));
      });

      expect(warnSpy).toHaveBeenCalledWith('student-1', expect.any(String), expect.any(String));
      expect(commands.studentAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'student-1', scheduleId: 'sched-1' }), 'warn', expect.any(String), undefined);
      expect(screen.getByText('Jane Roe: warned')).toBeInTheDocument();
    });

    it('shows a failure toast when warning delivery is rejected', async () => {
      vi.spyOn(examDeliveryService, 'warnStudent').mockResolvedValue({ success: false, error: 'warn unavailable' });
      render(<DashboardHarness {...baseProps()} />);
      selectCohort();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^warn student$/i }));
      });

      expect(screen.getByText('warn unavailable')).toBeInTheDocument();
    });

    it('pauses and resumes a paused student directly from the roster card actions', async () => {
      const pauseSpy = vi.spyOn(examDeliveryService, 'pauseStudentAttempt').mockResolvedValue({ success: true });
      const resumeSpy = vi.spyOn(examDeliveryService, 'resumeStudentAttempt').mockResolvedValue({ success: true });
      const commands = fakeCommands();
      const { rerender } = render(
        <DashboardHarness {...baseProps()} sessions={[makeSession()]} commands={commands} />,
      );
      selectCohort();

      fireEvent.click(screen.getByRole('button', { name: /^pause session$/i }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^pause student$/i }));
      });
      expect(pauseSpy).toHaveBeenCalledWith('student-1', expect.any(String));
      expect(commands.studentAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'student-1' }), 'pause', expect.any(String), undefined);
      expect(screen.getByText('Jane Roe paused.')).toBeInTheDocument();

      rerender(
        <DashboardHarness
          {...baseProps()}
          sessions={[makeSession({ status: 'paused' as const })]}
          commands={commands}
          selectedScheduleId="sched-1"
          onSelectScheduleId={() => {}}
        />,
      );
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^resume session$/i }));
      });
      expect(resumeSpy).toHaveBeenCalledWith('student-1', expect.any(String));
      expect(screen.getByText('Jane Roe: resumed')).toBeInTheDocument();
    });

    it('terminates a student after modal confirmation', async () => {
      const terminateSpy = vi.spyOn(examDeliveryService, 'terminateStudentAttempt').mockResolvedValue({ success: true });
      render(<DashboardHarness {...baseProps()} />);
      selectCohort();

      fireEvent.click(screen.getByRole('button', { name: /^terminate session$/i }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^terminate student$/i }));
      });

      expect(terminateSpy).toHaveBeenCalledWith('student-1', expect.any(String));
      expect(screen.getByText('Jane Roe terminated.')).toBeInTheDocument();
    });

    it('warns every selected student through bulk select', async () => {
      const warnSpy = vi.spyOn(examDeliveryService, 'warnStudent').mockResolvedValue({ success: true });
      const commands = fakeCommands();
      render(
        <DashboardHarness
          {...baseProps()}
          sessions={[makeSession(), makeSession({ id: 'student-2', studentId: 'STU-002', name: 'John Doe', email: 'john@example.com' })]}
          commands={commands}
        />,
      );
      selectCohort();

      fireEvent.click(screen.getByRole('button', { name: /bulk select/i }));
      fireEvent.click(screen.getByRole('button', { name: /select jane roe/i }));
      fireEvent.click(screen.getByRole('button', { name: /select john doe/i }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^warn$/i }));
      });

      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(commands.studentAction).toHaveBeenCalledTimes(2);
      expect(screen.getByText(/2 students updated \(warn\)/)).toBeInTheDocument();
    });

    it('reports names when one bulk pause target fails', async () => {
      const pause = vi.spyOn(examDeliveryService, 'pauseStudentAttempt');
      pause.mockResolvedValueOnce({ success: true });
      pause.mockResolvedValueOnce({ success: false, error: 'nope' });
      render(
        <DashboardHarness
          {...baseProps()}
          sessions={[makeSession(), makeSession({ id: 'student-2', studentId: 'STU-002', name: 'John Doe', email: 'john@example.com' })]}
        />,
      );
      selectCohort();

      fireEvent.click(screen.getByRole('button', { name: /bulk select/i }));
      fireEvent.click(screen.getByRole('button', { name: /select jane roe/i }));
      fireEvent.click(screen.getByRole('button', { name: /select john doe/i }));
      fireEvent.click(screen.getByRole('button', { name: /^pause$/i }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^pause selected$/i }));
      });

      expect(screen.getByText(/1 failed: john doe/i)).toBeInTheDocument();
    });

    it('filters the roster by name search, status, and sort order', () => {
      render(
        <DashboardHarness
          {...baseProps()}
          searchQuery="jane"
          sessions={[
            makeSession(),
            makeSession({ id: 'student-2', studentId: 'STU-002', name: 'John Doe', email: 'john@example.com' }),
          ]}
        />,
      );
      selectCohort();

      expect(screen.getByRole('button', { name: /open jane roe session details/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /open john doe session details/i })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /^student$/i }));
      fireEvent.click(screen.getByRole('button', { name: /^student$/i }));
      expect(screen.getByRole('button', { name: /open jane roe session details/i })).toBeInTheDocument();
    });

    it('applies advanced status and saved filters, then clears them', () => {
      render(
        <DashboardHarness
          {...baseProps()}
          sessions={[seededWarnedSession(), makeSession({ id: 'student-2', studentId: 'STU-002', name: 'John Doe', email: 'john@example.com' })]}
        />,
      );
      selectCohort();

      fireEvent.click(screen.getByRole('button', { name: /^filters$/i }));
      const statusSelect = screen.getAllByRole('combobox')[0]!;
      fireEvent.change(statusSelect, { target: { value: 'warned' } });
      expect(screen.getByRole('button', { name: /open jane roe session details/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /open john doe session details/i })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /remove status filter/i }));
      expect(screen.getByRole('button', { name: /open john doe session details/i })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /needs attention/i }));
      expect(screen.getByRole('button', { name: /open jane roe session details/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /open john doe session details/i })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
      expect(screen.getByRole('button', { name: /open john doe session details/i })).toBeInTheDocument();
    });

    it('shows the empty roster state when filters exclude every student', () => {
      render(<DashboardHarness {...baseProps()} sessions={[]} />);
      selectCohort();

      expect(screen.getByText(/no students match the current cohort filters/i)).toBeInTheDocument();
      expect(screen.getByText(/0 students/i)).toBeInTheDocument();
    });

    it('shows the past empty state when no cohort matches the bucket', () => {
      render(
        <DashboardHarness
          schedules={[baseSchedule]}
          runtimeSnapshots={[]}
          sessions={[]}
          alerts={[]}
          onStartScheduledSession={vi.fn()}
          onPauseCohort={vi.fn()}
          onResumeCohort={vi.fn()}
          onEndSectionNow={vi.fn()}
          onExtendCurrentSection={vi.fn()}
          onCompleteExam={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByRole('tab', { name: /past sessions/i }));
      expect(screen.getByText(/no past sessions/i)).toBeInTheDocument();
    });

    it('opens the violations tab from the rail and closes the drawer', () => {
      const props = baseProps();
      const { rerender } = render(<DashboardHarness {...props} railSelection="dashboard" />);
      selectCohort();

      rerender(<DashboardHarness {...props} railSelection="alerts" />);
      openDetailViaRosterRailFallback();
      expect(screen.getByText(/no violations recorded for this student/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /close student details/i }));
      expect(screen.queryByText(/no violations recorded for this student/i)).not.toBeInTheDocument();

      function openDetailViaRosterRailFallback() {
        if (screen.queryByRole('button', { name: /open jane roe session details/i })) {
          fireEvent.click(screen.getByRole('button', { name: /open jane roe session details/i }));
        }
      }
    });

    it('saves a cohort note and toggles its resolved state', async () => {
      const { examRepository } = await import('../../../features/proctor/infrastructure/proctorGateway');
      const saveNote = vi.spyOn(examRepository, 'saveSessionNote').mockResolvedValue(undefined);
      const commands = fakeCommands();
      render(<DashboardHarness {...baseProps()} commands={commands} />);
      openDetail();
      fireEvent.click(screen.getByRole('button', { name: /^notes$/i }));
      fireEvent.change(screen.getByRole('textbox', { name: /note content/i }), { target: { value: 'Watch this cohort' } });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /save note/i }));
      });

      expect(saveNote).toHaveBeenCalled();
      expect(commands.saveNote).toHaveBeenCalledWith(expect.objectContaining({ scheduleId: 'sched-1', content: 'Watch this cohort' }));
    });

    it('shows a note error when cohort note persistence fails', async () => {
      const { examRepository } = await import('../../../features/proctor/infrastructure/proctorGateway');
      vi.spyOn(examRepository, 'saveSessionNote').mockRejectedValue(new Error('note save down'));
      render(<DashboardHarness {...baseProps()} />);
      openDetail();
      fireEvent.click(screen.getByRole('button', { name: /^notes$/i }));
      fireEvent.change(screen.getByRole('textbox', { name: /note content/i }), { target: { value: 'Broken note' } });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /save note/i }));
      });

      expect(screen.getByText(/note save down/)).toHaveTextContent('may have been applied');
    });

    it('fails a student time extension and keeps the visible error state', async () => {
      vi.spyOn(examDeliveryService, 'extendStudentAttempt').mockResolvedValue({ success: false, error: 'extend denied' });
      render(<DashboardHarness {...baseProps()} />);
      openDetail();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^\+5 min$/i }));
      });

      expect(screen.getByText('extend denied')).toBeInTheDocument();
    });

    it('does not grant time without the student’s current module identity', async () => {
      const extendSpy = vi.spyOn(examDeliveryService, 'extendStudentAttempt').mockResolvedValue({ success: true });
      render(<DashboardHarness {...baseProps()} sessions={[makeSession({ runtimeCurrentModuleId: null })]} />);
      openDetail();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^\+5 min$/i }));
      });
      expect(extendSpy).not.toHaveBeenCalled();
      expect(screen.getByText('The student’s current module is unavailable. Refresh the session before adding time.')).toBeInTheDocument();
    });

    it('warns from the detail drawer and opens the auto-response rules overlay', async () => {
      const warnSpy = vi.spyOn(examDeliveryService, 'warnStudent').mockResolvedValue({ success: true });
      render(<DashboardHarness {...baseProps()} violationRules={[]} />);
      openDetail();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^warn$/i }));
      });
      expect(warnSpy).toHaveBeenCalledWith('student-1', expect.any(String), expect.any(String));

      fireEvent.click(screen.getByRole('button', { name: /back to list/i }));
      fireEvent.click(screen.getByRole('button', { name: /auto-response rules/i }));
      expect(screen.getByRole('dialog', { name: /auto-response rules/i })).toBeInTheDocument();
      fireEvent.click(screen.getAllByRole('button', { name: /close auto-response rules/i })[0]!);
      expect(screen.queryByRole('dialog', { name: /auto-response rules/i })).not.toBeInTheDocument();
    });

    it('shows the multi-proctor collision warning and proceeds explicitly', () => {
      const collisionRuntime = {
        ...liveRuntime,
        proctorPresence: [
          { proctorId: 'other-1', proctorName: 'Other Proctor', joinedAt: '2026-01-01T00:00:00.000Z', lastHeartbeat: '2026-01-01T00:00:00.000Z' },
        ],
      };
      render(<DashboardHarness {...baseProps()} runtimeSnapshots={[collisionRuntime]} currentProctorId="me" />);
      openDetail();

      expect(screen.getByText(/potential conflict/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /proceed anyway/i }));
      expect(screen.queryByText(/potential conflict/i)).not.toBeInTheDocument();
    });

    it('returns from detail to the roster without losing the selected cohort', () => {
      render(<DashboardHarness {...baseProps()} />);
      openDetail();
      expect(screen.getByText(/activity system scoped to cohort a/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /back to list/i }));
      expect(screen.getByRole('button', { name: /open jane roe session details/i })).toBeInTheDocument();
      expect(screen.getByText(/1 students/i)).toBeInTheDocument();
    });
  });
});
