import React from 'react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { GradingSessionList } from '../GradingSessionList';
import { gradingService } from '../../../features/grading/infrastructure/gradingGateway';
import { seedDevelopmentFixtures } from '../../../features/exam-authoring/infrastructure/examAuthoringGateway';
import { downloadCsv } from '../../../utils/csvExport';
import type { GradingSession } from '../../../types/grading';

vi.mock('../../../features/grading/infrastructure/gradingGateway', () => ({
  gradingService: {
    getSessionQueuePage: vi.fn(),
    getSessionQueueSummary: vi.fn(),
    getSessionQueue: vi.fn(),
  },
}));

vi.mock('../../../features/exam-authoring/infrastructure/examAuthoringGateway', () => ({
  seedDevelopmentFixtures: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../utils/csvExport', () => ({
  downloadCsv: vi.fn(),
}));

const sessionA: GradingSession = {
  id: 'session-a',
  scheduleId: 'schedule-a',
  examId: 'exam-a',
  examTitle: 'IELTS Academic Mock 1',
  publishedVersionId: 'version-a',
  cohortName: 'Cohort A',
  institution: 'Test Institute',
  startTime: '2026-04-28T08:00:00.000Z',
  endTime: '2026-04-28T11:00:00.000Z',
  status: 'live',
  totalStudents: 20,
  submittedCount: 18,
  pendingManualReviews: 5,
  inProgressReviews: 3,
  finalizedReviews: 10,
  overdueReviews: 2,
  assignedTeachers: ['teacher-1'],
  createdAt: '2026-04-28T08:00:00.000Z',
  createdBy: 'admin-1',
  updatedAt: '2026-04-28T11:00:00.000Z',
};

const sessionB: GradingSession = {
  id: 'session-b',
  scheduleId: 'schedule-b',
  examId: 'exam-b',
  examTitle: 'IELTS General Mock 2',
  publishedVersionId: 'version-b',
  cohortName: 'Cohort B',
  startTime: '2026-05-02T08:00:00.000Z',
  endTime: '2026-05-02T11:00:00.000Z',
  status: 'scheduled',
  totalStudents: 15,
  submittedCount: 0,
  pendingManualReviews: 0,
  inProgressReviews: 0,
  finalizedReviews: 0,
  overdueReviews: 0,
  assignedTeachers: [],
  createdAt: '2026-05-02T08:00:00.000Z',
  createdBy: 'admin-1',
  updatedAt: '2026-05-02T08:00:00.000Z',
};

const defaultSummary = {
  totalSessions: 2,
  totalStudents: 35,
  pendingManualReviews: 5,
  inProgressReviews: 3,
  finalizedReviews: 10,
  overdueReviews: 2,
};

function mockQueuePage(
  sessions: GradingSession[] = [sessionA, sessionB],
  pagination = { page: 1, pageSize: 10, total: 2, hasMore: false },
) {
  vi.mocked(gradingService.getSessionQueuePage).mockResolvedValue({
    success: true,
    data: { sessions, pagination },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(seedDevelopmentFixtures).mockResolvedValue(undefined);
  vi.mocked(gradingService.getSessionQueueSummary).mockResolvedValue({
    success: true,
    data: { ...defaultSummary },
  });
  vi.mocked(gradingService.getSessionQueue).mockResolvedValue({
    success: true,
    data: [sessionA, sessionB],
  });
  vi.mocked(downloadCsv).mockImplementation(() => undefined);
  mockQueuePage();
});

describe('GradingSessionList', () => {
  test('renders a small fake session list with key details', async () => {
    render(<GradingSessionList onSessionSelect={vi.fn()} />);

    expect(await screen.findByText('IELTS Academic Mock 1')).toBeInTheDocument();
    expect(screen.getByText('IELTS General Mock 2')).toBeInTheDocument();
    expect(screen.getByText('Cohort A')).toBeInTheDocument();
    expect(screen.getByText('Cohort B')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    // Pagination range for a 2-item queue.
    expect(screen.getByText(/Showing/)).toBeInTheDocument();
    expect(screen.getByText(/across exams and cohorts/)).toBeInTheDocument();
    // Row-level action per session.
    expect(
      screen.getByRole('button', { name: 'Open grading session for IELTS Academic Mock 1' }),
    ).toBeInTheDocument();
    // Summary stats resolve from the summary endpoint.
    await waitFor(() =>
      expect(gradingService.getSessionQueueSummary).toHaveBeenCalled(),
    );
  });

  test('notifies onSessionSelect with the session id when View is clicked', async () => {
    const onSessionSelect = vi.fn();
    render(<GradingSessionList onSessionSelect={onSessionSelect} />);

    const viewButton = await screen.findByRole('button', {
      name: 'Open grading session for IELTS Academic Mock 1',
    });
    fireEvent.click(viewButton);

    expect(onSessionSelect).toHaveBeenCalledTimes(1);
    expect(onSessionSelect).toHaveBeenCalledWith('session-a');
  });

  test('debounces the search filter and queries the service', async () => {
    render(<GradingSessionList onSessionSelect={vi.fn()} />);
    await screen.findByText('IELTS Academic Mock 1');

    const search = screen.getByLabelText('Search sessions by exam or cohort');
    fireEvent.change(search, { target: { value: 'Academic' } });

    await waitFor(
      () =>
        expect(gradingService.getSessionQueuePage).toHaveBeenCalledWith({
          page: 1,
          pageSize: 10,
          searchQuery: 'Academic',
        }),
      { timeout: 3000 },
    );
  });

  test('clears an active search via the Clear search button', async () => {
    render(<GradingSessionList onSessionSelect={vi.fn()} />);
    await screen.findByText('IELTS Academic Mock 1');

    fireEvent.change(screen.getByLabelText('Search sessions by exam or cohort'), {
      target: { value: 'Academic' },
    });
    const clearButton = await screen.findByRole('button', { name: 'Clear search' });
    fireEvent.click(clearButton);

    await waitFor(
      () =>
        expect(gradingService.getSessionQueuePage).toHaveBeenCalledWith({
          page: 1,
          pageSize: 10,
          searchQuery: '',
        }),
      { timeout: 3000 },
    );
    expect(
      screen.getByLabelText('Search sessions by exam or cohort'),
    ).toHaveValue('');
  });

  test('changes page size via the Rows select', async () => {
    vi.mocked(gradingService.getSessionQueuePage).mockImplementation((options) =>
      Promise.resolve({
        success: true,
        data: {
          sessions: [sessionA, sessionB],
          pagination: {
            page: options?.page ?? 1,
            pageSize: options?.pageSize ?? 10,
            total: 2,
            hasMore: false,
          },
        },
      }),
    );
    render(<GradingSessionList onSessionSelect={vi.fn()} />);
    await screen.findByText('IELTS Academic Mock 1');

    fireEvent.change(screen.getByLabelText('Rows'), { target: { value: '25' } });

    await waitFor(() =>
      expect(gradingService.getSessionQueuePage).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 25, page: 1 }),
      ),
    );
  });

  test('navigates to the next page when more results exist', async () => {
    vi.mocked(gradingService.getSessionQueuePage).mockImplementation((options) => {
      const page = options?.page ?? 1;
      return Promise.resolve({
        success: true,
        data: {
          sessions: [sessionA, sessionB],
          pagination: { page, pageSize: 10, total: 25, hasMore: page < 3 },
        },
      });
    });
    render(<GradingSessionList onSessionSelect={vi.fn()} />);
    await screen.findByText('IELTS Academic Mock 1');

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    await waitFor(() =>
      expect(gradingService.getSessionQueuePage).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2 }),
      ),
    );
    expect(await screen.findByRole('button', { name: 'Page 2' })).toBeInTheDocument();
  });

  test('renders the empty state when the queue is empty', async () => {
    mockQueuePage([], { page: 1, pageSize: 10, total: 0, hasMore: false });
    render(<GradingSessionList onSessionSelect={vi.fn()} />);

    expect(await screen.findByText('No grading sessions found')).toBeInTheDocument();
    expect(screen.getByText('Create exam schedules to start grading')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  test('renders the no-match empty state while a search is active', async () => {
    mockQueuePage([], { page: 1, pageSize: 10, total: 0, hasMore: false });
    render(<GradingSessionList onSessionSelect={vi.fn()} />);
    // With no search text the generic empty state shows first.
    await screen.findByText('No grading sessions found');

    // Typing a query flips the empty state to the no-match variant after debounce.
    fireEvent.change(screen.getByLabelText('Search sessions by exam or cohort'), {
      target: { value: 'zzz-no-match' },
    });
    expect(await screen.findByText('No matching sessions', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('Try a different exam name or cohort.')).toBeInTheDocument();
    // Two "Clear search" buttons exist: the search-input X and the empty-state action.
    const emptyClears = await screen.findAllByRole('button', { name: 'Clear search' });
    expect(emptyClears.length).toBeGreaterThanOrEqual(2);
  });

  test('renders a loading skeleton while the page request is pending', () => {
    vi.mocked(gradingService.getSessionQueuePage).mockReturnValue(new Promise(() => {}));
    const { container } = render(<GradingSessionList onSessionSelect={vi.fn()} />);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.getByLabelText('Search sessions by exam or cohort')).toBeInTheDocument();
    expect(screen.queryByText('No grading sessions found')).not.toBeInTheDocument();
  });

  test('surfaces load errors with a working Retry action', async () => {
    vi.mocked(gradingService.getSessionQueuePage).mockResolvedValue({
      success: false,
      error: 'Failed to load grading sessions.',
    });
    render(<GradingSessionList onSessionSelect={vi.fn()} />);

    expect(await screen.findByText('Failed to load grading sessions.')).toBeInTheDocument();
    const callsBefore = vi.mocked(gradingService.getSessionQueuePage).mock.calls.length;

    // Next attempt succeeds so Retry visibly recovers the list.
    mockQueuePage();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() =>
      expect(gradingService.getSessionQueuePage.mock.calls.length).toBeGreaterThan(callsBefore),
    );
    expect(await screen.findByText('IELTS Academic Mock 1')).toBeInTheDocument();
  });

  test('exports the full queue to CSV', async () => {
    render(<GradingSessionList onSessionSelect={vi.fn()} />);
    await screen.findByText('IELTS Academic Mock 1');

    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));

    await waitFor(() => expect(gradingService.getSessionQueue).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledTimes(1));
    const [filename, headers, rows] = vi.mocked(downloadCsv).mock.calls[0] as [
      string,
      string[],
      Array<Array<unknown>>,
    ];
    expect(filename).toMatch(/^grading-sessions-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(headers).toContain('Session ID');
    expect(rows).toHaveLength(2);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3); // header + 2 sessions
  });
});
