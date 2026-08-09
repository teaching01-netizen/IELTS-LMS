import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInitialExamState } from '../../../services/examAdapterService';
import type { SectionSubmission } from '../../../types/grading';
import { ExamObjectiveOverviewPanel } from '../ExamObjectiveOverviewPanel';
import { buildExamObjectiveOverviewRows } from '../examObjectiveOverviewUtils';
import { examRepository } from '../../../services/examRepository';
import { gradingRepository } from '../../../services/gradingRepository';
import { gradingService } from '../../../services/gradingService';
import { notifyObjectiveGradingUpdated } from '../../../utils/objectiveGradingSync';

vi.mock('../../../services/gradingRepository', () => ({
  gradingRepository: {
    getSubmissionsBySession: vi.fn(),
    getSectionSubmissionsBySubmissionId: vi.fn(),
  },
}));

vi.mock('../../../services/examRepository', () => ({
  examRepository: {
    getVersionById: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../../services/gradingService', () => ({
  gradingService: {
    overrideObjectiveQuestion: vi.fn(),
    getObjectiveGradingSource: vi.fn(),
  },
}));

describe('buildExamObjectiveOverviewRows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns only typed answers with case-or-whitespace-only differences', () => {
    const section = {
      id: 'section-1',
      submissionId: 'submission-1',
      section: 'reading',
      answers: { type: 'reading', passages: [] },
      autoGradingResults: {
        generatedAt: '2026-01-01T00:00:00.000Z',
        totalScore: 1,
        maxScore: 6,
        percentage: 16.67,
        questionResults: [
          {
            questionId: 'q-case',
            studentAnswer: 'ANSWER',
            correctAnswer: 'Answer',
            isCorrect: false,
            awardedScore: 0,
            maxScore: 1,
            scoringRule: 'one_word',
            hasOverride: false,
          },
          {
            questionId: 'q-space',
            studentAnswer: '  New   York ',
            correctAnswer: 'new york',
            isCorrect: false,
            awardedScore: 0,
            maxScore: 1,
            scoringRule: 'exact_match',
            hasOverride: false,
          },
          {
            questionId: 'q-exact',
            studentAnswer: 'same',
            correctAnswer: 'same',
            isCorrect: true,
            awardedScore: 1,
            maxScore: 1,
            scoringRule: 'one_word',
            hasOverride: false,
          },
          {
            questionId: 'q-wrong',
            studentAnswer: 'different',
            correctAnswer: 'answer',
            isCorrect: false,
            awardedScore: 0,
            maxScore: 1,
            scoringRule: 'one_word',
            hasOverride: false,
          },
          {
            questionId: 'q-choice',
            studentAnswer: 'OPTION_A',
            correctAnswer: 'option_a',
            isCorrect: false,
            awardedScore: 0,
            maxScore: 1,
            scoringRule: 'single_choice',
            hasOverride: false,
          },
          {
            questionId: 'q-punctuation',
            studentAnswer: 'half-way',
            correctAnswer: 'half way',
            isCorrect: false,
            awardedScore: 0,
            maxScore: 1,
            scoringRule: 'one_word',
            hasOverride: false,
          },
        ],
      },
      gradingStatus: 'auto_graded',
      submittedAt: '2026-01-01T00:00:00.000Z',
    } satisfies SectionSubmission;

    const rows = buildExamObjectiveOverviewRows([{
      submission: { id: 'submission-1', studentName: 'Narin Example' },
      sections: [section],
    }]);

    expect(rows.map((row) => row.questionId)).toEqual(['q-case', 'q-space']);
    expect(rows.every((row) => row.isCorrect)).toBe(false);
    expect(rows.every((row) => row.awardedScore === 0)).toBe(true);
  });

  test('uses the exam question type to exclude choice blocks with exact-match scoring', () => {
    const examState = createInitialExamState('IELTS Mock Test', 'Academic');
    examState.reading.passages = [{
      id: 'passage-1',
      title: 'Passage 1',
      content: '',
      blocks: [
        {
          id: 'tfng-block',
          type: 'TFNG',
          instruction: '',
          mode: 'TFNG',
          questions: [{ id: 'q-choice-exact', statement: 'Statement', correctAnswer: 'T' }],
        },
        {
          id: 'short-answer-block',
          type: 'SHORT_ANSWER',
          instruction: '',
          questions: [{
            id: 'q-text-exact',
            prompt: 'Answer',
            correctAnswer: 'Answer',
            answerRule: 'ONE_WORD',
          }],
        },
      ],
    }];

    const section = {
      id: 'section-1',
      submissionId: 'submission-1',
      section: 'reading',
      answers: { type: 'reading', passages: [] },
      autoGradingResults: {
        generatedAt: '2026-01-01T00:00:00.000Z',
        totalScore: 0,
        maxScore: 2,
        percentage: 0,
        questionResults: [
          {
            questionId: 'q-choice-exact',
            studentAnswer: 't',
            correctAnswer: 'T',
            isCorrect: false,
            awardedScore: 0,
            maxScore: 1,
            scoringRule: 'exact_match',
            hasOverride: false,
          },
          {
            questionId: 'q-text-exact',
            studentAnswer: 'ANSWER',
            correctAnswer: 'Answer',
            isCorrect: false,
            awardedScore: 0,
            maxScore: 1,
            scoringRule: 'exact_match',
            hasOverride: false,
          },
        ],
      },
      gradingStatus: 'auto_graded',
      submittedAt: '2026-01-01T00:00:00.000Z',
    } satisfies SectionSubmission;

    const rows = buildExamObjectiveOverviewRows([{
      submission: { id: 'submission-1', studentName: 'Narin Example' },
      sections: [section],
    }], { examState });

    expect(rows.map((row) => row.questionId)).toEqual(['q-text-exact']);
  });

  test('marks case-mismatched text answers incorrect in the exam overview', () => {
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
    expect(rows[0]?.isCorrect).toBe(false);
    expect(rows[0]?.awardedScore).toBe(0);
  });

  test('shows all table-cell accepted answers and matches against the full key', () => {
    const examState = createInitialExamState('IELTS Mock Test', 'Academic');
    examState.reading.passages = [{
      id: 'passage-1',
      title: 'Passage 1',
      content: '',
      blocks: [{
        id: 'table-1',
        type: 'TABLE_COMPLETION',
        instruction: '',
        headers: ['Answer'],
        rows: [['']],
        cells: [{
          id: 'cell-1',
          row: 0,
          col: 0,
          correctAnswer: 'faces of china',
          acceptedAnswers: ['faces of china', 'FACES OF CHINA', 'Faces of China'],
        }],
        answerRule: 'THREE_WORDS',
      }],
    }];

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
          questionId: 'table-1:cell-1',
          studentAnswer: 'Faces of China',
          correctAnswer: 'faces of china',
          isCorrect: false,
          awardedScore: 0,
          maxScore: 1,
          scoringRule: 'table_completion',
          hasOverride: false,
        }],
      },
      gradingStatus: 'auto_graded',
      submittedAt: '2026-01-01T00:00:00.000Z',
    } satisfies SectionSubmission;

    const rows = buildExamObjectiveOverviewRows([{
      submission: { id: 'submission-1', studentName: 'Narin Example' },
      sections: [section],
    }], { examState });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.correctAnswer).toBe(
      'faces of china | FACES OF CHINA | Faces of China',
    );
    expect(rows[0]?.isCorrect).toBe(true);
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

  test('filters visible answer rows by correctness result', async () => {
    const section = {
      id: 'section-1',
      submissionId: 'submission-1',
      section: 'reading',
      answers: { type: 'reading', passages: [] },
      autoGradingResults: {
        generatedAt: '2026-01-01T00:00:00.000Z',
        totalScore: 1,
        maxScore: 2,
        percentage: 50,
        questionResults: [
          {
            questionId: 'q-correct',
            studentAnswer: ' ANSWER ',
            correctAnswer: 'ANSWER',
            isCorrect: false,
            awardedScore: 0,
            maxScore: 1,
            scoringRule: 'one_word',
            hasOverride: false,
          },
          {
            questionId: 'q-incorrect',
            studentAnswer: 'WRONG',
            correctAnswer: 'Wrong',
            isCorrect: false,
            awardedScore: 0,
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
          },
        ],
      },
      gradingStatus: 'in_review',
      submittedAt: '2026-01-01T00:00:00.000Z',
    } satisfies SectionSubmission;

    vi.mocked(gradingRepository.getSubmissionsBySession).mockResolvedValue([
      { id: 'submission-1', studentName: 'Narin Example' } as never,
    ]);
    vi.mocked(gradingRepository.getSectionSubmissionsBySubmissionId).mockResolvedValue([section]);

    render(
      <ExamObjectiveOverviewPanel
        session={{ examTitle: 'IELTS Mock Test', id: 'session-1' } as never}
      />,
    );

    expect(await screen.findByText('q-correct')).toBeInTheDocument();
    expect(screen.getByText('q-incorrect')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter result rows' }), {
      target: { value: 'incorrect' },
    });

    expect(screen.queryByText('q-correct')).not.toBeInTheDocument();
    expect(screen.getByText('q-incorrect')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter result rows' }), {
      target: { value: 'correct' },
    });

    expect(screen.getByText('q-correct')).toBeInTheDocument();
    expect(screen.queryByText('q-incorrect')).not.toBeInTheDocument();
  });

  test('uses the active objective-grading draft after an answer-key update', async () => {
    const publishedState = createInitialExamState('IELTS Mock Test', 'Academic');
    publishedState.reading.passages = [{
      id: 'passage-1',
      title: 'Passage 1',
      content: '',
      blocks: [{
        id: 'short-answer-block',
        type: 'SHORT_ANSWER',
        instruction: '',
        questions: [{
          id: 'q-17',
          prompt: 'Answer',
          correctAnswer: 'GARDEN HALL',
          acceptedAnswers: ['GARDEN HALL'],
          answerRule: 'ONE_WORD',
        }],
      }],
    }];

    const draftState = structuredClone(publishedState);
    const draftQuestion = draftState.reading.passages[0]?.blocks[0];
    if (draftQuestion?.type !== 'SHORT_ANSWER') {
      throw new Error('Expected short-answer block');
    }
    draftQuestion.questions[0] = {
      ...draftQuestion.questions[0],
      acceptedAnswers: ['GARDEN HALL', 'Garden hall'],
    };

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
          questionId: 'q-17',
          studentAnswer: 'Garden hall',
          correctAnswer: 'GARDEN HALL',
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

    vi.mocked(gradingRepository.getSubmissionsBySession).mockResolvedValue([
      { id: 'submission-1', studentName: 'Narin Example' } as never,
    ]);
    vi.mocked(gradingRepository.getSectionSubmissionsBySubmissionId).mockResolvedValue([section]);
    vi.mocked(gradingService.getObjectiveGradingSource).mockResolvedValue({
      success: true,
      data: { draftVersionId: 'draft-version-1' },
    });
    vi.mocked(examRepository.getVersionById).mockImplementation(async (versionId) => ({
      contentSnapshot: versionId === 'draft-version-1' ? draftState : publishedState,
    } as never));

    render(
      <ExamObjectiveOverviewPanel
        session={{
          id: 'session-1',
          examId: 'exam-1',
          scheduleId: 'schedule-1',
          publishedVersionId: 'published-version-1',
        } as never}
      />,
    );

    await waitFor(() => expect(gradingService.getObjectiveGradingSource).toHaveBeenCalledWith('schedule-1'));
    expect(await screen.findByText('GARDEN HALL | Garden hall')).toBeInTheDocument();
    expect(screen.getByText('1 correct')).toBeInTheDocument();
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    expect(examRepository.getVersionById).toHaveBeenCalledWith('draft-version-1');

    vi.mocked(gradingRepository.getSubmissionsBySession).mockResolvedValue([]);
    act(() => {
      notifyObjectiveGradingUpdated('exam-1');
    });

    await waitFor(() => expect(gradingRepository.getSubmissionsBySession).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('No typed answers differ from their key only by letter case or whitespace.')).toBeInTheDocument();
  });
});
