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
    expect(screen.getByText('Practice · raw score')).toBeInTheDocument();
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
});
