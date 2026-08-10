import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { gradingService } from '../../../services/gradingService';
import { ObjectiveIntegrityOverviewPanel } from '../ObjectiveIntegrityOverviewPanel';
import type { ObjectiveIntegrityOverview } from '../../../types/grading';

vi.mock('../../../services/gradingService', () => ({
  gradingService: {
    getObjectiveIntegrityOverview: vi.fn(),
  },
}));

function overview(
  overrides: Partial<ObjectiveIntegrityOverview> = {},
): ObjectiveIntegrityOverview {
  return {
    studentCount: 2,
    expectedAnswerCount: 4,
    verifiedCorrectCount: 2,
    verifiedIncorrectCount: 1,
    verifiedUnansweredCount: 1,
    needsRecheckCount: 0,
    invalidCount: 0,
    integrityStatus: 'verified',
    issues: [],
    ...overrides,
  };
}

describe('ObjectiveIntegrityOverviewPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders verified counts from the backend integrity status', async () => {
    vi.mocked(gradingService.getObjectiveIntegrityOverview).mockResolvedValue({
      success: true,
      data: overview(),
    });

    render(<ObjectiveIntegrityOverviewPanel scheduleId="schedule-1" />);

    await waitFor(() => expect(gradingService.getObjectiveIntegrityOverview)
      .toHaveBeenCalledWith('schedule-1'));
    expect(await screen.findByText('All objective answers are verified')).toBeInTheDocument();
    expect(screen.getByText('4 expected')).toBeInTheDocument();
    expect(screen.getByText('2 correct')).toBeInTheDocument();
    expect(screen.getByText('1 incorrect')).toBeInTheDocument();
    expect(screen.getByText('1 unanswered')).toBeInTheDocument();
    expect(screen.queryByText('Needs recheck')).not.toBeInTheDocument();
  });

  test('never presents unresolved expected answers as verified', async () => {
    vi.mocked(gradingService.getObjectiveIntegrityOverview).mockResolvedValue({
      success: true,
      data: overview({
        verifiedCorrectCount: 1,
        verifiedIncorrectCount: 0,
        verifiedUnansweredCount: 0,
        needsRecheckCount: 1,
        integrityStatus: 'needs_recheck',
        issues: [{
          submissionId: 'submission-1',
          studentId: 'student-1',
          studentName: 'Narin Example',
          section: 'reading',
          questionId: 'q-2',
          questionNumber: '2',
          code: 'missing_answer_key',
        }],
      }),
    });

    render(<ObjectiveIntegrityOverviewPanel scheduleId="schedule-1" />);

    expect((await screen.findAllByText('Needs recheck')).length).toBe(2);
    expect(screen.getByText('1 expected answer still needs review.')).toBeInTheDocument();
    expect(screen.getByText('Missing answer key')).toBeInTheDocument();
    expect(screen.queryByText('All objective answers are verified')).not.toBeInTheDocument();
  });
});
