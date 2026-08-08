import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SectionSubmission } from '../../../types/grading';
import { ExamObjectiveOverviewPanel } from '../ExamObjectiveOverviewPanel';
import { buildExamObjectiveOverviewRows } from '../examObjectiveOverviewUtils';
import { gradingRepository } from '../../../services/gradingRepository';
import { gradingService } from '../../../services/gradingService';

vi.mock('../../../services/gradingRepository', () => ({
  gradingRepository: {
    getSubmissionsBySession: vi.fn(),
    getSectionSubmissionsBySubmissionId: vi.fn(),
  },
}));

vi.mock('../../../services/gradingService', () => ({
  gradingService: {
    overrideObjectiveQuestion: vi.fn(),
  },
}));

describe('buildExamObjectiveOverviewRows', () => {
  test('marks case-mismatched text answers correct in the exam overview', () => {
    const section = {
      id: 'section-1',
      submissionId: 'submission-1',
      section: 'reading',
      answers: { type: 'reading', passages: [] },
      autoGradingResults: {
        generatedAt: '2026-01-01T00:00:00.000Z',
        totalScore: 0,
        maxScore: 1,
        percentage: 0,
        questionResults: [{
          questionId: 'q-1',
          studentAnswer: 'ANSWER',
          correctAnswer: 'Answer',
          isCorrect: false,
          awardedScore: 0,
          maxScore: 1,
          scoringRule: 'one_word',
          hasOverride: false,
        }],
      },
      gradingStatus: 'auto_graded',
      submittedAt: '2026-01-01T00:00:00.000Z',
    } satisfies SectionSubmission;

    const rows = buildExamObjectiveOverviewRows([{
      submission: { id: 'submission-1', studentName: 'Narin Example' },
      sections: [section],
    }]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.isCorrect).toBe(true);
    expect(rows[0]?.awardedScore).toBe(1);
  });

  test('keeps an explicit manual override over the computed text result', () => {
    const section = {
      id: 'section-1',
      submissionId: 'submission-1',
      section: 'reading',
      answers: { type: 'reading', passages: [] },
      autoGradingResults: {
        generatedAt: '2026-01-01T00:00:00.000Z',
        totalScore: 0,
        maxScore: 1,
        percentage: 0,
        questionResults: [{
          questionId: 'q-1',
          studentAnswer: 'ANSWER',
          correctAnswer: 'Answer',
          isCorrect: true,
          awardedScore: 1,
          maxScore: 1,
          scoringRule: 'one_word',
          hasOverride: true,
          manualOverride: {
            isCorrect: false,
            awardedScore: 0,
            overriddenBy: 'teacher-1',
            overriddenAt: '2026-01-01T00:00:00.000Z',
            reason: 'Manual review',
          },
        }],
      },
      gradingStatus: 'in_review',
      submittedAt: '2026-01-01T00:00:00.000Z',
    } satisfies SectionSubmission;

    const rows = buildExamObjectiveOverviewRows([{
      submission: { id: 'submission-1', studentName: 'Narin Example' },
      sections: [section],
    }]);

    expect(rows[0]?.isCorrect).toBe(false);
    expect(rows[0]?.awardedScore).toBe(0);
    expect(rows[0]?.manualOverride?.overriddenBy).toBe('teacher-1');
  });

  test('renders all-student rows and sends an override from the exam overview', async () => {
    const section = {
      id: 'section-1',
      submissionId: 'submission-1',
      section: 'reading',
      answers: { type: 'reading', passages: [] },
      autoGradingResults: {
        generatedAt: '2026-01-01T00:00:00.000Z',
        totalScore: 1,
        maxScore: 1,
        percentage: 100,
        questionResults: [{
          questionId: 'q-1',
          studentAnswer: 'ANSWER',
          correctAnswer: 'Answer',
          isCorrect: true,
          awardedScore: 1,
          maxScore: 1,
          scoringRule: 'one_word',
          hasOverride: false,
        }],
      },
      gradingStatus: 'auto_graded',
      submittedAt: '2026-01-01T00:00:00.000Z',
    } satisfies SectionSubmission;

    vi.mocked(gradingRepository.getSubmissionsBySession).mockResolvedValue([
      { id: 'submission-1', studentName: 'Narin Example' } as never,
    ]);
    vi.mocked(gradingRepository.getSectionSubmissionsBySubmissionId).mockResolvedValue([section]);
    vi.mocked(gradingService.overrideObjectiveQuestion).mockResolvedValue({
      success: true,
      data: section,
    });

    render(
      <ExamObjectiveOverviewPanel
        session={{ examTitle: 'IELTS Mock Test', id: 'session-1' } as never}
      />,
    );

    expect(await screen.findByText('Narin Example')).toBeInTheDocument();
    expect(screen.getByText('ANSWER')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Incorrect' }));

    await waitFor(() => expect(gradingService.overrideObjectiveQuestion).toHaveBeenCalledWith(
      'submission-1',
      'reading',
      'q-1',
      expect.objectContaining({ isCorrect: false }),
    ));
  });
});
