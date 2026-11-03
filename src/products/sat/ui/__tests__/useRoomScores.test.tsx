import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudentSession } from '../../../../types';
import type { SatAttemptRow } from '../../../../features/results/api/satResultsQueries';
import { isSameRoomScore, resolveRoomScore, useRoomScores, type RoomScore } from '../useRoomScores';
import { sortRoster } from '../SatSessionRoomRoster';

const getMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../features/results/infrastructure/resultsGateway', () => ({
  resultsGateway: { get: getMock },
}));

function session(overrides: Partial<StudentSession> = {}): StudentSession {
  return {
    id: 'attempt-1',
    studentId: 'A001',
    name: 'Ananda S.',
    email: 'ananda@example.com',
    scheduleId: 'sched-1',
    status: 'active',
    currentSection: 'reading',
    timeRemaining: 900,
    violations: [],
    warnings: 0,
    lastActivity: '2026-09-20T02:00:00Z',
    examId: 'sat-1',
    examName: 'Practice Test 06',
    ...overrides,
  };
}

function row(overrides: Partial<SatAttemptRow> = {}): SatAttemptRow {
  return {
    id: 'result-1',
    submissionId: 'sub-1',
    outcomeStatus: 'scored',
    scheduleId: 'sched-1',
    examId: 'sat-1',
    examTitle: 'Practice Test 06',
    versionNumber: 1,
    studentId: 'A001',
    studentName: 'Ananda S.',
    studentEmail: 'ananda@example.com',
    cohortName: 'Morning',
    submittedAt: '2026-09-20T03:00:00Z',
    totalScore: null,
    scoreKind: 'practice',
    releaseStatus: 'ready',
    resultId: 'result-1',
    attemptId: 'attempt-1',
    rawCorrect: 18,
    rawTotal: 27,
    ...overrides,
  } as SatAttemptRow;
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Probe({ examId, sessions }: { examId: string | null; sessions: StudentSession[] }) {
  const { byAttempt, isStale, isLoading, partial } = useRoomScores('sched-1', examId, sessions);
  return (
    <div>
      <span data-testid="staleness">{isStale ? 'stale' : 'fresh'}</span>
      <span data-testid="partial">{partial ? 'partial' : 'complete'}</span>
      <span data-testid="scores-loading">{isLoading ? 'loading' : 'ready'}</span>
      {[...byAttempt.entries()].map(([id, score]) => (
        <span key={id} data-testid={`score-${id}`} data-kind={score.kind} data-srlabel={score.srLabel}>
          {score.label || '(dash)'}
        </span>
      ))}
    </div>
  );
}

function renderProbe(examId: string | null, sessions: StudentSession[]) {
  const client = makeClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<Probe examId={examId} sessions={sessions} />, { wrapper });
}

describe('resolveRoomScore', () => {
  it('projects a scored attempt as checkmark correct/total plus percent', () => {
    const score = resolveRoomScore(session(), row());
    expect(score.kind).toBe('scored');
    expect(score.label).toBe('✓ 18/27 · 67%');
    expect(score.srLabel).toBe('score 18 of 27, 67 percent');
    expect(score.resultId).toBe('result-1');
    expect(score.hasSavedAnswers).toBe(true);
  });

  it('prefers the fresher backend projection over the results row', () => {
    const score = resolveRoomScore(
      session({ scoreCorrect: 20, scoreTotal: 27, scoreStatus: 'scored' }),
      row({ rawCorrect: 18, rawTotal: 27 }),
    );
    expect(score.kind).toBe('scored');
    expect(score.correct).toBe(20);
    expect(score.label).toBe('✓ 20/27 · 74%');
  });

  it('renders live answering counts without ever grading', () => {
    const score = resolveRoomScore(
      session({ scoreAnswered: 9, scoreTotal: 27, scoreStatus: 'answering' }),
      null,
    );
    expect(score.kind).toBe('answering');
    expect(score.label).toBe('9/27 answered');
    expect(score.srLabel).toBe('9 of 27 answered');
    expect(score.correct).toBeNull();
  });

  it('keeps submitted-but-unscored attempts in Scoring, never a zero flash', () => {
    const pending = resolveRoomScore(session(), row({ resultId: null, rawCorrect: undefined, rawTotal: undefined, outcomeStatus: 'pending', attemptStatus: 'submitted' }));
    expect(pending.kind).toBe('scoring');
    expect(pending.label).toBe('Scoring…');
    expect(pending.correct).toBeNull();

    const pendingCounted = resolveRoomScore(
      session({ scoreAnswered: 9, scoreTotal: 27, scoreStatus: 'scoring' }),
      row({ resultId: null, rawCorrect: undefined, rawTotal: undefined, outcomeStatus: 'pending', attemptStatus: 'submitted' }),
    );
    expect(pendingCounted.kind).toBe('scoring');
    expect(pendingCounted.label).toBe('Scoring… 9/27 answered');
  });

  it('marks invalidated attempts Not scored instead of 0/total', () => {
    const score = resolveRoomScore(
      session(),
      row({ resultId: null, rawCorrect: undefined, rawTotal: undefined, outcomeStatus: 'invalidated_proctor' }),
    );
    expect(score.kind).toBe('not_scored');
    expect(score.label).toBe('Not scored');
    expect(score.srLabel).toBe('not scored');
    expect(score.correct).toBeNull();
  });

  it('renders a dash with an empty screen-reader label before anything starts', () => {
    const waiting = resolveRoomScore(session({ satStartState: 'waiting_for_code' }), null);
    expect(waiting.kind).toBe('dash');
    expect(waiting.label).toBe('');
    expect(waiting.srLabel).toBe('');

    const unknown = resolveRoomScore(session(), null);
    expect(unknown.kind).toBe('dash');
  });

  it('expands sealed module splits inside the scored label', () => {
    const score = resolveRoomScore(
      session({
        scoreCorrect: 18,
        scoreTotal: 27,
        scoreStatus: 'scored',
        scoreAnswered: 25,
        scoreModules: [
          { moduleKey: 'rw-m1', answered: 13, correct: 9, total: 13 },
          { moduleKey: 'rw-m2-higher', answered: 12, correct: 9, total: 14 },
        ],
      }),
      row(),
    );
    expect(score.label).toBe('✓ 18/27 · 67% · M1 9/13 M2 9/14 · 2 left');
  });
});

describe('isSameRoomScore', () => {
  it('treats separately resolved but identical facts as the same badge', () => {
    const first = resolveRoomScore(session(), row());
    const second = resolveRoomScore(session(), row());
    expect(first).not.toBe(second);
    expect(isSameRoomScore(first, second)).toBe(true);
  });

  it('detects changed, added, and removed module facts', () => {
    const base = resolveRoomScore(
      session({ scoreCorrect: 18, scoreTotal: 27, scoreStatus: 'scored', scoreAnswered: 25, scoreModules: [{ moduleKey: 'rw-m1', answered: 13, correct: 9, total: 13 }] }),
      row(),
    );
    const same = resolveRoomScore(
      session({ scoreCorrect: 18, scoreTotal: 27, scoreStatus: 'scored', scoreAnswered: 25, scoreModules: [{ moduleKey: 'rw-m1', answered: 13, correct: 9, total: 13 }] }),
      row(),
    );
    expect(isSameRoomScore(base, same)).toBe(true);
    expect(isSameRoomScore(base, { ...same, kind: 'scoring' })).toBe(false);
    expect(isSameRoomScore(base, { ...same, modules: null })).toBe(false);
    expect(isSameRoomScore(base, {
      ...same,
      modules: [{ moduleKey: 'rw-m1', answered: 13, correct: 10, total: 13 }],
    })).toBe(false);
  });
});

describe('useRoomScores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('joins proctor sessions with results rows by attemptId', async () => {
    getMock.mockResolvedValue({
      items: [row(), row({ attemptId: 'attempt-2', resultId: null, rawCorrect: undefined, rawTotal: undefined, outcomeStatus: 'pending', attemptStatus: 'submitted', studentId: 'A002', studentName: 'Budi T.' })],
      total: 2,
      offset: 0,
      limit: 50,
      hasMore: false,
    });
    renderProbe('sat-1', [session(), session({ id: 'attempt-2', studentId: 'A002', name: 'Budi T.' })]);

    await waitFor(() => expect(screen.getByTestId('score-attempt-1')).toHaveTextContent('✓ 18/27 · 67%'));
    expect(screen.getByTestId('score-attempt-1')).toHaveAttribute('data-kind', 'scored');
    expect(screen.getByTestId('score-attempt-1')).toHaveAttribute('data-srlabel', 'score 18 of 27, 67 percent');
    expect(screen.getByTestId('score-attempt-2')).toHaveTextContent('Scoring…');
    expect(screen.getByTestId('staleness')).toHaveTextContent('fresh');
  });

  it('falls back to the backend projection and dims when the results read fails', async () => {
    getMock.mockRejectedValue(new Error('results 500'));
    renderProbe('sat-1', [session({ scoreCorrect: 18, scoreTotal: 27, scoreStatus: 'scored' })]);

    await waitFor(() => expect(screen.getByTestId('staleness')).toHaveTextContent('stale'));
    // The backend projection still renders — the roster never flashes to zero.
    expect(screen.getByTestId('score-attempt-1')).toHaveTextContent('✓ 18/27 · 67%');
  });

  it('uses the backend projection alone when no exam is selected', async () => {
    renderProbe(null, [session({ scoreAnswered: 9, scoreTotal: 27, scoreStatus: 'answering' })]);

    await waitFor(() => expect(screen.getByTestId('score-attempt-1')).toHaveTextContent('9/27 answered'));
    expect(getMock).not.toHaveBeenCalled();
  });

  it('reports first-paint loading so rows can hold a skeleton', async () => {
    getMock.mockImplementation(() => new Promise(() => {}));
    renderProbe('sat-1', [session()]);

    expect(screen.getByTestId('scores-loading')).toHaveTextContent('loading');
    expect(screen.getByTestId('staleness')).toHaveTextContent('fresh');
  });

  it('reuses the previous score object when a poll changes nothing', async () => {
    getMock.mockResolvedValue({
      items: [row()],
      total: 1,
      offset: 0,
      limit: 50,
      hasMore: false,
    });
    const seen: Array<Map<string, RoomScore>> = [];
    function Capture({ sessions }: { sessions: StudentSession[] }) {
      const { byAttempt } = useRoomScores('sched-1', 'sat-1', sessions);
      seen.push(byAttempt);
      return null;
    }
    const client = makeClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { rerender } = render(<Capture sessions={[session()]} />, { wrapper });

    await waitFor(() => expect(seen.at(-1)?.get('attempt-1')?.kind).toBe('scored'));
    const settled = seen.length;
    // New sessions array, same facts: the Map is rebuilt but the value is reused.
    rerender(<Capture sessions={[session()]} />);
    expect(seen.length).toBeGreaterThan(settled);
    expect(seen.at(-1)?.get('attempt-1')).toBe(seen.at(-2)?.get('attempt-1'));
  });

  it('sorts scored attempts before unscored ones in both directions, stable by name', () => {
    const zahra = session({ id: 'attempt-z', name: 'Zahra K.', scoreCorrect: 9, scoreTotal: 27, scoreStatus: 'scored' });
    const ananda = session({ id: 'attempt-a', name: 'Ananda S.', scoreCorrect: 18, scoreTotal: 27, scoreStatus: 'scored' });
    const budi = session({ id: 'attempt-b', name: 'Budi T.' });
    const reasons = new Map<string, string>();
    const scores = new Map([
      ['attempt-z', resolveRoomScore(zahra, null)],
      ['attempt-a', resolveRoomScore(ananda, null)],
      ['attempt-b', resolveRoomScore(budi, null)],
    ]);
    const students = [zahra, ananda, budi];
    expect(sortRoster(students, 'score_desc', reasons, scores).map((s) => s.id))
      .toEqual(['attempt-a', 'attempt-z', 'attempt-b']);
    expect(sortRoster(students, 'score_asc', reasons, scores).map((s) => s.id))
      .toEqual(['attempt-z', 'attempt-a', 'attempt-b']);
  });
});

describe('edge-case fixes (audit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('paginates beyond 50 rows so the 51st attempt still scores', async () => {
    const first = Array.from({ length: 50 }, (_, i) => row({ attemptId: `attempt-${i + 1}`, resultId: `result-${i + 1}`, studentId: `S${i + 1}`, studentName: `Student ${i + 1}` }));
    const last = row({ attemptId: 'attempt-51', resultId: 'result-51', studentId: 'S51', studentName: 'Student 51' });
    getMock.mockImplementation((url: string) => {
      if (String(url).includes('offset=50')) {
        return Promise.resolve({ items: [last], total: 51, offset: 50, limit: 50, hasMore: false });
      }
      return Promise.resolve({ items: first, total: 51, offset: 0, limit: 50, hasMore: true });
    });
    const sessions = [...first.map((r) => session({ id: r.attemptId, studentId: r.studentId, name: r.studentName })), session({ id: 'attempt-51', studentId: 'S51', name: 'Student 51' })];
    renderProbe('sat-1', sessions);
    await waitFor(() => expect(screen.getByTestId('score-attempt-51')).toHaveTextContent('✓ 18/27 · 67%'));
    expect(getMock).toHaveBeenCalledTimes(2);
  });

  it('prefers severity over first-wins on duplicate attemptIds', async () => {
    getMock.mockResolvedValue({
      items: [
        row({ attemptId: 'attempt-1', resultId: null, rawCorrect: undefined, rawTotal: undefined, outcomeStatus: 'pending', attemptStatus: 'submitted' }),
        row({ attemptId: 'attempt-1', outcomeStatus: 'scored' }),
      ],
      total: 2,
      offset: 0,
      limit: 50,
      hasMore: false,
    });
    renderProbe('sat-1', [session()]);
    await waitFor(() => expect(screen.getByTestId('score-attempt-1')).toHaveAttribute('data-kind', 'scored'));
  });

  it('maps unscored rows to Not scored, never 0/total', () => {
    const score = resolveRoomScore(session(), row({ resultId: null, rawCorrect: 9, rawTotal: 13, outcomeStatus: 'unscored' }));
    expect(score.kind).toBe('not_scored');
    expect(score.correct).toBeNull();
    expect(score.label).toBe('Not scored');
  });

  it('never mislabels non-SAT keys as M1/M2', () => {
    const base = { scoreCorrect: 18, scoreTotal: 27, scoreStatus: 'scored' as const, scoreAnswered: 25 };
    expect(resolveRoomScore(session({ ...base, scoreModules: [{ moduleKey: 'exam-m10', answered: 13, correct: 9, total: 13 }] }), row()).label).not.toContain('M1 9/13');
    expect(resolveRoomScore(session({ ...base, scoreModules: [{ moduleKey: 'team1-x', answered: 13, correct: 9, total: 13 }] }), row()).label).not.toContain('M1 9/13');
    expect(resolveRoomScore(session({ ...base, scoreModules: [{ moduleKey: 'rw-m2-higher', answered: 12, correct: 9, total: 14 }] }), row()).label).toContain('M2 9/14');
  });

  it('surfaces corrupt answered>total as scoring with no negative left', () => {
    const score = resolveRoomScore(session({ scoreAnswered: 30, scoreTotal: 27, scoreStatus: 'answering' }), null);
    expect(score.kind).toBe('scoring');
    expect(score.label).toContain('Scoring…');
    expect(score.label).not.toContain('-');
  });

  it('reads ended-without-submit as answering, not a silent dash', () => {
    const score = resolveRoomScore(session(), row({ resultId: null, rawCorrect: undefined, rawTotal: undefined, outcomeStatus: undefined as never, attemptStatus: 'ended' }));
    expect(score.kind).toBe('answering');
  });
});

describe('room cadence + partial (round-2 FE-1: T-02/03/04)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T-02: room-cadence refetch upgrades the badge within 30s (fake timers)', async () => {
    // jsdom reports the document unfocused, which pauses refetchInterval;
    // force focus so the room-cadence poll fires like a visible proctor tab.
    focusManager.setFocused(true);
    vi.useFakeTimers();
    try {
      const answeringRow = row({ resultId: null, rawCorrect: undefined, rawTotal: undefined, outcomeStatus: 'pending', attemptStatus: 'submitted' });
      const scoredRow = row();
      getMock
        .mockResolvedValueOnce({ items: [answeringRow], total: 1, offset: 0, limit: 50, hasMore: false })
        .mockResolvedValue({ items: [scoredRow], total: 1, offset: 0, limit: 50, hasMore: false });
      renderProbe('sat-1', [session()]);

      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByTestId('score-attempt-1')).toHaveTextContent('Scoring');
      expect(getMock).toHaveBeenCalledTimes(1);

      // Room cadence: one 15s poll picks up the fresh submit. The trailing
      // 1ms releases query-notify work parked on faked timers (notify rides
      // a 0ms setTimeout that a 0ms advance does not release).
      await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(screen.getByTestId('score-attempt-1')).toHaveTextContent('✓ 18/27 · 67%');
      expect(getMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(screen.getByTestId('staleness')).toHaveTextContent('fresh');
    } finally {
      vi.useRealTimers();
      focusManager.setFocused(undefined);
    }
  });

  it('T-03: page-2 failure keeps the 50 fetched badges and dims stale (partial)', async () => {
    const first = Array.from({ length: 50 }, (_, i) => row({ attemptId: `attempt-${i + 1}`, resultId: `result-${i + 1}`, studentId: `S${i + 1}`, studentName: `Student ${i + 1}` }));
    getMock.mockImplementation((url: string) => {
      if (String(url).includes('offset=50')) {
        return Promise.reject(new Error('page 2 500'));
      }
      return Promise.resolve({ items: first, total: 51, offset: 0, limit: 50, hasMore: true });
    });
    const sessions = first.map((r) => session({ id: r.attemptId, studentId: r.studentId, name: r.studentName }));
    renderProbe('sat-1', sessions);

    // All 50 fetched badges render — never zeroed by the later-page failure.
    await waitFor(() => expect(screen.getByTestId('score-attempt-1')).toHaveTextContent('✓ 18/27 · 67%'));
    expect(screen.getByTestId('score-attempt-50')).toHaveTextContent('✓ 18/27 · 67%');
    expect(getMock).toHaveBeenCalledTimes(2);
    // Partial channel: stale dim, never a zero flash.
    expect(screen.getByTestId('staleness')).toHaveTextContent('stale');
    expect(screen.getByTestId('partial')).toHaveTextContent('partial');
  });

  it('T-04: traversal gap (all.length < total) sets partial + stale footnote', async () => {
    const first = Array.from({ length: 50 }, (_, i) => row({ attemptId: `attempt-${i + 1}`, resultId: `result-${i + 1}`, studentId: `S${i + 1}`, studentName: `Student ${i + 1}` }));
    // A submit interleaves between page reads: the 52nd row appears, so the
    // two pages together (50 + 1) fall short of the latest total (52).
    const last = row({ attemptId: 'attempt-51', resultId: 'result-51', studentId: 'S51', studentName: 'Student 51' });
    getMock.mockImplementation((url: string) => {
      if (String(url).includes('offset=50')) {
        return Promise.resolve({ items: [last], total: 52, offset: 50, limit: 50, hasMore: false });
      }
      return Promise.resolve({ items: first, total: 52, offset: 0, limit: 50, hasMore: true });
    });
    const sessions = [...first.map((r) => session({ id: r.attemptId, studentId: r.studentId, name: r.studentName })), session({ id: 'attempt-51', studentId: 'S51', name: 'Student 51' })];
    renderProbe('sat-1', sessions);

    await waitFor(() => expect(screen.getByTestId('score-attempt-51')).toHaveTextContent('✓ 18/27 · 67%'));
    // Gap signal reuses the partial channel: stale footnote until next poll heals.
    expect(screen.getByTestId('staleness')).toHaveTextContent('stale');
    expect(screen.getByTestId('partial')).toHaveTextContent('partial');
  });
});

describe('room score rules (round-2 FE-2: T-01/05/07)', () => {
  it('T-01: scored 0/27 renders a zero badge, never a dash or Scoring', () => {
    const score = resolveRoomScore(session(), row({ rawCorrect: 0, rawTotal: 27 }));
    expect(score.kind).toBe('scored');
    expect(score.correct).toBe(0);
    expect(score.total).toBe(27);
    expect(score.pct).toBe(0);
    expect(score.label).toBe('✓ 0/27 · 0%');
    expect(score.srLabel).toBe('score 0 of 27, 0 percent');
  });

  it('T-05: terminated/locked with no outcome or counts reads Not scored (no-facts dash case)', () => {
    for (const attemptStatus of ['terminated', 'locked'] as const) {
      const score = resolveRoomScore(
        session({ satStartState: 'waiting_for_code' }),
        row({ resultId: null, rawCorrect: undefined, rawTotal: undefined, outcomeStatus: undefined as never, attemptStatus }),
      );
      expect(score.kind).toBe('not_scored');
      expect(score.label).toBe('Not scored');
      expect(score.srLabel).toBe('not scored');
      expect(score.correct).toBeNull();
    }
  });

  it('T-05: terminated/locked with open answering facts reads Not scored (never answering-forever)', () => {
    for (const attemptStatus of ['terminated', 'locked'] as const) {
      const score = resolveRoomScore(
        session({ scoreAnswered: 9, scoreTotal: 27, scoreStatus: 'answering' }),
        row({ resultId: null, rawCorrect: undefined, rawTotal: undefined, outcomeStatus: undefined as never, attemptStatus }),
      );
      expect(score.kind).toBe('not_scored');
      expect(score.label).toBe('Not scored');
      expect(score.srLabel).toBe('not scored');
    }
  });

  it('T-05 regrade-safe: real correctness or a scored-path outcome still wins over terminal', () => {
    // Correctness wins: a later regrade upgrades even a locked delivery.
    const regraded = resolveRoomScore(
      session(),
      row({ rawCorrect: 18, rawTotal: 27, outcomeStatus: undefined as never, attemptStatus: 'locked' }),
    );
    expect(regraded.kind).toBe('scored');
    expect(regraded.label).toBe('✓ 18/27 · 67%');

    // Pending + submitted wins: grading in flight stays in scoring.
    const grading = resolveRoomScore(
      session(),
      row({ resultId: null, rawCorrect: undefined, rawTotal: undefined, outcomeStatus: 'pending', attemptStatus: 'terminated' }),
    );
    expect(grading.kind).toBe('scoring');
  });

  it('T-07: BE correct=9/total=nil + row 18/27 stays scoring, never a mixed 9/27 scored badge', () => {
    const score = resolveRoomScore(
      session({ scoreCorrect: 9, scoreTotal: null, scoreStatus: 'scoring' }),
      row({ rawCorrect: 18, rawTotal: 27 }),
    );
    expect(score.kind).toBe('scoring');
    expect(score.kind).not.toBe('scored');
    expect(score.label).not.toContain('✓ 9/27');
    expect(score.correct).toBeNull();
  });
});
