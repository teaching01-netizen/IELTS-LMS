import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentDetailPanel } from '../StudentDetailPanel';
import type { ExamGroup, StudentSession } from '../../../types';

// The student drawer's SECTION and TIME LEFT read, in order:
// `ieltsPersonalSectionKey` (the attempt-owned IELTS clock), then
// `runtimeCurrentSection` (the room's reported section), then the legacy
// attempt module. Nothing here invents a section. These cases pin that the
// shared-schedule room keeps reporting the room's committed-timetable
// section the backend now overlays on every read, and that a personal-model
// clock still wins where the backend attaches one.

const ROOM_NOW = '2026-11-07T05:00:00.000Z';

beforeEach(() => {
  // Freeze the page clock so a 300s countdown renders exactly once, before
  // any 1s tick moves it.
  vi.useFakeTimers();
  vi.setSystemTime(new Date(ROOM_NOW));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function session(overrides: Partial<StudentSession> = {}): StudentSession {
  return {
    id: 'attempt-1',
    studentId: 'w12421',
    name: 'Warwick Institute',
    email: 'teaching01@warwick-institute.com',
    scheduleId: 'sched-1',
    status: 'active',
    // `currentSection` is the legacy attempt module: seeded once at
    // "listening" and never updated by normal IELTS delivery, so it must
    // never override a fresher runtime report.
    currentSection: 'listening',
    timeRemaining: 2500,
    runtimeStatus: 'live',
    runtimeCurrentSection: 'writing',
    runtimeTimeRemainingSeconds: 42,
    runtimeServerNow: ROOM_NOW,
    runtimeWaiting: false,
    violations: [],
    warnings: 0,
    lastActivity: ROOM_NOW,
    examId: 'exam-1',
    examName: 'Elite 2025-A',
    ...overrides,
  };
}

const cohort: ExamGroup = {
  id: 'group-1',
  scheduleId: 'sched-1',
  examId: 'exam-1',
  examTitle: 'Elite 2025-A',
  cohortName: 'Elite 2025-A',
  scheduledStartTime: '2026-11-07T04:00:00.000Z',
  runtimeStatus: 'live',
  isReadyToStart: true,
  currentLiveSection: 'writing',
  studentCount: 1,
  activeCount: 1,
  joinReadyCount: 1,
  joinTotalCount: 1,
  violationCount: 0,
  status: 'live',
  plannedDurationMinutes: 180,
};

function renderPanel(overrides: Partial<StudentSession> = {}) {
  return render(
    <StudentDetailPanel
      student={session(overrides)}
      cohort={cohort}
      alerts={[]}
      auditLogs={[]}
      notes={[]}
      activeTab="timeline"
      onTabChange={vi.fn()}
      onClose={vi.fn()}
      onAction={vi.fn()}
    />,
  );
}

describe('StudentDetailPanel section and clock precedence', () => {
  it('reports the room section for a shared-timetable candidate', () => {
    renderPanel();

    // Room section as the backend reported it (timetable-resolved), not the
    // never-advancing attempt module and not a guessed value.
    expect(screen.getByText('writing')).toBeInTheDocument();
    expect(screen.queryByText('listening')).toBeNull();
  });

  it('counts down the runtime clock when no runtime deadline rides the payload', () => {
    renderPanel();

    // 42s on the fallback clock renders as the room's 00:42 countdown.
    expect(screen.getByText('00:42')).toBeInTheDocument();
  });

  it('prefers the attempt-owned IELTS section and clock when attached', () => {
    renderPanel({
      ieltsPersonalSectionKey: 'reading',
      ieltsPersonalStatus: 'active',
      // 300s ahead of the room instant the screenshot clock anchors on.
      ieltsPersonalDeadlineAt: new Date(Date.parse(ROOM_NOW) + 300_000).toISOString(),
      ieltsPersonalTimeRemainingSeconds: 300,
    });

    expect(screen.getByText('reading')).toBeInTheDocument();
    expect(screen.getByText('05:00')).toBeInTheDocument();
    expect(screen.getByText('IELTS reading · active')).toBeInTheDocument();
    // The room's section stays visible nowhere else in the header block.
    expect(screen.queryByText('writing')).toBeNull();
  });
});
