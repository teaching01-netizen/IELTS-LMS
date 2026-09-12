import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SatResultDetailRoute } from '../SatResultDetailRoute';
import { SatResultsRoute } from '../SatResultsRoute';

const useSatResultsQueryMock = vi.hoisted(() => vi.fn());
const useSatResultQueryMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../features/results/api/satResultsQueries', () => ({
  useSatResultsQuery: useSatResultsQueryMock,
  useSatResultQuery: useSatResultQueryMock,
}));

const summary = {
  id: 'result-1', submissionId: 'submission-1', scheduleId: 'schedule-1', examId: 'sat-1', examTitle: 'Practice Test 06',
  versionNumber: 3, studentId: 'W2501', studentName: 'Ananda S.', studentEmail: null, cohortName: 'Morning',
  submittedAt: '2026-08-30T08:00:00Z', totalScore: 1370, scoreKind: 'practice', releaseStatus: 'ready_to_release', outcomeStatus: 'scored',
};

describe('SAT Results product', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders SAT practice scores without IELTS band-score language', () => {
    useSatResultsQueryMock.mockReturnValue({ data: [summary], isLoading: false, error: null, refetch: vi.fn() });
    render(<MemoryRouter><SatResultsRoute /></MemoryRouter>);
    expect(screen.getByText('Ananda S.')).toBeInTheDocument();
    expect(screen.getByText('1370')).toBeInTheDocument();
    expect(screen.queryByText(/overall band/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/6\.5/)).not.toBeInTheDocument();
  });

  it('renders header plus skeleton while loading, without blanking the page', () => {
    useSatResultsQueryMock.mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: vi.fn() });
    render(<MemoryRouter><SatResultsRoute /></MemoryRouter>);
    expect(screen.getByText('Results')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading SAT results' })).toBeInTheDocument();
  });

  it('announces the visible result count once data is present', () => {
    useSatResultsQueryMock.mockReturnValue({ data: [summary], isLoading: false, error: null, refetch: vi.fn() });
    render(<MemoryRouter><SatResultsRoute /></MemoryRouter>);
    expect(screen.getByRole('status')).toHaveTextContent('1 result');
  });

  it('filters results by score availability and explains an empty match', () => {
    useSatResultsQueryMock.mockReturnValue({
      data: [summary, { ...summary, id: 'result-2', studentName: 'Unscored Student', totalScore: null }],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<MemoryRouter><SatResultsRoute /></MemoryRouter>);
    expect(screen.getByText('Ananda S.')).toBeInTheDocument();
    expect(screen.getByText('Unscored Student')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Score available/i }));
    expect(screen.getByText('Ananda S.')).toBeInTheDocument();
    expect(screen.queryByText('Unscored Student')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Score unavailable/i }));
    expect(screen.getByText('Unscored Student')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search SAT results'), { target: { value: 'missing' } });
    expect(screen.getByText('No matching SAT results')).toBeInTheDocument();
  });

  it('renders explicit proctor invalidation instead of treating termination as a missing score', () => {
    useSatResultsQueryMock.mockReturnValue({
      data: [{ ...summary, id: 'result-terminated', submissionId: null, totalScore: null, outcomeStatus: 'invalidated_proctor' }],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<MemoryRouter><SatResultsRoute /></MemoryRouter>);
    expect(screen.getByText('Exam terminated by proctor')).toBeInTheDocument();
    expect(screen.queryByText('Practice')).not.toBeInTheDocument();
  });

  it('renders a status pill per row with the frozen outcome tone map', () => {
    useSatResultsQueryMock.mockReturnValue({
      data: [
        summary,
        { ...summary, id: 'result-pending', studentName: 'Pending Student', outcomeStatus: 'pending', totalScore: null },
        { ...summary, id: 'result-terminated', studentName: 'Terminated Student', outcomeStatus: 'invalidated_proctor', totalScore: null },
      ],
      isLoading: false,
      error: null,
      isFetching: false,
      refetch: vi.fn(),
    });
    render(<MemoryRouter><SatResultsRoute /></MemoryRouter>);
    // Phase 02 single-pill contract: each row exposes exactly one status signal (the pill).
    // The duplicate 'outcome · Practice · releaseStatus' caption was deleted.
    expect(screen.getAllByText('Practice')).toHaveLength(1);
    expect(screen.getByText('Scoring pending')).toBeInTheDocument();
    expect(screen.getByText('Exam terminated by proctor')).toBeInTheDocument();
    expect(screen.queryByText('Scoring pending · Practice · ready_to_release')).not.toBeInTheDocument();
    expect(screen.queryByText('Exam terminated by proctor · Practice · ready_to_release')).not.toBeInTheDocument();
  });

  it('exposes a single status signal per row without a duplicate release-status caption', () => {
    useSatResultsQueryMock.mockReturnValue({ data: [summary], isLoading: false, error: null, isFetching: false, refetch: vi.fn() });
    render(<MemoryRouter><SatResultsRoute /></MemoryRouter>);
    expect(screen.getByText('Practice')).toBeInTheDocument();
    expect(screen.queryByText('Practice · Practice · ready_to_release')).not.toBeInTheDocument();
    expect(screen.queryByText(/· Practice ·/)).not.toBeInTheDocument();
  });

  it('shows a subtle updating cue while refetching loaded results', () => {
    useSatResultsQueryMock.mockReturnValue({ data: [summary], isLoading: false, error: null, isFetching: true, refetch: vi.fn() });
    render(<MemoryRouter><SatResultsRoute /></MemoryRouter>);
    expect(screen.getByText('Updating…')).toBeInTheDocument();
  });

  it('keeps tabular meta lines and the 17px score block on each row (04A hierarchy guard)', () => {
    useSatResultsQueryMock.mockReturnValue({ data: [summary], isLoading: false, error: null, isFetching: false, refetch: vi.fn() });
    const { container } = render(<MemoryRouter><SatResultsRoute /></MemoryRouter>);
    const row = screen.getByText('Ananda S.').closest('.sat-list-row');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent('W2501');
    expect(row).toHaveTextContent('Morning');
    expect(row).toHaveTextContent('Practice Test 06');
    const score = screen.getByText('1370');
    expect(score.className).toMatch(/tabular-nums/);
    expect(score.closest('.sat-list-row')).not.toBeNull();
    const tabularMetas = row?.querySelectorAll('.tabular-nums') ?? [];
    expect(tabularMetas.length).toBeGreaterThanOrEqual(2);
    expect(container.innerHTML).not.toMatch(/bg-gradient|backdrop-blur/);
  });

  it('keeps the result-count announcer visible when a filter matches nothing', () => {
    useSatResultsQueryMock.mockReturnValue({ data: [summary], isLoading: false, error: null, isFetching: false, refetch: vi.fn() });
    render(<MemoryRouter><SatResultsRoute /></MemoryRouter>);
    fireEvent.click(screen.getByRole('radio', { name: /Score unavailable/i }));
    expect(screen.getByText('No matching SAT results')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 of 1 results');
  });

  it('labels the back control with its destination', () => {
    useSatResultQueryMock.mockReturnValue({
      data: { summary, scorePayload: {}, sections: [], questions: [] },
      isLoading: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-1']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Back to SAT results' })).toBeInTheDocument();
  });

  it('shows the hero basis caption with release status on the detail page', () => {
    useSatResultQueryMock.mockReturnValue({
      data: { summary, scorePayload: {}, sections: [], questions: [] },
      isLoading: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-1']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByText('Scaled practice score · Practice · ready_to_release')).toBeInTheDocument();
    // Policy footnote stays pinned below the question sections.
    expect(screen.getByText(/generated by this practice assessment system/i)).toBeInTheDocument();
  });

  it('renders the static detail outcome without a redundant live region', () => {
    useSatResultQueryMock.mockReturnValue({
      data: {
        summary: { ...summary, outcomeStatus: 'pending', totalScore: null }, scorePayload: {}, sections: [], questions: [],
      },
      isLoading: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-1']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    const outcome = screen.getByText(/No score was produced for this attempt\./);
    expect(outcome).toBeInTheDocument();
    expect(outcome).not.toHaveAttribute('role');
  });

  it('falls back to truthful raw score when no scaled total exists', () => {
    useSatResultQueryMock.mockReturnValue({
      data: {
        summary: { ...summary, totalScore: null }, scorePayload: {},
        sections: [
          { sectionKey: 'reading-writing', route: 'higher', rawCorrect: 30, operationalQuestionCount: 34, scaledScore: null, details: {}, modules: [] },
          { sectionKey: 'math', route: null, rawCorrect: 12, operationalQuestionCount: 20, scaledScore: null, details: {}, modules: [] },
        ],
        questions: [],
      }, isLoading: false, error: null, refetch: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-1']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByText('42/54')).toBeInTheDocument();
    expect(screen.getByText('Raw correct 42/54 — scaled score unavailable · Practice · ready_to_release')).toBeInTheDocument();
    expect(screen.getByText('Reading & Writing')).toBeInTheDocument();
    expect(screen.getByText('Math')).toBeInTheDocument();
    expect(screen.getByText('Adaptive route · Higher')).toBeInTheDocument();
  });

  it('shows module raw scores and question-level responses without fabricating verdicts', () => {
    useSatResultQueryMock.mockReturnValue({
      data: {
        summary, scorePayload: {},
        sections: [
          {
            sectionKey: 'reading-writing', route: 'higher', rawCorrect: 20, operationalQuestionCount: 34,
            scaledScore: 680, details: {},
            modules: [
              { moduleKey: 'rw-base', adaptiveRole: 'base', rawCorrect: 12, operationalQuestionCount: 20, state: 'submitted', isAdministered: true, displayOrder: 1 },
              { moduleKey: 'rw-higher', adaptiveRole: 'higher_branch', rawCorrect: 8, operationalQuestionCount: 14, state: 'submitted', isAdministered: true, displayOrder: 2 },
            ],
          },
        ],
        questions: [
          { questionId: 'q-ok', displayOrder: 1, moduleKey: 'rw-base', sectionKey: 'reading-writing', response: 'B', correctAnswer: 'B', isCorrect: true, isPretest: false, markedForReview: false },
          { questionId: 'q-wrong', displayOrder: 2, moduleKey: 'rw-base', sectionKey: 'reading-writing', response: 'A', correctAnswer: 'B', isCorrect: false, isPretest: false, markedForReview: true },
          { questionId: 'q-pre', displayOrder: 3, moduleKey: 'rw-base', sectionKey: 'reading-writing', response: 'B', correctAnswer: 'B', isCorrect: null, isPretest: true, markedForReview: false },
          { questionId: 'q-blank', displayOrder: 4, moduleKey: 'rw-base', sectionKey: 'reading-writing', response: null, correctAnswer: 'B', isCorrect: null, isPretest: false, markedForReview: false },
        ],
      }, isLoading: false, error: null, refetch: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-1']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    // Module raw scores and question-level responses render by default (no toggles).
    expect(screen.getByText('rw-base')).toBeInTheDocument();
    expect(screen.getByText('12 / 20')).toBeInTheDocument();
    expect(screen.getByText('q-ok · rw-base')).toBeInTheDocument();
    expect(screen.getByText('Correct')).toBeInTheDocument();
    expect(screen.getByText('Incorrect')).toBeInTheDocument();
    expect(screen.getByText('Pretest · excluded')).toBeInTheDocument();
    // A null verdict never renders as incorrect: one Correct + one Incorrect only.
    expect(screen.getAllByText('Not scored')).toHaveLength(2);
  });

  it('keeps the hero score on tabular-nums', () => {
    useSatResultQueryMock.mockReturnValue({
      data: { summary, scorePayload: {}, sections: [], questions: [] },
      isLoading: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-1']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByText('1370')).toHaveClass('tabular-nums');
  });

  it('caps the performance stagger index at 5', () => {
    const sections = Array.from({ length: 7 }, (_, i) => ({
      sectionKey: `section-${i}`, route: null, rawCorrect: 1, operationalQuestionCount: 2, scaledScore: 100, details: {}, modules: [],
    }));
    useSatResultQueryMock.mockReturnValue({
      data: { summary, scorePayload: {}, sections, questions: [] },
      isLoading: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-1']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    const cards = document.querySelectorAll('.sat-row-enter');
    expect(cards).toHaveLength(7);
    // Row-index custom property caps at 5: the 7th card still carries index 5.
    cards.forEach((card, cardIndex) => {
      expect((card as HTMLElement).style.getPropertyValue('--sat-row-index')).toBe(String(Math.min(cardIndex, 5)));
    });
  });

  it('names the module dl and omits the jargon identifier note', () => {
    useSatResultQueryMock.mockReturnValue({
      data: {
        summary, scorePayload: {},
        sections: [
          {
            sectionKey: 'reading-writing', route: null, rawCorrect: 20, operationalQuestionCount: 34,
            scaledScore: 680, details: {},
            modules: [
              { moduleKey: 'rw-base', adaptiveRole: 'base', rawCorrect: 12, operationalQuestionCount: 20, state: 'submitted', isAdministered: true, displayOrder: 1 },
            ],
          },
          {
            sectionKey: 'math', route: null, rawCorrect: 10, operationalQuestionCount: 20,
            scaledScore: 650, details: {},
            modules: [
              { moduleKey: 'm-base', adaptiveRole: 'base', rawCorrect: 10, operationalQuestionCount: 20, state: 'submitted', isAdministered: true, displayOrder: 1 },
            ],
          },
        ],
        questions: [],
      }, isLoading: false, error: null, refetch: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-1']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    // Module dl carries an accessible name ending in 'module raw scores'.
    // Phase 02 deleted the jargon footnote 'Module identifiers as delivered.'.
    expect(screen.getByLabelText('Reading & Writing module raw scores')).toBeInTheDocument();
    expect(screen.queryByText('Module identifiers as delivered.')).not.toBeInTheDocument();
  });

  it('shows the empty questions state and hides the section on unscored results', () => {
    useSatResultQueryMock.mockReturnValue({
      data: { summary, scorePayload: {}, sections: [{ sectionKey: 'reading-writing', route: null, rawCorrect: 0, operationalQuestionCount: 0, scaledScore: null, details: {}, modules: [] }], questions: [] },
      isLoading: false, error: null, refetch: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-1']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByText('No question-level responses recorded for this result.')).toBeInTheDocument();
  });

  it('renders no Question-level responses section on unscored results', () => {
    useSatResultQueryMock.mockReturnValue({
      data: { summary: { ...summary, outcomeStatus: 'pending', totalScore: null }, scorePayload: {}, sections: [], questions: [] },
      isLoading: false, error: null, refetch: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-2']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    expect(screen.queryByText(/Question-level responses/)).not.toBeInTheDocument();
  });
});
