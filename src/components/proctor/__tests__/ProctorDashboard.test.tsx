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
      <ProctorDashboard
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
      <ProctorDashboard
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
  });
});
