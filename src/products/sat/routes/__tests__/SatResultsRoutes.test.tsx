import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SatResultDetailRoute } from '../SatResultDetailRoute';
import { SatResultsRoute } from '../SatResultsRoute';

const useSatResultsQueryMock = vi.hoisted(() => vi.fn());
const useSatAttemptsQueryMock = vi.hoisted(() => vi.fn());
const useSatResultQueryMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../features/results/api/satResultsQueries', () => ({
  useSatResultsQuery: useSatResultsQueryMock,
  useSatAttemptsQuery: useSatAttemptsQueryMock,
  useSatResultQuery: useSatResultQueryMock,
}));

const accessGroups = [
  { scheduleId: 'schedule-1', accessLinkId: 'link-1', accessLinkName: 'Saturday 9 AM', accessLinkState: 'active', examId: 'sat-1', examTitle: 'Practice Test 06', versionNumber: 12, cohortName: 'Morning', attemptCount: 2, submittedCount: 2, scoredCount: 1, pendingCount: 1, invalidatedCount: 0, latestSubmittedAt: '2026-09-01T08:00:00Z' },
  { scheduleId: 'schedule-2', accessLinkId: null, accessLinkName: 'Previous Student Access', accessLinkState: null, examId: 'sat-1', examTitle: 'Practice Test 06', versionNumber: 20, cohortName: '', attemptCount: 1, submittedCount: 1, scoredCount: 1, pendingCount: 0, invalidatedCount: 0, latestSubmittedAt: '2026-09-02T08:00:00Z' },
  { scheduleId: 'schedule-3', accessLinkId: 'link-3', accessLinkName: 'Monday Makeup', accessLinkState: 'paused', examId: 'sat-2', examTitle: 'Practice Test 07', versionNumber: 4, cohortName: 'Monday', attemptCount: 1, submittedCount: 1, scoredCount: 0, pendingCount: 0, invalidatedCount: 1, latestSubmittedAt: '2026-08-29T08:00:00Z' },
];
const pageOne = {
  items: [
    { resultId: 'result-1', attemptId: 'attempt-1', outcomeStatus: 'scored', releaseStatus: 'ready_to_release', totalScore: 1380, scheduleId: 'schedule-1', examId: 'sat-1', examTitle: 'Practice Test 06', versionNumber: 12, studentId: 'S1', studentName: 'John Smith', studentEmail: null, cohortName: 'Morning', submittedAt: '2026-09-01T08:00:00Z' },
    { resultId: null, attemptId: 'attempt-2', outcomeStatus: 'unscored', releaseStatus: '', totalScore: null, scheduleId: 'schedule-1', examId: 'sat-1', examTitle: 'Practice Test 06', versionNumber: 12, studentId: 'S2', studentName: 'Student X', studentEmail: null, cohortName: 'Morning', submittedAt: null },
  ], total: 51, offset: 0, limit: 50, hasMore: true,
};
const pageTwo = {
  items: [{ ...pageOne.items[0], resultId: 'result-51', attemptId: 'attempt-51', studentName: 'Older Student' }],
  total: 51, offset: 50, limit: 50, hasMore: false,
};

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="test-location">{location.pathname + location.search}</span>;
}
function renderResultsRoute(initialEntry = '/sat/results') {
  return render(<MemoryRouter initialEntries={[initialEntry]}><LocationProbe /><Routes><Route path="/sat/results" element={<SatResultsRoute />} /><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
}

describe('SAT Results hierarchy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSatResultsQueryMock.mockReturnValue({ data: accessGroups, isLoading: false, error: null, isFetching: false, refetch: vi.fn() });
    useSatAttemptsQueryMock.mockImplementation((_examId: string, scheduleId: string, offset: number) => ({
      data: scheduleId === 'schedule-1' ? (offset === 0 ? pageOne : pageTwo) : { items: [], total: 0, offset, limit: 50, hasMore: false },
      isLoading: false, error: null, isFetching: false, refetch: vi.fn(),
    }));
    useSatResultQueryMock.mockReturnValue({
      data: { summary: { id: 'result-1', attemptId: 'attempt-1', outcomeStatus: 'scored', releaseStatus: 'ready_to_release', totalScore: 1380, scheduleId: 'schedule-1', examId: 'sat-1', examTitle: 'Practice Test 06', versionNumber: 12, studentId: 'S1', studentName: 'John Smith', studentEmail: null, cohortName: 'Morning', submittedAt: '2026-09-01T08:00:00Z' }, scorePayload: {}, sections: [], questions: [] },
      isLoading: false, error: null, isFetching: false, refetch: vi.fn(),
    });
  });

  it('groups exams, then Student Access schedules, without exposing students at either level', () => {
    const { container } = renderResultsRoute();
    expect(container.querySelectorAll('.sat-list-row')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Practice Test 06/ }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/results?exam=sat-1');
    expect(screen.getByRole('button', { name: /Saturday 9 AM/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Previous Student Access/ })).toBeInTheDocument();
    expect(screen.queryByText('John Smith')).not.toBeInTheDocument();
  });

  it('keeps attempts inside their schedule and opens the existing detail by result id', () => {
    renderResultsRoute('/sat/results?exam=sat-1&access=schedule-1');
    expect(screen.getByText('John Smith')).toBeInTheDocument();
    expect(screen.getByText('Student X')).toBeInTheDocument();
    expect(screen.queryByText('Older Student')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /John Smith/ }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/results/result-1');
    expect(screen.getByRole('heading', { name: 'John Smith' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to SAT results' }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/results?exam=sat-1&access=schedule-1');
  });

  it('leaves attempts without result rows visible but not openable', () => {
    renderResultsRoute('/sat/results?exam=sat-1&access=schedule-1');
    const row = screen.getByText('Student X').closest('button');
    expect(row).toBeDisabled();
    expect(screen.getByText('Not scored')).toBeInTheDocument();
  });

  it('paginates through older attempts rather than truncating the schedule', () => {
    renderResultsRoute('/sat/results?exam=sat-1&access=schedule-1');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(useSatAttemptsQueryMock).toHaveBeenLastCalledWith('sat-1', 'schedule-1', 50, '', 'all');
    expect(screen.getByText('Older Student')).toBeInTheDocument();
  });

  it('keeps deleted-link fallback and versions on schedule groups', () => {
    renderResultsRoute('/sat/results?exam=sat-1');
    expect(screen.getByText('Version 20 · 1 submitted · 1 scored')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Previous Student Access/ })).toBeInTheDocument();
  });
});
