import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProctorDashboard } from '../ProctorDashboard';
import { examDeliveryService } from '../../../services/examDeliveryService';
import type { ExamSchedule, ExamSessionRuntime } from '../../../types/domain';

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
    ...props
  }: Omit<DashboardProps, 'selectedScheduleId' | 'onSelectScheduleId' | 'scheduleMetrics'> & {
    scheduleMetrics?: DashboardProps['scheduleMetrics'];
  }) {
    const [selectedScheduleId, onSelectScheduleId] = React.useState<string | null>(null);
    return (
      <ProctorDashboard
        {...props}
        scheduleMetrics={scheduleMetrics}
        selectedScheduleId={selectedScheduleId}
        onSelectScheduleId={onSelectScheduleId}
      />
    );
  }

  const baseSchedule: ExamSchedule = {
    id: 'sched-1',
    examId: 'exam-1',
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
        onUpdateSessions={vi.fn()}
        onUpdateAlerts={vi.fn()}
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
        onUpdateSessions={vi.fn()}
        onUpdateAlerts={vi.fn()}
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
        onUpdateSessions={vi.fn()}
        onUpdateAlerts={vi.fn()}
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
        onUpdateSessions={vi.fn()}
        onUpdateAlerts={vi.fn()}
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
        onUpdateSessions={vi.fn()}
        onUpdateAlerts={vi.fn()}
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
        onUpdateSessions={vi.fn()}
        onUpdateAlerts={vi.fn()}
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
        onUpdateSessions={vi.fn()}
        onUpdateAlerts={vi.fn()}
        onUpdateNotes={vi.fn()}
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
      onUpdateSessions: vi.fn(),
      onUpdateAlerts: vi.fn(),
      onUpdateNotes: vi.fn(),
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
      runtimeSectionStatus: 'live',
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
        onUpdateSessions={vi.fn()}
        onUpdateAlerts={vi.fn()}
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
      runtimeSectionStatus: 'live',
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
        onUpdateSessions={vi.fn()}
        onUpdateAlerts={vi.fn()}
        onUpdateNotes={vi.fn()}
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
    const onUpdateSessions = vi.fn();
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
      runtimeSectionStatus: 'live',
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
        onUpdateSessions={onUpdateSessions}
        onUpdateAlerts={vi.fn()}
        onUpdateNotes={vi.fn()}
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

    expect(extendSpy).toHaveBeenCalledWith('student-1', expect.any(String), 5);
    expect(onUpdateSessions).toHaveBeenCalled();
    const updated = onUpdateSessions.mock.calls.at(-1)?.[0] as Array<typeof satSession> | undefined;
    expect(updated?.find((session) => session.id === 'student-1')?.runtimeTimeRemainingSeconds).toBe(2100);
  });

});
