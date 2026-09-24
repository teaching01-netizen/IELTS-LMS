import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SatResultDetailRoute } from '../SatResultDetailRoute';
import { SatResultsRoute } from '../SatResultsRoute';
import { SatAttemptAnswersRoute } from '../SatAttemptAnswersRoute';

const useSatResultsQueryMock = vi.hoisted(() => vi.fn());
const useSatAttemptsQueryMock = vi.hoisted(() => vi.fn());
const useSatResultQueryMock = vi.hoisted(() => vi.fn());
const useSatAttemptAnswersQueryMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../features/results/api/satResultsQueries', () => ({
  useSatResultsQuery: useSatResultsQueryMock,
  useSatAttemptsQuery: useSatAttemptsQueryMock,
  useSatResultQuery: useSatResultQueryMock,
  useSatAttemptAnswersQuery: useSatAttemptAnswersQueryMock,
}));

const accessGroups = [
  { scheduleId: 'schedule-1', accessLinkId: 'link-1', accessLinkName: 'Saturday 9 AM', accessLinkState: 'active', examId: 'sat-1', examTitle: 'Practice Test 06', versionNumber: 12, cohortName: 'Morning', attemptCount: 2, submittedCount: 2, scoredCount: 1, pendingCount: 1, invalidatedCount: 0, latestSubmittedAt: '2026-09-01T08:00:00Z' },
  { scheduleId: 'schedule-2', accessLinkId: null, accessLinkName: 'Previous Student Access', accessLinkState: null, examId: 'sat-1', examTitle: 'Practice Test 06', versionNumber: 20, cohortName: '', attemptCount: 1, submittedCount: 1, scoredCount: 1, pendingCount: 0, invalidatedCount: 0, latestSubmittedAt: '2026-09-02T08:00:00Z' },
  { scheduleId: 'schedule-3', accessLinkId: 'link-3', accessLinkName: 'Monday Makeup', accessLinkState: 'paused', examId: 'sat-2', examTitle: 'Practice Test 07', versionNumber: 4, cohortName: 'Monday', attemptCount: 1, submittedCount: 1, scoredCount: 0, pendingCount: 0, invalidatedCount: 1, latestSubmittedAt: '2026-08-29T08:00:00Z' },
];
const pageOne = {
  items: [
    { resultId: 'result-1', attemptId: 'attempt-1', outcomeStatus: 'scored', releaseStatus: 'ready_to_release', totalScore: 1380, scheduleId: 'schedule-1', examId: 'sat-1', examTitle: 'Practice Test 06', versionNumber: 12, studentId: 'S1', studentName: 'John Smith', studentEmail: null, cohortName: 'Morning', submittedAt: '2026-09-01T08:00:00Z' },
    { resultId: null, attemptId: 'attempt-2', attemptStatus: 'running', outcomeStatus: 'unscored', releaseStatus: '', totalScore: null, scheduleId: 'schedule-1', examId: 'sat-1', examTitle: 'Practice Test 06', versionNumber: 12, studentId: 'S2', studentName: 'Student X', studentEmail: null, cohortName: 'Morning', submittedAt: null },
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
  return render(<MemoryRouter initialEntries={[initialEntry]}><LocationProbe /><Routes><Route path="/sat/results" element={<SatResultsRoute />} /><Route path="/sat/results/attempts/:attemptId" element={<SatAttemptAnswersRoute />} /><Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} /></Routes></MemoryRouter>);
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
    useSatAttemptAnswersQueryMock.mockReturnValue({
      data: { attemptId: 'attempt-2', examTitle: 'Practice Test 06', versionNumber: 12, studentId: 'S2', studentName: 'Student X', cohortName: 'Morning', status: 'running', protocolVersion: 2, responseRevision: 4, savedAnswerCount: 1, lastSavedAt: '2026-09-01T08:05:00Z', questions: [
        { questionId: 'q1', sectionKey: 'reading-writing', moduleKey: 'module-1', displayOrder: 1, response: 'B', markedForReview: false },
        { questionId: 'q2', sectionKey: 'reading-writing', moduleKey: 'module-1', displayOrder: 2, response: null, markedForReview: false },
      ] }, isLoading: false, error: null, isFetching: false, refetch: vi.fn(),
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

  it('opens server-saved answers for an attempt without a score', () => {
    renderResultsRoute('/sat/results?exam=sat-1&access=schedule-1');
    const row = screen.getByText('Student X').closest('button');
    expect(row).toBeEnabled();
    fireEvent.click(row as HTMLElement);
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/results/attempts/attempt-2');
    expect(screen.getByText('1 server-saved answers')).toBeInTheDocument();
    expect(screen.getByText(/Revision 4/)).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('Unanswered')).toBeInTheDocument();
    expect(screen.queryByText('Correct answer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to SAT results' }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/results?exam=sat-1&access=schedule-1');
  });

  it('opens attempt answers when a pending result row exists', () => {
    useSatAttemptsQueryMock.mockReturnValueOnce({
      data: { ...pageOne, items: [{ ...pageOne.items[1], resultId: 'pending-result', outcomeStatus: 'pending', attemptStatus: 'submitted' }] },
      isLoading: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    renderResultsRoute('/sat/results?exam=sat-1&access=schedule-1');
    fireEvent.click(screen.getByRole('button', { name: /Student X/ }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/results/attempts/attempt-2');
  });

  it('distinguishes no saved answer from a failed answer read', () => {
    useSatAttemptAnswersQueryMock.mockReturnValueOnce({ data: { attemptId: 'attempt-2', examTitle: 'Practice Test 06', versionNumber: 12, studentId: 'S2', studentName: 'Student X', cohortName: 'Morning', status: 'running', protocolVersion: 2, responseRevision: 0, savedAnswerCount: 0, lastSavedAt: null, questions: [{ questionId: 'q1', sectionKey: 'math', moduleKey: 'm1', displayOrder: 1, response: null, markedForReview: false }] }, isLoading: false, error: null, isFetching: false, refetch: vi.fn() });
    renderResultsRoute('/sat/results/attempts/attempt-2');
    expect(screen.getByText('0 server-saved answers')).toBeInTheDocument();
    expect(screen.getByText(/No server save yet/)).toBeInTheDocument();
    expect(screen.getByText('Unanswered')).toBeInTheDocument();
  });

  it('offers retry when saved answers cannot be loaded', () => {
    const refetch = vi.fn();
    useSatAttemptAnswersQueryMock.mockReturnValueOnce({ data: undefined, isLoading: false, error: new Error('offline'), isFetching: false, refetch });
    renderResultsRoute('/sat/results/attempts/attempt-2');
    expect(screen.getByText('Saved answers could not load')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
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
