import { render, screen } from '@testing-library/react';
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
  submittedAt: '2026-08-30T08:00:00Z', totalScore: 1370, scoreKind: 'practice', releaseStatus: 'ready_to_release',
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

  it('falls back to truthful raw score when no scaled total exists', () => {
    useSatResultQueryMock.mockReturnValue({
      data: {
        summary: { ...summary, totalScore: null }, scorePayload: {},
        sections: [
          { sectionKey: 'reading-writing', route: 'higher', rawCorrect: 30, operationalQuestionCount: 34, scaledScore: null, details: {} },
          { sectionKey: 'math', route: null, rawCorrect: 12, operationalQuestionCount: 20, scaledScore: null, details: {} },
        ],
      }, isLoading: false, error: null, refetch: vi.fn(),
    });
    render(<MemoryRouter initialEntries={['/sat/results/result-1']}><Routes><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
    expect(screen.getByText('42/54')).toBeInTheDocument();
    expect(screen.getByText('Practice · raw score')).toBeInTheDocument();
    expect(screen.getByText('Reading & Writing')).toBeInTheDocument();
    expect(screen.getByText('Math')).toBeInTheDocument();
    expect(screen.getByText('Adaptive route · Higher')).toBeInTheDocument();
  });
});
