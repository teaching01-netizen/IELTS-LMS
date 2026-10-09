import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudentSession } from '../../../../types';
import type { ExamSessionRuntime } from '../../../../types/domain';
import { SatRoomStudentRow, StudentDetail, studentAttentionReason } from '../SatSessionRoomStudents';
import { SatSessionRoomRoster, sortRoster } from '../SatSessionRoomRoster';

const NO_OPTIONAL_RUNTIME = {
  nextSectionStartAt: null,
  totalPausedSeconds: 0,
  sections: [],
  examPlan: null,
  proctorPresence: [],
  revision: 1,
  createdAt: '2026-09-20T02:00:00Z',
  updatedAt: '2026-09-20T02:00:00Z',
};

function liveRuntime(overrides: Partial<ExamSessionRuntime> = {}): ExamSessionRuntime {
  return {
    id: 'runtime-1',
    scheduleId: 'sched-1',
    examId: 'sat-1',
    providerKey: 'sat',
    examTitle: 'Practice Test 06',
    cohortName: 'Morning',
    deliveryMode: 'proctor_start',
    status: 'live',
    timingModel: 'cohort_section_v3',
    actualStartAt: '2026-09-20T02:00:00Z',
    actualEndAt: null,
    activeSectionKey: 'reading-writing',
    currentSectionKey: 'reading-writing',
    currentSectionRemainingSeconds: 600,
    currentSectionDeadlineAt: null,
    serverNow: '2026-09-20T02:00:00Z',
    waitingForNextSection: false,
    isOverrun: false,
    ...NO_OPTIONAL_RUNTIME,
    ...overrides,
  };
}

function clockReading(label: string) {
  return Array.from(document.querySelectorAll('dl dt'))
    .find((node) => node.textContent === label)
    ?.parentElement?.querySelector('dd')?.textContent ?? null;
}

const student: StudentSession = {
  id: 'attempt-1',
  studentId: 'A001',
  name: 'Ananda S.',
  email: 'ananda@example.com',
  scheduleId: 'sched-1',
  status: 'active',
  currentSection: 'reading',
  timeRemaining: 900,
  runtimeStatus: 'live',
  runtimeCurrentSection: 'reading',
  runtimeSectionStatus: 'live',
  runtimeTimeRemainingSeconds: 900,
  runtimeModuleRole: 'base',
  runtimeModuleRemainingSeconds: 600,
  violations: [],
  warnings: 0,
  lastActivity: '2026-09-20T02:00:00Z',
  examId: 'sat-1',
  examName: 'Practice Test 06',
};

function renderDetail(overrides: Partial<Parameters<typeof StudentDetail>[0]> = {}) {
  return render(
    <StudentDetail
      student={student}
      runtime={null}
      variant="operational"
      pendingActions={new Set()}
      blocked={false}
      onAddTime={vi.fn()}
      onWarn={vi.fn()}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onTerminate={vi.fn()}
      {...overrides}
    />,
  );
}

// The inspector and the roster row name the same two clocks for the same
// candidate. They used to compute "now" independently — the panel from the
// per-student read, the row on a 15s band whenever the snapshot was over five
// minutes — so the two disagreed by seconds on one screen.
//
// These tests run on fake timers so a tick is observable: the shared clock is
// driven by `setInterval`, and the coarse band inside it fires only every 15s,
// which is exactly the staleness a proctor sees as "the timer is not in sync".
describe('room clocks', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts the section clock down from the room when the student read omits its own copy', () => {
    vi.useFakeTimers();
    const now = Date.now();
    const deadline = new Date(now + 600_000).toISOString();
    const roomClock = { serverNow: new Date(now).toISOString(), receivedAt: now };

    renderDetail({
      // The runtime knows the section deadline; this candidate's own projection
      // carries neither a deadline nor a server instant. The section clock used
      // to take that as "no clock" and hold the last poll's frozen seconds.
      runtime: liveRuntime({ currentSectionDeadlineAt: deadline }),
      roomClock,
      student: {
        ...student,
        runtimeDeadlineAt: null,
        runtimeServerNow: null,
        runtimeModuleDeadlineAt: null,
        runtimeModuleRemainingSeconds: null,
      },
    });

    expect(clockReading('Section clock')).toBe('10:00');
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(clockReading('Section clock')).toBe('9:57');
  });

  // The server publishes the adaptive slot as `runtimeCurrentModuleRole`; the
  // client only ever read `runtimeModuleRole`, so the slot was always null and
  // the panel fell back to the raw module title.
  it('names the adaptive module slot from whichever key the payload used', () => {
    renderDetail({
      student: {
        ...student,
        runtimeModuleRole: undefined,
        runtimeCurrentModuleRole: 'higher_branch',
      } as unknown as StudentSession,
    });

    expect(clockReading('Current module')).toBe('Module 2 · Higher');
  });

  it('keeps the selected row and the inspector on one clock instead of the 15s band', () => {
    vi.useFakeTimers();
    const now = Date.now();
    const deadline = new Date(now + 600_000).toISOString();
    const moduleDeadline = new Date(now + 300_000).toISOString();
    const roomClock = { serverNow: new Date(now).toISOString(), receivedAt: now };
    const clockedStudent: StudentSession = {
      ...student,
      runtimeDeadlineAt: deadline,
      runtimeServerNow: roomClock.serverNow,
      runtimeModuleDeadlineAt: moduleDeadline,
      runtimeModuleRemainingSeconds: 300,
    };

    render(
      <>
        <SatRoomStudentRow
          student={clockedStudent}
          runtime={liveRuntime({ currentSectionDeadlineAt: deadline })}
          roomClock={roomClock}
          selected
          attentionReason={null}
          onSelect={vi.fn()}
        />
        <StudentDetail
          student={clockedStudent}
          runtime={liveRuntime({ currentSectionDeadlineAt: deadline })}
          roomClock={roomClock}
          variant="operational"
          pendingActions={new Set()}
          blocked={false}
          onAddTime={vi.fn()}
          onWarn={vi.fn()}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onTerminate={vi.fn()}
        />
      </>,
    );

    const row = screen.getByRole('option', { name: 'Open Ananda S.' });
    const rowSectionClock = () => row.querySelector('.sat-room__row-sub')?.textContent ?? null;
    expect(rowSectionClock()).toBe(`Section clock ${clockReading('Section clock')}`);

    act(() => {
      vi.advanceTimersByTime(6_000);
    });

    // A coarse row would still be showing its 15s-old value here, seconds away
    // from the inspector the proctor is reading beside it.
    expect(rowSectionClock()).toBe(`Section clock ${clockReading('Section clock')}`);
    expect(row.querySelector('.sat-room__row-time')?.textContent).toBe(clockReading('Module clock'));
  });
});

describe('StudentDetail inspector priority', () => {
  it('puts violation details before exam state for flagged review records', () => {
    renderDetail({
      variant: 'review',
      student: {
        ...student,
        warnings: 1,
        violations: [{
          id: 'violation-1',
          type: 'tab_switch',
          severity: 'warning',
          timestamp: '2026-09-20T02:01:00Z',
          description: 'You left the exam screen.',
        }],
      },
    });

    const attention = screen.getByRole('region', { name: 'Attention 2' });
    const examState = screen.getByRole('region', { name: 'Exam state' });
    expect(attention.compareDocumentPosition(examState) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(attention).getByText('tab switch')).toBeInTheDocument();
    expect(within(attention).getByText('You left the exam screen.')).toBeInTheDocument();
  });

  it('shows healthy review state quietly after exam state', () => {
    renderDetail({ variant: 'review' });
    const examState = screen.getByRole('region', { name: 'Exam state' });
    const attention = screen.getByRole('region', { name: 'Attention 0' });
    expect(examState.compareDocumentPosition(attention) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(attention).getByText('No current warnings or integrity events.')).toBeInTheDocument();
  });

  it('emphasizes current section and module timing during operation', () => {
    renderDetail();
    expect(screen.getByRole('region', { name: 'Current student state' })).toBeInTheDocument();
    expect(screen.getByText('Module 1')).toBeInTheDocument();
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText('15:00')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Attention 0' })).toBeInTheDocument();
  });

  it('keeps terminated attempt clocks available and disables actions when blocked', () => {
    renderDetail({ student: { ...student, status: 'terminated' }, blocked: true });
    expect(screen.getByText('10:00')).toBeInTheDocument();
    expect(screen.getByText('15:00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Student actions' }));
    expect(screen.getByRole('menuitem', { name: 'Add 5 minutes…' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'End attempt…' })).toBeDisabled();
  });
});

describe('roster attention and ordering', () => {
  const flagged: StudentSession = {
    ...student,
    id: 'attempt-2',
    name: 'Budi T.',
    warnings: 1,
    violations: [
      { id: 'v1', studentId: 'B002', type: 'tab_switch', severity: 'medium', timestamp: '2026-09-20T02:01:00Z', description: 'Left the exam tab' },
      { id: 'v2', studentId: 'B002', type: 'fullscreen_exit', severity: 'medium', timestamp: '2026-09-20T02:05:00Z', description: 'Exited fullscreen' },
    ],
  } as StudentSession;
  const lowTime: StudentSession = { ...student, id: 'attempt-3', name: 'Citra W.', runtimeModuleRemainingSeconds: 60 };

  it('names the reason a student needs attention, newest integrity event first', () => {
    expect(studentAttentionReason(student, false)).toBeNull();
    expect(studentAttentionReason(student, true)).toBe('Device change pending');
    expect(studentAttentionReason(flagged, false)).toBe('Integrity: fullscreen exit (+1) · 1 warning sent');
  });

  it('sorts by name, by attention, and by the clock the row shows', () => {
    const reasons = new Map([['attempt-2', 'x']]);
    const roster = [lowTime, flagged, student];
    expect(sortRoster(roster, 'name', reasons).map((s) => s.name)).toEqual(['Ananda S.', 'Budi T.', 'Citra W.']);
    expect(sortRoster(roster, 'attention', reasons)[0]?.name).toBe('Budi T.');
    expect(sortRoster(roster, 'time', reasons)[0]?.name).toBe('Citra W.');
  });

  it('holds row order while the pointer is in the list, then re-sorts when it leaves', () => {
    const props = {
      students: [student, lowTime],
      selectedStudent: null,
      runtime: liveRuntime(),
      search: '',
      onSearchChange: vi.fn(),
      attentionFilter: 'all' as const,
      onAttentionFilterChange: vi.fn(),
      attentionCount: 0,
      sort: 'name' as const,
      onSortChange: vi.fn(),
      onSelect: vi.fn(),
    };
    const names = () => within(screen.getByRole('listbox')).getAllByRole('option').map((row) => row.querySelector('.sat-room__row-name')?.textContent);
    const { rerender } = render(<SatSessionRoomRoster {...props} visibleStudents={[student, lowTime]} attentionReasons={new Map()} />);
    expect(names()).toEqual(['Ananda S.', 'Citra W.']);
    fireEvent.pointerEnter(screen.getByRole('listbox'));
    // A live update flags Citra while the proctor's pointer is over the list.
    rerender(<SatSessionRoomRoster {...props} sort="attention" visibleStudents={[student, lowTime]} attentionReasons={new Map([['attempt-3', 'Device change pending']])} />);
    expect(names()).toEqual(['Ananda S.', 'Citra W.']);
    expect(screen.getByRole('option', { name: 'Open Citra W., needs attention: Device change pending' })).toBeInTheDocument();
    fireEvent.pointerLeave(screen.getByRole('listbox'));
    expect(names()).toEqual(['Citra W.', 'Ananda S.']);
  });
});
