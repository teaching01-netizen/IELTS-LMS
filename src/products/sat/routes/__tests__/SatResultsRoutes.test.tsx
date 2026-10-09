import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SatResultDetailRoute } from '../SatResultDetailRoute';
import { SatResultsContent, SatResultsRoute } from '../SatResultsRoute';
import { SatAttemptAnswersRoute } from '../SatAttemptAnswersRoute';

const useSatResultsQueryMock = vi.hoisted(() => vi.fn());
const useSatAttemptsQueryMock = vi.hoisted(() => vi.fn());
const useSatResultQueryMock = vi.hoisted(() => vi.fn());
const useSatAttemptAnswersQueryMock = vi.hoisted(() => vi.fn());
const downloadSatRawdataXlsxMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../features/results/api/satRawdataExport', () => ({
  downloadSatRawdataXlsx: downloadSatRawdataXlsxMock,
}));
vi.mock('../../../../features/results/api/satResultsQueries', () => ({
  useSatResultsQuery: useSatResultsQueryMock,
  useSatAttemptsQuery: useSatAttemptsQueryMock,
  useSatResultQuery: useSatResultQueryMock,
  useSatAttemptAnswersQuery: useSatAttemptAnswersQueryMock,
}));

const accessGroups = [
  { scheduleId: 'schedule-1', accessLinkId: 'link-1', accessLinkName: 'Saturday 9 AM', accessLinkState: 'active', examId: 'sat-1', examTitle: 'Practice Test 06', versionNumber: 12, cohortName: 'Morning', attemptCount: 2, submittedCount: 2, scoredCount: 1, pendingCount: 1, invalidatedCount: 0, latestSubmittedAt: '2026-09-01T08:00:00Z', latestTestStartedAt: '2026-09-01T02:03:00Z', earliestTestStartedAt: '2026-08-30T02:03:00Z', completedCount: 1, runningCount: 1, endedCount: 0, otherCount: 0 },
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
const savedAnswers = { attemptId: 'attempt-2', examTitle: 'Practice Test 06', versionNumber: 12, studentId: 'S2', studentName: 'Student X', cohortName: 'Morning', status: 'running', protocolVersion: 2, responseRevision: 4, savedAnswerCount: 1, lastSavedAt: '2026-09-01T08:05:00Z', questions: [
  { questionId: 'q1', sectionKey: 'reading-writing', moduleKey: 'module-1', displayOrder: 1, response: 'B', markedForReview: false },
  { questionId: 'q2', sectionKey: 'reading-writing', moduleKey: 'module-1', displayOrder: 2, response: null, markedForReview: false },
] };

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
    downloadSatRawdataXlsxMock.mockResolvedValue(undefined);
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
      data: savedAnswers, isLoading: false, error: null, isFetching: false, dataUpdatedAt: Date.UTC(2026, 8, 1, 8, 6), refetch: vi.fn(),
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

  it('exports the RAWDATA workbook for the selected Student Access group', async () => {
    renderResultsRoute('/sat/results?exam=sat-1&access=schedule-1');
    expect(screen.getByText('All attempts in this room; filters do not affect export.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Download room responses/ }));
    await waitFor(() => expect(downloadSatRawdataXlsxMock).toHaveBeenCalledWith('sat-1', 'schedule-1', 'Saturday 9 AM'));
  });

  it('surfaces a failed RAWDATA export and offers the button again', async () => {
    downloadSatRawdataXlsxMock.mockRejectedValue(new Error('Export failed: 500'));
    renderResultsRoute('/sat/results?exam=sat-1&access=schedule-1');
    fireEvent.click(screen.getByRole('button', { name: /Download room responses/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Export failed: 500');
    await waitFor(() => expect(screen.getByRole('button', { name: /Download room responses/ })).toBeEnabled());
  });

  it('blocks a second RAWDATA export while the first is still running', async () => {
    let finishExport: () => void = () => undefined;
    downloadSatRawdataXlsxMock.mockImplementation(
      () => new Promise<void>((resolve) => { finishExport = resolve; }),
    );
    renderResultsRoute('/sat/results?exam=sat-1&access=schedule-1');

    fireEvent.click(screen.getByRole('button', { name: /Download room responses/ }));

    const pendingButton = await screen.findByRole('button', { name: /Exporting/ });
    expect(pendingButton).toBeDisabled();
    fireEvent.click(pendingButton);
    expect(downloadSatRawdataXlsxMock).toHaveBeenCalledTimes(1);

    finishExport();
    await waitFor(() => expect(screen.getByRole('button', { name: /Download room responses/ })).toBeEnabled());
  });

  it('only offers the RAWDATA export inside a Student Access group', () => {
    renderResultsRoute('/sat/results?exam=sat-1');
    expect(screen.queryByRole('button', { name: /Download room responses/ })).not.toBeInTheDocument();
  });

  it('keeps attempts inside their schedule and opens a result beside the list, with the full page one link away', async () => {
    renderResultsRoute('/sat/results?exam=sat-1&access=schedule-1');
    expect(screen.getByText('John Smith')).toBeInTheDocument();
    expect(screen.getByText('Student X')).toBeInTheDocument();
    expect(screen.queryByText('Older Student')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /John Smith/ }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/results?exam=sat-1&access=schedule-1&attempt=attempt-1');
    const dialog = await screen.findByRole('dialog', { name: 'Student response' });
    fireEvent.click(within(dialog).getByRole('link', { name: /Open as page/ }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/results/result-1');
    expect(screen.getByRole('heading', { name: 'John Smith' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to SAT results' }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/results?exam=sat-1&access=schedule-1');
  });

  it('shows Pending or Unavailable in the Total column instead of a zero', () => {
    useSatAttemptsQueryMock.mockReturnValue({
      data: { items: [pageOne.items[0], pageOne.items[1], { ...pageOne.items[1], attemptId: 'attempt-3', studentName: 'Student Y', attemptStatus: 'ended', outcomeStatus: 'unscored' }], total: 3, offset: 0, limit: 50, hasMore: false },
      isLoading: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    renderResultsRoute('/sat/results?exam=sat-1&access=schedule-1');
    expect(within(screen.getByRole('button', { name: /John Smith/ })).getByText('1380')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /Student X/ })).getByText('Pending')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /Student Y/ })).getByText('Unavailable')).toBeInTheDocument();
  });

  it('steps to the previous and next student inside the inspector', async () => {
    renderResultsRoute('/sat/results?exam=sat-1&access=schedule-1&attempt=attempt-1');
    const dialog = await screen.findByRole('dialog', { name: 'Student response' });
    expect(within(dialog).getByText(/Student 1 of 2 on this page/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Previous student' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next student' }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('attempt=attempt-2');
    const next = await screen.findByRole('dialog', { name: 'Student response' });
    expect(within(next).getByText(/Student X · Student 2 of 2/)).toBeInTheDocument();
    expect(within(next).getByRole('button', { name: 'Next student' })).toBeDisabled();
    expect(within(next).getByText('1 server-saved answers')).toBeInTheDocument();
  });

  it('returns focus to the last inspected row when the inspector closes', async () => {
    renderResultsRoute('/sat/results?exam=sat-1&access=schedule-1&attempt=attempt-1');
    const dialog = await screen.findByRole('dialog', { name: 'Student response' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next student' }));
    const next = await screen.findByRole('dialog', { name: 'Student response' });
    fireEvent.keyDown(next, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Student response' })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: /Student X/ })).toHaveFocus());
  });

  it('opens server-saved answers for an attempt without a score', async () => {
    renderResultsRoute('/sat/results?exam=sat-1&access=schedule-1');
    const row = screen.getByText('Student X').closest('button');
    expect(row).toBeEnabled();
    fireEvent.click(row as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Student response' });
    expect(within(dialog).getByRole('link', { name: /Open as page/ })).toHaveAttribute('href', '/sat/results/attempts/attempt-2');
    fireEvent.click(within(dialog).getByRole('link', { name: /Open as page/ }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/results/attempts/attempt-2');
    expect(screen.getByText('1 server-saved answers')).toBeInTheDocument();
    expect(screen.getByText(/Revision 4/)).toBeInTheDocument();
    expect(screen.getByText(/Checks automatically every 15 seconds while visible/)).toHaveTextContent('Last checked');
    expect(screen.getByRole('heading', { name: 'Question-level responses (2)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Reading & Writing' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Reading & Writing question responses' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Student raw' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Key' })).toBeInTheDocument();
    expect(screen.getAllByText('Not scored')).toHaveLength(2);
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('Unanswered')).toBeInTheDocument();
    expect(screen.queryByText('Correct answer')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Only incorrect')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search questions' }), { target: { value: 'q1' } });
    expect(screen.getByText('1 of 2 shown')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to SAT results' }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/results?exam=sat-1&access=schedule-1');
  });

  it('opens attempt answers when a pending result row exists', async () => {
    useSatAttemptsQueryMock.mockReturnValue({
      data: { ...pageOne, items: [{ ...pageOne.items[1], resultId: 'pending-result', outcomeStatus: 'pending', attemptStatus: 'submitted' }] },
      isLoading: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    renderResultsRoute('/sat/results?exam=sat-1&access=schedule-1');
    fireEvent.click(screen.getByRole('button', { name: /Student X/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Student response' });
    expect(within(dialog).getByRole('link', { name: /Open as page/ })).toHaveAttribute('href', '/sat/results/attempts/attempt-2');
  });

  it('links a directly opened pending result to its saved answers', () => {
    useSatResultQueryMock.mockReturnValueOnce({
      data: { summary: { id: 'pending-result', attemptId: 'attempt-2', outcomeStatus: 'pending', releaseStatus: 'pending', totalScore: null, scheduleId: 'schedule-1', examId: 'sat-1', examTitle: 'Practice Test 06', versionNumber: 12, studentId: 'S2', studentName: 'Student X', cohortName: 'Morning', submittedAt: '2026-09-01T08:00:00Z' }, scorePayload: {}, sections: [], questions: [] },
      isLoading: false, error: null, isFetching: false, refetch: vi.fn(),
    });
    renderResultsRoute('/sat/results/pending-result');
    fireEvent.click(screen.getByRole('link', { name: 'View saved answers' }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/results/attempts/attempt-2');
    expect(screen.getByRole('heading', { name: 'Question-level responses (2)' })).toBeInTheDocument();
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

  it('keeps the last successful answers visible when an automatic check fails', () => {
    useSatAttemptAnswersQueryMock.mockReturnValueOnce({ data: savedAnswers, isLoading: false, error: new Error('offline'), isFetching: false, dataUpdatedAt: Date.UTC(2026, 8, 1, 8, 6), refetch: vi.fn() });
    renderResultsRoute('/sat/results/attempts/attempt-2');
    expect(screen.getByText('1 server-saved answers')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not check for newer answers');
    expect(screen.getByRole('button', { name: 'Check now' })).toBeEnabled();
  });

  it('paginates through older attempts rather than truncating the schedule', () => {
    renderResultsRoute('/sat/results?exam=sat-1&access=schedule-1');
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(useSatAttemptsQueryMock).toHaveBeenLastCalledWith('sat-1', 'schedule-1', 50, '', 'all', { status: 'all' });
    expect(screen.getByText('Older Student')).toBeInTheDocument();
  });

  it('keeps deleted-link fallback and versions on schedule groups', () => {
    renderResultsRoute('/sat/results?exam=sat-1');
    expect(screen.getByText('1 completed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Previous Student Access/ })).toBeInTheDocument();
  });

  it('flags an access group used on several days and shows its test start', () => {
    renderResultsRoute('/sat/results?exam=sat-1');
    expect(screen.getByText(/Multiple test dates/)).toBeInTheDocument();
    expect(screen.getAllByText('Test time unavailable').length).toBeGreaterThan(0);
  });

  it('restores status, date range and page from the URL and resets the page on a filter change', () => {
    renderResultsRoute('/sat/results?exam=sat-1&access=schedule-1&status=running&from=2026-09-01&offset=50');
    expect(useSatAttemptsQueryMock).toHaveBeenLastCalledWith('sat-1', 'schedule-1', 50, '', 'all', expect.objectContaining({ status: 'running', from: expect.any(String) }));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'ended' } });
    expect(useSatAttemptsQueryMock).toHaveBeenLastCalledWith('sat-1', 'schedule-1', 0, '', 'all', expect.objectContaining({ status: 'ended' }));
  });
});

describe('SAT Responses tab (exam-scoped results content)', () => {
  function renderResponses(initialEntry = '/sat/exams/sat-1/responses', lockedExamId = 'sat-1') {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        <Routes>
          <Route path="/sat/exams/:examId/responses" element={<SatResultsContent lockedExamId={lockedExamId} basePath={`/sat/exams/${lockedExamId}/responses`} emptyState={<p>No responses yet for this exam</p>} />} />
          <Route path="/sat/results/attempts/:attemptId" element={<SatAttemptAnswersRoute />} />
          <Route path="/sat/results/:resultId" element={<SatResultDetailRoute />} />
        </Routes>
      </MemoryRouter>,
    );
  }
  beforeEach(() => {
    vi.clearAllMocks();
    useSatResultsQueryMock.mockReturnValue({ data: accessGroups, isLoading: false, error: null, isFetching: false, refetch: vi.fn() });
    useSatAttemptsQueryMock.mockImplementation((_examId: string, scheduleId: string, offset: number) => ({
      data: scheduleId === 'schedule-1' ? (offset === 0 ? pageOne : pageTwo) : { items: [], total: 0, offset, limit: 50, hasMore: false },
      isLoading: false, error: null, isFetching: false, refetch: vi.fn(),
    }));
    useSatResultQueryMock.mockReturnValue({ data: undefined, isLoading: true, error: null, isFetching: false, refetch: vi.fn() });
    useSatAttemptAnswersQueryMock.mockReturnValue({ data: savedAnswers, isLoading: false, error: null, isFetching: false, dataUpdatedAt: Date.UTC(2026, 8, 1, 8, 6), refetch: vi.fn() });
  });

  it('opens straight to the access groups of this exam without an exam list', () => {
    renderResponses();
    expect(screen.getByRole('button', { name: /Saturday 9 AM/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Previous Student Access/ })).toBeInTheDocument();
    // Another exam's group is never shown, and there is no way back to the global list from here.
    expect(screen.queryByRole('button', { name: /Monday Makeup/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to SAT results' })).not.toBeInTheDocument();
  });

  it('keeps drill-down inside the tab and ignores a conflicting ?exam= param', () => {
    renderResponses('/sat/exams/sat-1/responses?exam=sat-2');
    fireEvent.click(screen.getByRole('button', { name: /Saturday 9 AM/ }));
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/exams/sat-1/responses?access=schedule-1');
    expect(useSatAttemptsQueryMock).toHaveBeenLastCalledWith('sat-1', 'schedule-1', 0, '', 'all', { status: 'all' });
  });

  it('opens a student response beside the list without leaving the tab, then closes back to the same filters', async () => {
    renderResponses('/sat/exams/sat-1/responses?access=schedule-1&status=running');
    fireEvent.click(screen.getByRole('button', { name: /Student X/ }));
    // Still on the Responses tab; the response is a URL-backed sheet.
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/exams/sat-1/responses?access=schedule-1&status=running&attempt=attempt-2');
    const dialog = await screen.findByRole('dialog', { name: 'Student response' });
    expect(within(dialog).getByText('1 server-saved answers')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Open as page/ })).toHaveAttribute('href', '/sat/results/attempts/attempt-2');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Student response' })).not.toBeInTheDocument());
    expect(screen.getByTestId('test-location')).toHaveTextContent('/sat/exams/sat-1/responses?access=schedule-1&status=running');
    expect(screen.getByTestId('test-location')).not.toHaveTextContent('attempt=');
  });

  it('restores an open student response from the URL after a refresh', async () => {
    renderResponses('/sat/exams/sat-1/responses?access=schedule-1&attempt=attempt-2');
    expect(await screen.findByRole('dialog', { name: 'Student response' })).toBeInTheDocument();
  });

  it('shows applied filters as removable chips and clears them together', () => {
    renderResponses('/sat/exams/sat-1/responses?access=schedule-1&status=running&q=Student');
    const chips = within(screen.getByRole('list', { name: 'Active filters' }));
    expect(chips.getByRole('button', { name: 'Remove filter Status: In progress' })).toBeInTheDocument();
    fireEvent.click(chips.getByRole('button', { name: 'Remove filter Search: Student' }));
    expect(screen.getByTestId('test-location')).not.toHaveTextContent('q=Student');
    expect(screen.getByTestId('test-location')).toHaveTextContent('status=running');
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.getByTestId('test-location')).not.toHaveTextContent('status=');
    expect(screen.queryByRole('list', { name: 'Active filters' })).not.toBeInTheDocument();
  });

  it('shows the supplied empty state when the exam has no responses yet', () => {
    renderResponses('/sat/exams/sat-9/responses', 'sat-9');
    expect(screen.getByText('No responses yet for this exam')).toBeInTheDocument();
  });
});
