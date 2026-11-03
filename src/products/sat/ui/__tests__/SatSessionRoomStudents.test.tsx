import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudentSession } from '../../../../types';
import type { ExamSessionRuntime } from '../../../../types/domain';
import { SatRoomStudentRow, StudentDetail, studentAttentionReason } from '../SatSessionRoomStudents';
import { SatSessionRoomRoster, sortRoster } from '../SatSessionRoomRoster';
import { SatAttemptTable } from '../../routes/SatExamGroupSection';
import type { SatAttemptRow } from '../../../../features/results/api/satResultsQueries';
import type { RoomScore } from '../useRoomScores';

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
    expect(screen.getByRole('button', { name: 'Add 5 minutes…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'End attempt…' })).toBeDisabled();
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

  it('counts current help requests and ignores historical warnings and violations', () => {
    expect(studentAttentionReason(student, false)).toBeNull();
    expect(studentAttentionReason(student, true)).toBe('Device change pending');
    expect(studentAttentionReason(flagged, false)).toBeNull();
    expect(studentAttentionReason(flagged, false, ['Connection lost'])).toBe('Connection lost');
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

describe('roster zero-click scores', () => {
  const scored: RoomScore = {
    kind: 'scored', answered: 25, correct: 18, total: 27, pct: 67, modules: null,
    label: '✓ 18/27 · 67% · 2 left', srLabel: 'score 18 of 27, 67 percent',
    resultId: 'result-1', hasSavedAnswers: true,
  };
  const answering: RoomScore = {
    kind: 'answering', answered: 9, correct: null, total: 27, pct: null, modules: null,
    label: '9/27 answered', srLabel: '9 of 27 answered',
    resultId: null, hasSavedAnswers: true,
  };
  const scoring: RoomScore = {
    kind: 'scoring', answered: 9, correct: null, total: 27, pct: null, modules: null,
    label: 'Scoring… 9/27 answered', srLabel: 'scoring, 9 of 27 answered',
    resultId: null, hasSavedAnswers: true,
  };
  const notScored: RoomScore = {
    kind: 'not_scored', answered: null, correct: null, total: 27, pct: null, modules: null,
    label: 'Not scored', srLabel: 'not scored',
    resultId: null, hasSavedAnswers: false,
  };

  function renderRow(score: RoomScore | null) {
    return render(
      <SatRoomStudentRow
        student={student}
        runtime={liveRuntime()}
        roomClock={null}
        selected={false}
        attentionReason={null}
        score={score}
        onSelect={vi.fn()}
      />,
    );
  }

  it('renders the scored second line plus the bold right-side fraction', () => {
    const { container } = renderRow(scored);
    expect(screen.getByRole('option', { name: 'Open Ananda S., score 18 of 27, 67 percent' })).toBeInTheDocument();
    expect(container.querySelector('.sat-room__row-score')).toHaveTextContent('✓ 18/27 · 67% · 2 left');
    expect(container.querySelector('.sat-room__row-score-fraction')).toHaveTextContent('18/27');
  });

  it('renders answering, scoring, and not_scored states without a fraction', () => {
    for (const [score, text, name] of [
      [answering, '9/27 answered', 'Open Ananda S., 9 of 27 answered'],
      [scoring, 'Scoring… 9/27 answered', 'Open Ananda S., scoring, 9 of 27 answered'],
      [notScored, 'Not scored', 'Open Ananda S., not scored'],
    ] as const) {
      const { unmount } = renderRow(score);
      expect(screen.getByRole('option', { name })).toBeInTheDocument();
      expect(screen.getByRole('option', { name }).querySelector('.sat-room__row-score')).toHaveTextContent(text);
      expect(screen.getByRole('option', { name }).querySelector('.sat-room__row-score-fraction')).toBeNull();
      unmount();
    }
  });

  it('renders a dash with no badge and an unchanged accessible name', () => {
    const { container } = renderRow(null);
    expect(screen.getByRole('option', { name: 'Open Ananda S.' })).toBeInTheDocument();
    expect(container.querySelector('.sat-room__row-score')).toBeNull();
    expect(container.querySelector('.sat-room__row-score-fraction')).toBeNull();
  });

  it('keeps score ink neutral and tabular, truncating instead of overflowing narrow rows', () => {
    const { container } = renderRow(scored);
    const line = container.querySelector('.sat-room__row-score');
    expect(line?.className).toContain('tabular-nums');
    // Narrow rooms (390px, zoom 200) truncate the second line; the row stacks
    // instead of pushing the clock off the leading edge.
    expect(line?.className).toContain('truncate');
    expect(line?.className).toMatch(/text-\[var\(--sat-staff-text-(primary|secondary)/);
    expect(line?.className).not.toMatch(/red|green|success|danger/);
    expect(container.querySelector('.sat-room__row-score-fraction')?.className).toContain('tabular-nums');
  });

  it('sorts scored attempts before unscored ones in both directions, stable by name', () => {
    const zahra: StudentSession = { ...student, id: 'attempt-z', name: 'Zahra K.' };
    const budi: StudentSession = { ...student, id: 'attempt-b', name: 'Budi T.' };
    const low: RoomScore = { ...scored, correct: 9, label: '✓ 9/27 · 33%', srLabel: 'score 9 of 27, 33 percent' };
    const scores = new Map<string, RoomScore>([
      ['attempt-1', scored],
      ['attempt-z', low],
      ['attempt-b', notScored],
    ]);
    const students = [budi, zahra, student];
    const reasons = new Map<string, string>();
    expect(sortRoster(students, 'score_desc', reasons, scores).map((s) => s.name))
      .toEqual(['Ananda S.', 'Zahra K.', 'Budi T.']);
    expect(sortRoster(students, 'score_asc', reasons, scores).map((s) => s.name))
      .toEqual(['Zahra K.', 'Ananda S.', 'Budi T.']);
  });

  it('orders the rendered roster by score without moving rows under the pointer', () => {
    const budi: StudentSession = { ...student, id: 'attempt-b', name: 'Budi T.' };
    const scores = new Map<string, RoomScore>([['attempt-1', scored]]);
    const props = {
      students: [student, budi],
      selectedStudent: null,
      runtime: liveRuntime(),
      search: '',
      onSearchChange: vi.fn(),
      attentionFilter: 'all' as const,
      onAttentionFilterChange: vi.fn(),
      attentionCount: 0,
      onSelect: vi.fn(),
    };
    render(
      <SatSessionRoomRoster
        {...props}
        visibleStudents={[budi, student]}
        attentionReasons={new Map()}
        sort="score_desc"
        onSortChange={vi.fn()}
        scores={scores}
      />,
    );
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((row) => row.querySelector('.sat-room__row-name')?.textContent))
      .toEqual(['Ananda S.', 'Budi T.']);
  });

  it('replays an opacity-only fade when the score text changes', () => {
    const row = (score: RoomScore | null) => (
      <SatRoomStudentRow
        student={student}
        runtime={liveRuntime()}
        roomClock={null}
        selected={false}
        attentionReason={null}
        score={score}
        onSelect={vi.fn()}
      />
    );
    const { container, rerender } = render(row(scored));
    const first = container.querySelector('.sat-room__row-score');
    expect(first?.className).toContain('sat-room__score-fade');
    const upgraded: RoomScore = { ...scored, correct: 19, pct: 70, label: '✓ 19/27 · 70% · 2 left', srLabel: 'score 19 of 27, 70 percent' };
    rerender(row(upgraded));
    const second = container.querySelector('.sat-room__row-score');
    expect(second?.className).toContain('sat-room__score-fade');
    // A new key remounts the badge so the fade replays exactly on text change.
    expect(second).not.toBe(first);
    expect(second).toHaveTextContent('✓ 19/27 · 70%');
  });

  it('holds a shape-preserving skeleton on first load, never a zero', () => {
    const row = (score: RoomScore | null, loading: boolean) => (
      <SatRoomStudentRow
        student={student}
        runtime={liveRuntime()}
        roomClock={null}
        selected={false}
        attentionReason={null}
        score={score}
        scoresLoading={loading}
        onSelect={vi.fn()}
      />
    );
    const { container, rerender } = render(row(null, true));
    expect(container.querySelector('[aria-hidden="true"] .sat-room__row-score-skeleton')).not.toBeNull();
    expect(container.querySelector('.sat-room__row-score')).toBeNull();
    expect(screen.getByRole('option', { name: 'Open Ananda S.' })).toBeInTheDocument();
    // Once the join lands the skeleton yields to the badge in the same slot.
    rerender(row(scored, false));
    expect(container.querySelector('.sat-room__row-score-skeleton')).toBeNull();
    expect(container.querySelector('.sat-room__row-score')).toHaveTextContent('✓ 18/27 · 67% · 2 left');
  });

  it('dims the projected score while stale instead of flashing', () => {
    const { container } = render(
      <SatRoomStudentRow
        student={student}
        runtime={liveRuntime()}
        roomClock={null}
        selected={false}
        attentionReason={null}
        score={scored}
        scoresStale
        onSelect={vi.fn()}
      />,
    );
    expect(container.querySelector('.sat-room__row-score')?.className).toContain('opacity-60');
    expect(container.querySelector('.sat-room__row-score-fraction')?.className).toContain('opacity-60');
  });
});

describe('roster score polish', () => {
  const scored: RoomScore = {
    kind: 'scored', answered: 25, correct: 18, total: 27, pct: 67, modules: null,
    label: '✓ 18/27 · 67% · 2 left', srLabel: 'score 18 of 27, 67 percent',
    resultId: 'result-1', hasSavedAnswers: true,
  };
  const answering: RoomScore = {
    kind: 'answering', answered: 9, correct: null, total: 27, pct: null, modules: null,
    label: '9/27 answered', srLabel: '9 of 27 answered',
    resultId: null, hasSavedAnswers: true,
  };

  function renderRoster(overrides: Partial<Parameters<typeof SatSessionRoomRoster>[0]> = {}) {
    const budi: StudentSession = { ...student, id: 'attempt-b', name: 'Budi T.' };
    return render(
      <SatSessionRoomRoster
        students={[student, budi]}
        visibleStudents={[student, budi]}
        selectedStudent={null}
        runtime={liveRuntime()}
        search=""
        onSearchChange={vi.fn()}
        attentionFilter="all"
        onAttentionFilterChange={vi.fn()}
        attentionCount={0}
        attentionReasons={new Map()}
        sort="name"
        onSortChange={vi.fn()}
        onSelect={vi.fn()}
        {...overrides}
      />,
    );
  }

  it('shows an inline stale line with the join age, never a toast-only flash', () => {
    renderRoster({
      scores: new Map([['attempt-1', scored]]),
      scoresStale: true,
      scoresUpdatedAt: Date.now() - 40_000,
    });
    expect(screen.getByText(/Scores may be stale/)).toBeInTheDocument();
    expect(screen.getByText(/Updated 40s ago/)).toBeInTheDocument();
    expect(screen.getByText(/keeping last values/)).toBeInTheDocument();
    // The rows keep their last value, dimmed — no zero flash.
    expect(screen.getByRole('option', { name: 'Open Ananda S., score 18 of 27, 67 percent' })).toBeInTheDocument();
  });

  it('announces a score upgrade once and collapses rapid batches', () => {
    const { rerender } = renderRoster({ scores: new Map([['attempt-1', answering]]) });
    const region = screen.getByRole('status');
    // First paint only seeds the map — nothing to announce yet.
    expect(region).toHaveTextContent('');
    rerender(
      <SatSessionRoomRoster
        students={[student, { ...student, id: 'attempt-b', name: 'Budi T.' }]}
        visibleStudents={[student, { ...student, id: 'attempt-b', name: 'Budi T.' }]}
        selectedStudent={null}
        runtime={liveRuntime()}
        search=""
        onSearchChange={vi.fn()}
        attentionFilter="all"
        onAttentionFilterChange={vi.fn()}
        attentionCount={0}
        attentionReasons={new Map()}
        sort="name"
        onSortChange={vi.fn()}
        onSelect={vi.fn()}
        scores={new Map([['attempt-1', scored]])}
      />,
    );
    expect(region).toHaveTextContent('Ananda S. scored 18 of 27');
    // A follow-up poll with the same scored facts does not re-announce.
    rerender(
      <SatSessionRoomRoster
        students={[student, { ...student, id: 'attempt-b', name: 'Budi T.' }]}
        visibleStudents={[student, { ...student, id: 'attempt-b', name: 'Budi T.' }]}
        selectedStudent={null}
        runtime={liveRuntime()}
        search=""
        onSearchChange={vi.fn()}
        attentionFilter="all"
        onAttentionFilterChange={vi.fn()}
        attentionCount={0}
        attentionReasons={new Map()}
        sort="name"
        onSortChange={vi.fn()}
        onSelect={vi.fn()}
        scores={new Map([['attempt-1', { ...scored }]])}
      />,
    );
    expect(region).toHaveTextContent('Ananda S. scored 18 of 27');
  });

  it('collapses simultaneous upgrades into one summary', () => {
    const budiScored: RoomScore = { ...scored, label: '✓ 9/27 · 33%', srLabel: 'score 9 of 27, 33 percent', correct: 9, pct: 33 };
    const { rerender } = renderRoster({
      scores: new Map([['attempt-1', answering], ['attempt-b', answering]]),
    });
    rerender(
      <SatSessionRoomRoster
        students={[student, { ...student, id: 'attempt-b', name: 'Budi T.' }]}
        visibleStudents={[student, { ...student, id: 'attempt-b', name: 'Budi T.' }]}
        selectedStudent={null}
        runtime={liveRuntime()}
        search=""
        onSearchChange={vi.fn()}
        attentionFilter="all"
        onAttentionFilterChange={vi.fn()}
        attentionCount={0}
        attentionReasons={new Map()}
        sort="name"
        onSortChange={vi.fn()}
        onSelect={vi.fn()}
        scores={new Map([['attempt-1', scored], ['attempt-b', budiScored]])}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('2 scores updated.');
  });
});

describe('inspector Score summary', () => {
  const scored: RoomScore = {
    kind: 'scored', answered: 25, correct: 18, total: 27, pct: 67, modules: null,
    label: '✓ 18/27 · 67%', srLabel: 'score 18 of 27, 67 percent',
    resultId: 'result-1', hasSavedAnswers: true,
  };

  it('links a scored attempt to its result with the room return state', () => {
    render(
      <MemoryRouter>
        <StudentDetail
          student={student}
          runtime={null}
          variant="operational"
          pendingActions={new Set()}
          blocked={false}
          score={scored}
          roomReturnTo="/sat/sessions/sched-1"
          roomReturnState={{ selectedStudentId: 'attempt-1', search: '', rosterSort: 'name', attentionFilter: 'all' }}
          onAddTime={vi.fn()}
          onWarn={vi.fn()}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onTerminate={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('region', { name: 'Score summary' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'View answers for Ananda S.' });
    expect(link.getAttribute('href')).toContain('/sat/results/result-1');
    expect(link.getAttribute('href')).toContain('from=room');
    expect(link.getAttribute('href')).toContain('scheduleId=sched-1');
    expect(link.getAttribute('href')).toContain('studentId=A001');
  });

  it('links saved answers without a result, and hides the block on a dash', () => {
    const answering: RoomScore = {
      kind: 'answering', answered: 9, correct: null, total: 27, pct: null, modules: null,
      label: '9/27 answered', srLabel: '9 of 27 answered',
      resultId: null, hasSavedAnswers: true,
    };
    const { unmount } = render(
      <MemoryRouter>
        <StudentDetail
          student={student}
          runtime={null}
          variant="operational"
          pendingActions={new Set()}
          blocked={false}
          score={answering}
          roomReturnTo="/sat/sessions/sched-1"
          roomReturnState={null}
          onAddTime={vi.fn()}
          onWarn={vi.fn()}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onTerminate={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'View saved answers for Ananda S.' }).getAttribute('href'))
      .toContain('/sat/results/attempts/attempt-1');
    unmount();

    render(
      <MemoryRouter>
        <StudentDetail
          student={student}
          runtime={null}
          variant="operational"
          pendingActions={new Set()}
          blocked={false}
          score={null}
          roomReturnTo="/sat/sessions/sched-1"
          roomReturnState={null}
          onAddTime={vi.fn()}
          onWarn={vi.fn()}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onTerminate={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('region', { name: 'Score summary' })).toBeNull();
    expect(screen.queryByRole('link', { name: /View .*answers for/ })).toBeNull();
  });
});

describe('SAT room round-2 polish (T-06/T-10/T-11)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const budiStudent: StudentSession = { ...student, id: 'attempt-b', name: 'Budi T.' };
  const scoredFresh: RoomScore = {
    kind: 'scored', answered: 25, correct: 18, total: 27, pct: 67, modules: null,
    label: '✓ 18/27 · 67% · 2 left', srLabel: 'score 18 of 27, 67 percent',
    resultId: 'result-1', hasSavedAnswers: true,
  };
  const notScoredFresh: RoomScore = {
    kind: 'not_scored', answered: null, correct: null, total: 27, pct: null, modules: null,
    label: 'Not scored', srLabel: 'not scored',
    resultId: null, hasSavedAnswers: false,
  };

  function polishRoster(scores: ReadonlyMap<string, RoomScore>, extra: Partial<Parameters<typeof SatSessionRoomRoster>[0]> = {}) {
    return (
      <SatSessionRoomRoster
        students={[student, budiStudent]}
        visibleStudents={[student, budiStudent]}
        selectedStudent={null}
        runtime={liveRuntime()}
        search=""
        onSearchChange={vi.fn()}
        attentionFilter="all"
        onAttentionFilterChange={vi.fn()}
        attentionCount={0}
        attentionReasons={new Map()}
        sort="name"
        onSortChange={vi.fn()}
        onSelect={vi.fn()}
        scores={scores}
        {...extra}
      />
    );
  }

  it('T-06: an ended attempt reads Ended, never Status unavailable', () => {
    const endedAttempt: SatAttemptRow = {
      resultId: null, attemptId: 'attempt-ended', attemptStatus: 'ended', outcomeStatus: 'unscored',
      scheduleId: 'schedule-1', examId: 'sat-1', examTitle: 'Practice Test 06', versionNumber: 12,
      studentId: 'S9', studentName: 'Ended Student', studentEmail: null, cohortName: 'Morning',
      submittedAt: null, totalScore: null, releaseStatus: '',
    };
    render(<SatAttemptTable attempts={[endedAttempt]} currentAttemptId={null} onOpen={vi.fn()} />);
    expect(screen.getByText('Ended')).toBeInTheDocument();
    expect(screen.queryByText('Status unavailable')).not.toBeInTheDocument();
  });

  it('T-10: fresh scores mount no 30s timer, so +30s re-renders no rows', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    render(polishRoster(new Map([['attempt-1', scoredFresh]]), {
      scoresStale: false,
      scoresUpdatedAt: Date.now() - 40_000,
    }));
    // The footer age line is the only 30s timer in the room; row clocks run
    // on the shared 1s/15s bands. Fresh state mounts no 30s timer at all, so
    // the listbox cannot re-render on it.
    expect(setIntervalSpy.mock.calls.filter((call) => call[1] === 30_000)).toHaveLength(0);
    const badgeBefore = screen
      .getByRole('option', { name: 'Open Ananda S., score 18 of 27, 67 percent' })
      .querySelector('.sat-room__row-score')?.textContent;
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.queryByText(/Scores may be stale/)).toBeNull();
    expect(
      screen
        .getByRole('option', { name: 'Open Ananda S., score 18 of 27, 67 percent' })
        .querySelector('.sat-room__row-score'),
    ).toHaveTextContent(badgeBefore ?? '');
    setIntervalSpy.mockRestore();
  });

  it('T-10: while stale only the footer age line ticks and rows keep last values', () => {
    vi.useFakeTimers();
    render(polishRoster(new Map([['attempt-1', scoredFresh]]), {
      scoresStale: true,
      scoresUpdatedAt: Date.now() - 40_000,
    }));
    expect(screen.getByText(/Scores may be stale/)).toBeInTheDocument();
    expect(screen.getByText(/Updated 40s ago/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText(/Updated 1m ago/)).toBeInTheDocument();
    // The rows keep their last value, dimmed — no zero flash, no remount.
    expect(screen.getByRole('option', { name: 'Open Ananda S., score 18 of 27, 67 percent' })).toBeInTheDocument();
  });

  it('T-11: a scored→not_scored transition announces marked not scored', () => {
    const { rerender } = render(polishRoster(new Map([['attempt-1', scoredFresh], ['attempt-b', scoredFresh]])));
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('');
    rerender(polishRoster(new Map([['attempt-1', notScoredFresh], ['attempt-b', { ...scoredFresh }]])));
    expect(region).toHaveTextContent('Ananda S. marked not scored');
    // A stable re-poll does not re-announce.
    rerender(polishRoster(new Map([['attempt-1', { ...notScoredFresh }], ['attempt-b', { ...scoredFresh }]])));
    expect(region).toHaveTextContent('Ananda S. marked not scored');
  });

  it('T-11: simultaneous upgrades and not_scored markings collapse to one summary', () => {
    const answeringFresh: RoomScore = {
      kind: 'answering', answered: 9, correct: null, total: 27, pct: null, modules: null,
      label: '9/27 answered', srLabel: '9 of 27 answered',
      resultId: null, hasSavedAnswers: true,
    };
    const { rerender } = render(polishRoster(new Map([['attempt-1', answeringFresh], ['attempt-b', scoredFresh]])));
    expect(screen.getByRole('status')).toHaveTextContent('');
    // Ananda upgrades answering→scored while Budi flips scored→not_scored:
    // both transitions collapse into one summary like existing upgrades.
    rerender(polishRoster(new Map([['attempt-1', scoredFresh], ['attempt-b', notScoredFresh]])));
    expect(screen.getByRole('status')).toHaveTextContent('2 scores updated.');
  });
});
