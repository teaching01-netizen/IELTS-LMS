import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProctorDashboard } from '../ProctorDashboard';
import type { ExamSchedule, ExamSessionRuntime } from '../../../types/domain';

describe('ProctorDashboard runtime controls', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('disables start before a scheduled cohort is ready', () => {
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
    expect(screen.queryByRole('button', { name: /end section/i })).not.toBeInTheDocument();
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
});
