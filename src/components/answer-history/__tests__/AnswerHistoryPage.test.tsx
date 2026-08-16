import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnswerHistoryPage } from '../AnswerHistoryPage';

const mockOverviewHook = vi.fn();
const mockAttemptOverviewHook = vi.fn();
const mockDetailHook = vi.fn();
const mockAttemptDetailHook = vi.fn();
const mockExport = vi.fn();

vi.mock('../../../features/answer-history/api/answerHistoryQueries', () => ({
  useAnswerHistoryOverviewBySubmission: (...args: unknown[]) => mockOverviewHook(...args),
  useAnswerHistoryOverviewByAttempt: (...args: unknown[]) => mockAttemptOverviewHook(...args),
  useAnswerHistoryTargetDetail: (...args: unknown[]) => mockDetailHook(...args),
  useAnswerHistoryTargetDetailByAttempt: (...args: unknown[]) => mockAttemptDetailHook(...args),
  fetchAnswerHistoryExport: (...args: unknown[]) => mockExport(...args),
}));

vi.mock('@services/answerHistoryService', () => ({
  fetchAnswerHistoryExport: (...args: unknown[]) => mockExport(...args),
}));

const overviewFixture = {
  submissionId: 'sub-1',
  attemptId: 'attempt-1',
  scheduleId: 'sched-1',
  examId: 'exam-1',
  examTitle: 'IELTS Mock',
  candidateId: 'C10291',
  candidateName: 'Somchai',
  candidateEmail: 'somchai@example.com',
  startedAt: '2026-01-01T00:00:00.000Z',
  submittedAt: '2026-01-01T00:30:00.000Z',
  totalRevisions: 3,
  totalTargetsEdited: 1,
  sectionStats: [],
  signals: [],
  questionSummaries: [
    {
      targetId: 'Q18',
      label: 'Q18',
      module: 'listening',
      targetType: 'objective' as const,
      revisionCount: 3,
      answered: true,
      finalValue: ['environment', 'policy', 'government'],
    },
  ],
};

const detailFixture = {
  submissionId: 'sub-1',
  attemptId: 'attempt-1',
  scheduleId: 'sched-1',
  targetId: 'Q18',
  targetLabel: 'Q18',
  module: 'listening',
  targetType: 'objective' as const,
  finalState: ['environment', 'policy', 'government'],
  signals: [],
  replaySteps: [],
  checkpoints: [
    {
      id: 'cp-1',
      index: 1,
      mutationId: 'm1',
      mutationType: 'SetSlot',
      timestamp: '2026-01-01T00:01:00.000Z',
      clientTimestamp: '2026-01-01T00:01:00.000Z',
      serverReceivedAt: '2026-01-01T00:01:00.000Z',
      mutationSeq: 1,
      appliedRevision: 1,
      summary: 'Slot 1 updated',
      deltaChars: 8,
      stateSnapshot: ['environment', '', ''],
    },
    {
      id: 'cp-2',
      index: 2,
      mutationId: 'm2',
      mutationType: 'SetSlot',
      timestamp: '2026-01-01T00:02:00.000Z',
      clientTimestamp: '2026-01-01T00:02:00.000Z',
      serverReceivedAt: '2026-01-01T00:02:00.000Z',
      mutationSeq: 2,
      appliedRevision: 2,
      summary: 'Slot 2 updated',
      deltaChars: 6,
      stateSnapshot: ['environment', 'policy', ''],
    },
    {
      id: 'cp-3',
      index: 3,
      mutationId: 'm3',
      mutationType: 'SetSlot',
      timestamp: '2026-01-01T00:03:00.000Z',
      clientTimestamp: '2026-01-01T00:03:00.000Z',
      serverReceivedAt: '2026-01-01T00:03:00.000Z',
      mutationSeq: 3,
      appliedRevision: 3,
      summary: 'Slot 3 updated',
      deltaChars: 10,
      stateSnapshot: ['environment', 'policy', 'government'],
    },
  ],
  technicalLogs: [
    {
      mutationId: 'm3',
      mutationType: 'SetSlot',
      mutationSeq: 3,
      payload: { questionId: 'Q18', slotIndex: 2, value: 'government' },
      clientTimestamp: '2026-01-01T00:03:00.000Z',
      serverReceivedAt: '2026-01-01T00:03:00.000Z',
      appliedRevision: 3,
    },
  ],
};

describe('AnswerHistoryPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockOverviewHook.mockReturnValue({
      data: overviewFixture,
      isLoading: false,
      isError: false,
    });
    mockAttemptOverviewHook.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });
    mockDetailHook.mockReturnValue({
      data: detailFixture,
      isLoading: false,
      isError: false,
    });
    mockAttemptDetailHook.mockReturnValue({
      data: detailFixture,
      isLoading: false,
      isError: false,
    });
    mockExport.mockResolvedValue({
      format: 'csv',
      filename: 'answer-history.csv',
      contentType: 'text/csv',
      content: 'a,b',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockOverviewHook.mockReset();
    mockAttemptOverviewHook.mockReset();
    mockDetailHook.mockReset();
    mockAttemptDetailHook.mockReset();
    mockExport.mockReset();
  });

  it('supports replay stepping controls', () => {
    render(
      <AnswerHistoryPage
        submissionId="sub-1"
        headingPrefix="Grading"
        backLabel="Back"
        onBack={() => undefined}
      />,
    );

    expect(screen.getByText('Checkpoint 3 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Previous checkpoint/i }));
    expect(screen.getByText('Checkpoint 2 of 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Next checkpoint/i }));
    expect(screen.getByText('Checkpoint 3 of 3')).toBeInTheDocument();
  });

  it('plays replay forward and stops at last checkpoint', () => {
    render(
      <AnswerHistoryPage
        submissionId="sub-1"
        headingPrefix="Grading"
        backLabel="Back"
        onBack={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Previous checkpoint/i }));
    expect(screen.getByText('Checkpoint 2 of 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Toggle playback/i }));
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(screen.getByText('Checkpoint 3 of 3')).toBeInTheDocument();
  });

  it('downloads CSV export for selected target', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:answer-history');
    const revokeObjectURL = vi.fn();
    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.stubGlobal('URL', {
      createObjectURL,
      revokeObjectURL,
    });
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === 'a') {
        Object.defineProperty(element, 'click', {
          configurable: true,
          value: clickSpy,
        });
      }
      return element;
    });

    render(
      <AnswerHistoryPage
        submissionId="sub-1"
        headingPrefix="Grading"
        backLabel="Back"
        onBack={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /CSV/i }));
    await vi.waitFor(() => {
      expect(mockExport).toHaveBeenCalledWith(
        expect.objectContaining({
          submissionId: 'sub-1',
          targetId: 'Q18',
          targetType: 'objective',
          format: 'csv',
        }),
      );
    });
    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it('copies technical payload to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(
      <AnswerHistoryPage
        submissionId="sub-1"
        headingPrefix="Grading"
        backLabel="Back"
        onBack={() => undefined}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Copy payload m3/i }));
    });
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        JSON.stringify({ questionId: 'Q18', slotIndex: 2, value: 'government' }, null, 2),
      );
    });
  });

  it('renders unanswered targets and empty timeline states', () => {
    mockOverviewHook.mockReturnValue({
      data: {
        ...overviewFixture,
        questionSummaries: [
          {
            targetId: 'Q19',
            label: 'Q19',
            module: 'listening',
            targetType: 'objective' as const,
            revisionCount: 0,
            answered: false,
            finalValue: null,
          },
        ],
      },
      isLoading: false,
      isError: false,
    });
    mockDetailHook.mockReturnValue({
      data: {
        ...detailFixture,
        targetId: 'Q19',
        targetLabel: 'Q19',
        finalState: null,
        checkpoints: [],
        replaySteps: [],
        technicalLogs: [],
      },
      isLoading: false,
      isError: false,
    });

    render(
      <AnswerHistoryPage
        submissionId="sub-1"
        headingPrefix="Grading"
        backLabel="Back"
        onBack={() => undefined}
      />,
    );

    expect(screen.getAllByText('Unanswered').length).toBeGreaterThan(0);
    expect(screen.getByText('No checkpoints were recorded for this target.')).toBeInTheDocument();
    expect(screen.getByText('No technical logs available for this target.')).toBeInTheDocument();
  });

  it('preserves overview ordering and uses backend labels without showing raw ids in primary panels', () => {
    mockOverviewHook.mockReturnValue({
      data: {
        ...overviewFixture,
        questionSummaries: [
          {
            targetId: 'reading-q2',
            label: 'Question 2',
            module: 'reading',
            targetType: 'objective' as const,
            revisionCount: 1,
            answered: true,
            finalValue: 'r2',
          },
          {
            targetId: 'listening-q1',
            label: 'Question 1',
            module: 'listening',
            targetType: 'objective' as const,
            revisionCount: 1,
            answered: true,
            finalValue: 'l1',
          },
        ],
      },
      isLoading: false,
      isError: false,
    });
    mockDetailHook.mockReturnValue({
      data: {
        ...detailFixture,
        targetId: 'reading-q2',
        targetLabel: 'Question 2',
        module: 'reading',
      },
      isLoading: false,
      isError: false,
    });

    render(
      <AnswerHistoryPage
        submissionId="sub-1"
        headingPrefix="Grading"
        backLabel="Back"
        onBack={() => undefined}
      />,
    );

    const firstSectionHeader = screen.getAllByRole('heading', { level: 3 })[0];
    expect(firstSectionHeader).toHaveTextContent('reading');
    expect(screen.queryByText('reading-q2')).not.toBeInTheDocument();
    expect(screen.queryByText(/objective • reading • reading-q2/i)).not.toBeInTheDocument();
  });

  it('shows reconciliation badge state for flagged targets', () => {
    mockOverviewHook.mockReturnValue({
      data: {
        ...overviewFixture,
        signals: [
          {
            signalType: 'AUTO_RECONCILED',
            severity: 'medium',
            message: 'Automatic reconciliation applied.',
            evidence: {
              targetId: 'Q18',
            },
          },
        ],
      },
      isLoading: false,
      isError: false,
    });

    render(
      <AnswerHistoryPage
        submissionId="sub-1"
        headingPrefix="Grading"
        backLabel="Back"
        onBack={() => undefined}
      />,
    );

    expect(screen.getAllByText('Auto reconciled').length).toBeGreaterThan(0);
  });

  it('shows in-progress empty state when attempt overview is not yet available', () => {
    mockAttemptOverviewHook.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
    });
    mockDetailHook.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });
    mockAttemptDetailHook.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });

    render(
      <AnswerHistoryPage
        attemptId="attempt-1"
        headingPrefix="Proctor"
        backLabel="Back"
        onBack={() => undefined}
      />,
    );

    expect(
      screen.getByText('No answer history is available yet for this in-progress attempt.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Failed to load answer history data.')).not.toBeInTheDocument();
  });

  it('renders checkpoints from attempt-scoped detail when submission is not created yet', () => {
    mockOverviewHook.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });
    mockAttemptOverviewHook.mockReturnValue({
      data: {
        ...overviewFixture,
        submissionId: null,
      },
      isLoading: false,
      isError: false,
    });
    mockAttemptDetailHook.mockReturnValue({
      data: detailFixture,
      isLoading: false,
      isError: false,
    });

    render(
      <AnswerHistoryPage
        attemptId="attempt-1"
        headingPrefix="Proctor"
        backLabel="Back"
        onBack={() => undefined}
      />,
    );

    expect(screen.getByText('Checkpoint 3 of 3')).toBeInTheDocument();
    expect(
      screen.queryByText('No answer history is available yet for this in-progress attempt.'),
    ).not.toBeInTheDocument();
  });
});
