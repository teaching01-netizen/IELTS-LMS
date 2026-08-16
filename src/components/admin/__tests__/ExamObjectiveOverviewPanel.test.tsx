import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInitialExamState } from '../../../services/examAdapterService';
import type { ObjectiveIntegrityOverview, SectionSubmission } from '../../../types/grading';
import { ExamObjectiveOverviewPanel } from '../ExamObjectiveOverviewPanel';
import {
  buildExamObjectiveOverviewRows,
  groupExamObjectiveOverviewRows,
  type ExamObjectiveOverviewRow,
} from '../examObjectiveOverviewUtils';
import { examRepository } from '../../../services/examRepository';
import { gradingRepository } from '../../../services/gradingRepository';
import { gradingService } from '../../../services/gradingService';
import { notifyObjectiveGradingUpdated } from '../../../utils/objectiveGradingSync';

vi.mock('../../../services/gradingRepository', () => ({
  gradingRepository: {
    getSubmissionsBySession: vi.fn(),
    getSectionSubmissionsBySubmissionId: vi.fn(),
    invalidateSubmissionBundle: vi.fn(),
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
    upsertObjectiveOverride: vi.fn(),
    getObjectiveGradingSource: vi.fn(),
    getObjectiveIntegrityOverview: vi.fn(),
    getObjectiveOverrides: vi.fn(),
  },
}));

function makeObjectiveIntegrityOverview(
  overrides: Partial<ObjectiveIntegrityOverview> = {},
): ObjectiveIntegrityOverview {
  return {
    studentCount: 1,
    expectedAnswerCount: 9,
    verifiedCorrectCount: 6,
    verifiedIncorrectCount: 2,
    verifiedUnansweredCount: 1,
    needsRecheckCount: 0,
    invalidCount: 0,
    integrityStatus: 'verified',
    issues: [],
    ...overrides,
  };
}

describe('buildExamObjectiveOverviewRows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gradingService.getObjectiveIntegrityOverview).mockResolvedValue({
      success: true,
      data: makeObjectiveIntegrityOverview(),
    });
    vi.mocked(gradingService.getObjectiveOverrides).mockResolvedValue({
      success: true,
      data: [],
    });
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
    expect(rows[0]?.questionNumberLabel).toBe('q-1');
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

  test('shows persisted audit findings inside the overall answer check without mark-review controls', async () => {
    vi.mocked(gradingRepository.getSubmissionsBySession).mockResolvedValue([]);
    vi.mocked(gradingRepository.getSectionSubmissionsBySubmissionId).mockResolvedValue([]);
    vi.mocked(gradingService.getObjectiveIntegrityOverview).mockResolvedValue({
      success: true,
      data: makeObjectiveIntegrityOverview({
        needsRecheckCount: 1,
        integrityStatus: 'needs_recheck',
        issues: [{
          submissionId: 'submission-1',
          studentId: 'student-1',
          studentName: 'Narin Example',
          section: 'reading',
          questionId: 'q-12',
          questionNumber: '12',
          code: 'missing_answer_key',
        }],
      }),
    });

    render(
      <ExamObjectiveOverviewPanel
        session={{ examTitle: 'IELTS Mock Test', id: 'session-1', scheduleId: 'schedule-1' } as never}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Audit findings' })).toBeInTheDocument();
    expect(screen.getByText('1 answer needs recheck')).toBeInTheDocument();
    expect(screen.getByText('Missing answer key')).toBeInTheDocument();
    expect(screen.getByText('Narin Example · Reading · q-12')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark review/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accept|reject/i })).not.toBeInTheDocument();
  });

  test('shows the authoritative accounted summary when the persisted audit is verified', async () => {
    vi.mocked(gradingRepository.getSubmissionsBySession).mockResolvedValue([]);
    vi.mocked(gradingRepository.getSectionSubmissionsBySubmissionId).mockResolvedValue([]);
    vi.mocked(gradingService.getObjectiveIntegrityOverview).mockResolvedValue({
      success: true,
      data: makeObjectiveIntegrityOverview({ expectedAnswerCount: 9 }),
    });

    render(
      <ExamObjectiveOverviewPanel
        session={{ examTitle: 'IELTS Mock Test', id: 'session-1', scheduleId: 'schedule-1' } as never}
      />,
    );

    expect(await screen.findByText('All 9 objective answers accounted for')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });

  test('shows an audit loading problem without creating a mark-review action', async () => {
    vi.mocked(gradingRepository.getSubmissionsBySession).mockResolvedValue([]);
    vi.mocked(gradingRepository.getSectionSubmissionsBySubmissionId).mockResolvedValue([]);
    vi.mocked(gradingService.getObjectiveIntegrityOverview).mockResolvedValue({
      success: false,
      error: 'Integrity audit unavailable',
    });

    render(
      <ExamObjectiveOverviewPanel
        session={{ examTitle: 'IELTS Mock Test', id: 'session-1', scheduleId: 'schedule-1' } as never}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Audit findings' })).toBeInTheDocument();
    expect(screen.getByText('Integrity audit unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark review/i })).not.toBeInTheDocument();
  });

  test('does not claim that there are no problems when the audit reports unresolved data without details', async () => {
    vi.mocked(gradingRepository.getSubmissionsBySession).mockResolvedValue([]);
    vi.mocked(gradingRepository.getSectionSubmissionsBySubmissionId).mockResolvedValue([]);
    vi.mocked(gradingService.getObjectiveIntegrityOverview).mockResolvedValue({
      success: true,
      data: makeObjectiveIntegrityOverview({
        needsRecheckCount: 1,
        integrityStatus: 'needs_recheck',
      }),
    });

    render(
      <ExamObjectiveOverviewPanel
        session={{ examTitle: 'IELTS Mock Test', id: 'session-1', scheduleId: 'schedule-1' } as never}
      />,
    );

    expect(await screen.findByText('1 answer needs recheck')).toBeInTheDocument();
    expect(screen.getByText('The persisted audit reports unresolved grading data, but no question-level issue details were returned.')).toBeInTheDocument();
    expect(screen.queryByText('No audit problems found in the persisted grading results.')).not.toBeInTheDocument();
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
    vi.mocked(gradingService.upsertObjectiveOverride).mockResolvedValue({
      success: true,
      data: { regradeReport: {} as never },
    });

    render(
      <ExamObjectiveOverviewPanel
        session={{ examTitle: 'IELTS Mock Test', id: 'session-1', scheduleId: 'schedule-1' } as never}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'ANSWER' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ANSWER' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep incorrect' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep incorrect and regrade' }));

    await waitFor(() => expect(gradingService.upsertObjectiveOverride).toHaveBeenCalledWith(
      'schedule-1',
      'q-1',
      expect.objectContaining({
        excludedAnswers: ['ANSWER'],
        reason: expect.stringContaining('incorrect'),
      }),
    ));
    expect(gradingService.overrideObjectiveQuestion).not.toHaveBeenCalled();
  });

  test('filters answer groups by correctness', async () => {
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

    expect(await screen.findByRole('heading', { name: 'WRONG' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ANSWER' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^All/ }));
    expect(screen.getByRole('heading', { name: 'ANSWER' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'WRONG' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Correct/ }));
    expect(screen.getByRole('heading', { name: 'ANSWER' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'WRONG' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Incorrect/ }));
    expect(screen.queryByRole('heading', { name: 'ANSWER' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'WRONG' })).toBeInTheDocument();
  });

  test('shows the last overall-check decision per answer group', async () => {
    const section = {
      id: 'section-1',
      submissionId: 'submission-1',
      section: 'reading',
      answers: { type: 'reading', passages: [] },
      autoGradingResults: {
        generatedAt: '2026-01-01T00:00:00.000Z',
        totalScore: 1,
        maxScore: 3,
        percentage: 33.33,
        questionResults: [
          {
            questionId: 'q-kept',
            studentAnswer: 'Garden Hall',
            correctAnswer: 'GARDEN HALL',
            isCorrect: false,
            awardedScore: 0,
            maxScore: 1,
            scoringRule: 'one_word',
            hasOverride: false,
          },
          {
            questionId: 'q-accepted',
            studentAnswer: 'ANSWER',
            correctAnswer: 'Answer',
            isCorrect: true,
            awardedScore: 1,
            maxScore: 1,
            scoringRule: 'one_word',
            hasOverride: false,
          },
          {
            questionId: 'q-untouched',
            studentAnswer: 'car park',
            correctAnswer: 'CAR PARK',
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

    vi.mocked(gradingRepository.getSubmissionsBySession).mockResolvedValue([
      { id: 'submission-1', studentName: 'Narin Example' } as never,
    ]);
    vi.mocked(gradingRepository.getSectionSubmissionsBySubmissionId).mockResolvedValue([section]);
    vi.mocked(gradingService.getObjectiveOverrides).mockResolvedValue({
      success: true,
      data: [
        {
          scheduleId: 'schedule-1',
          questionId: 'q-kept',
          overrideJson: {
            correctAnswer: 'GARDEN HALL',
            acceptedAnswers: ['GARDEN HALL'],
            excludedAnswers: ['Garden Hall'],
            scoringRule: 'one_word',
            maxScore: 1,
          },
          updatedByActorId: 'teacher-1',
          updatedByActorName: 'Grace Grader',
          updatedAt: '2026-01-02T10:00:00.000Z',
        },
        {
          scheduleId: 'schedule-1',
          questionId: 'q-accepted',
          overrideJson: {
            correctAnswer: 'Answer',
            acceptedAnswers: ['Answer', 'ANSWER'],
            excludedAnswers: [],
            scoringRule: 'one_word',
            maxScore: 1,
          },
          updatedByActorId: 'teacher-1',
          updatedByActorName: 'Grace Grader',
          updatedAt: '2026-01-03T10:00:00.000Z',
        },
      ],
    });

    render(
      <ExamObjectiveOverviewPanel
        session={{
          examTitle: 'IELTS Mock Test',
          id: 'session-1',
          scheduleId: 'schedule-1',
        } as never}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /^All/ }));

    const keptLine = await screen.findByText((_content, node) => (
      node?.tagName === 'SPAN'
      && node.textContent === 'Kept incorrect by Grace Grader · Jan 2, 2026'
    ));
    expect(keptLine).toBeInTheDocument();
    const acceptedLine = screen.getByText((_content, node) => (
      node?.tagName === 'SPAN'
      && node.textContent === 'Accepted by Grace Grader · Jan 3, 2026'
    ));
    expect(acceptedLine).toBeInTheDocument();
    expect(screen.getAllByText(/by Grace Grader/)).toHaveLength(2);
  });

  test('highlights only the case-different character in the raw student answer', async () => {
    const examState = createInitialExamState('IELTS Mock Test', 'Academic');
    examState.reading.passages = [{
      id: 'passage-1',
      title: 'Passage 1',
      content: '',
      blocks: [{
        id: 'short-answer-block',
        type: 'SHORT_ANSWER',
        instruction: '',
        questions: [{
          id: 'q-case',
          prompt: 'Answer',
          correctAnswer: 'Faces of China',
          acceptedAnswers: ['faces of china', 'FACES OF CHINA', 'Faces of China'],
          answerRule: 'ONE_WORD',
        }],
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
          questionId: 'q-case',
          studentAnswer: 'faces of China',
          correctAnswer: 'faces of china',
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
    vi.mocked(examRepository.getVersionById).mockResolvedValue({ contentSnapshot: examState } as never);

    render(
      <ExamObjectiveOverviewPanel
        session={{
          examTitle: 'IELTS Mock Test',
          id: 'session-1',
          scheduleId: 'schedule-1',
          publishedVersionId: 'published-version-1',
        } as never}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'faces of China' })).toBeInTheDocument();
    const studentAnswerHeading = screen.getByRole('heading', { name: 'faces of China' });
    expect(studentAnswerHeading).toHaveClass('font-sans');
    expect(studentAnswerHeading).not.toHaveClass('font-mono');
    const studentCaseMismatch = screen.getByTitle('Capitalization differs from answer key');
    expect(studentCaseMismatch).toHaveTextContent('f');
    expect(studentCaseMismatch).toHaveClass('bg-yellow-100');
    expect(screen.getByText('Capitalization differs from the closest accepted answer.')).toBeInTheDocument();
    expect(screen.getByText('Expected', { selector: 'span' })).toBeInTheDocument();
    const acceptedAnswerDisclosure = screen.getByText('+2 other accepted answers');
    expect(acceptedAnswerDisclosure).toBeInTheDocument();
    expect(screen.getByText('faces of china')).not.toBeVisible();
    fireEvent.click(acceptedAnswerDisclosure);
    expect(screen.getByText('faces of china')).toBeVisible();
    const currentAnswerKey = screen.queryByText('faces of china | FACES OF CHINA | Faces of China');
    expect(currentAnswerKey).not.toBeInTheDocument();
    expect(screen.queryByTitle('Case differs from student answer')).not.toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole('button', { name: /^Correct/ }));
    expect(await screen.findByText('Expected', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getAllByText('Garden hall')).not.toHaveLength(0);
    expect(screen.queryByText('GARDEN HALL | Garden hall')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Capitalization differs from answer key')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Garden hall' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View 1 student and 1 question' }));
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Garden hall' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'q-1' })).toBeInTheDocument();
    expect(examRepository.getVersionById).toHaveBeenCalledWith('draft-version-1');

    vi.mocked(gradingRepository.getSubmissionsBySession).mockResolvedValue([]);
    act(() => {
      notifyObjectiveGradingUpdated('exam-1');
    });

    await waitFor(() => expect(gradingRepository.getSubmissionsBySession).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('No typed answers differ from their key only by letter case or whitespace.')).toBeInTheDocument();
  });

  test('keeps raw casing variants in separate review groups', () => {
    const rows: ExamObjectiveOverviewRow[] = [
      {
        rowId: 'submission-1:reading:q-1',
        submissionId: 'submission-1',
        studentName: 'Narin Example',
        section: 'reading',
        questionId: 'q-1',
        questionNumberLabel: 'q-1',
        studentAnswer: 'Garden Hall',
        correctAnswer: 'Answer',
        primaryCorrectAnswer: 'Answer',
        isCorrect: true,
        awardedScore: 1,
        maxScore: 1,
        scoringRule: 'exact_match',
        hasOverride: false,
        manualOverride: null,
      },
      {
        rowId: 'submission-2:reading:q-1',
        submissionId: 'submission-2',
        studentName: 'Mali Example',
        section: 'reading',
        questionId: 'q-1',
        questionNumberLabel: 'q-1',
        studentAnswer: 'garden hall',
        correctAnswer: 'Answer',
        primaryCorrectAnswer: 'Answer',
        isCorrect: false,
        awardedScore: 0,
        maxScore: 1,
        scoringRule: 'exact_match',
        hasOverride: false,
        manualOverride: null,
      },
      {
        rowId: 'submission-3:reading:q-1',
        submissionId: 'submission-3',
        studentName: 'Ploy Example',
        section: 'reading',
        questionId: 'q-1',
        questionNumberLabel: 'q-1',
        studentAnswer: 'Garden hall',
        correctAnswer: 'Answer',
        primaryCorrectAnswer: 'Answer',
        isCorrect: false,
        awardedScore: 0,
        maxScore: 1,
        scoringRule: 'exact_match',
        hasOverride: false,
        manualOverride: null,
      },
    ];

    const groups = groupExamObjectiveOverviewRows(rows);

    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.studentAnswer)).toEqual(expect.arrayContaining([
      'garden hall',
      'Garden hall',
      'Garden Hall',
    ]));
    expect(groups.every((group) => group.rows.length === 1)).toBe(true);
  });

  test('sets one answer group for the whole exam and adds the answer to the key', async () => {
    let cacheInvalidated = false;
    const makeSection = (submissionId: string): SectionSubmission => ({
      id: `section-${submissionId}`,
      submissionId,
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
          correctAnswer: cacheInvalidated ? 'Answer | ANSWER' : 'Answer',
          isCorrect: cacheInvalidated,
          awardedScore: cacheInvalidated ? 1 : 0,
          maxScore: 1,
          scoringRule: 'exact_match',
          hasOverride: cacheInvalidated,
        }],
      },
      gradingStatus: 'auto_graded',
      submittedAt: '2026-01-01T00:00:00.000Z',
    });

    vi.mocked(gradingRepository.getSubmissionsBySession).mockResolvedValue([
      { id: 'submission-1', studentName: 'Narin Example' } as never,
      { id: 'submission-2', studentName: 'Mali Example' } as never,
    ]);
    vi.mocked(gradingRepository.getSectionSubmissionsBySubmissionId)
      .mockImplementation(async (submissionId) => [makeSection(submissionId)]);
    vi.mocked(gradingRepository.invalidateSubmissionBundle).mockImplementation(() => {
      cacheInvalidated = true;
    });
    vi.mocked(gradingService.upsertObjectiveOverride).mockResolvedValue({
      success: true,
      data: { regradeReport: {} as never },
    });

    render(
      <ExamObjectiveOverviewPanel
        session={{
          examTitle: 'IELTS Mock Test',
          id: 'session-1',
          scheduleId: 'schedule-1',
        } as never}
      />,
    );

    expect(await screen.findAllByRole('heading', { name: 'ANSWER' })).not.toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /^All/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept for whole exam' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Students affected');
    fireEvent.click(screen.getByRole('button', { name: 'Accept and regrade' }));

    await waitFor(() => expect(gradingService.upsertObjectiveOverride).toHaveBeenCalledTimes(1));
    expect(gradingService.upsertObjectiveOverride).toHaveBeenCalledWith(
      'schedule-1',
      'q-1',
      expect.objectContaining({
        correctAnswer: 'Answer',
        acceptedAnswers: ['Answer', 'ANSWER'],
        scoringRule: 'exact_match',
        maxScore: 1,
      }),
    );
    expect(gradingRepository.invalidateSubmissionBundle).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('status', { name: 'Correct' })).toBeInTheDocument();
    expect(gradingService.overrideObjectiveQuestion).not.toHaveBeenCalled();
  });

  test('applies the decision optimistically before the save resolves, then reconciles', async () => {
    let regraded = false;
    let resolveOverride!: (value: unknown) => void;
    const deferred = new Promise<unknown>((resolve) => {
      resolveOverride = resolve;
    });
    vi.mocked(gradingService.upsertObjectiveOverride).mockReturnValue(deferred as never);

    const makeSection = (): SectionSubmission => ({
      id: 'section-1',
      submissionId: 'submission-1',
      section: 'reading',
      answers: { type: 'reading', passages: [] },
      autoGradingResults: {
        generatedAt: '2026-01-01T00:00:00.000Z',
        totalScore: regraded ? 1 : 0,
        maxScore: 1,
        percentage: regraded ? 100 : 0,
        questionResults: [{
          questionId: 'q-1',
          studentAnswer: 'ANSWER',
          correctAnswer: 'Answer',
          isCorrect: regraded,
          awardedScore: regraded ? 1 : 0,
          maxScore: 1,
          scoringRule: 'one_word',
          hasOverride: regraded,
        }],
      },
      gradingStatus: 'auto_graded',
      submittedAt: '2026-01-01T00:00:00.000Z',
    });

    vi.mocked(gradingRepository.getSubmissionsBySession).mockResolvedValue([
      { id: 'submission-1', studentName: 'Narin Example' } as never,
    ]);
    vi.mocked(gradingRepository.getSectionSubmissionsBySubmissionId)
      .mockImplementation(async () => [makeSection()]);
    vi.mocked(gradingRepository.invalidateSubmissionBundle).mockImplementation(() => {
      regraded = true;
    });

    render(
      <ExamObjectiveOverviewPanel
        session={{ examTitle: 'IELTS Mock Test', id: 'session-1', scheduleId: 'schedule-1' } as never}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'ANSWER' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept for whole exam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept and regrade' }));

    // The group flips to Correct and the card pulses while the save is in flight.
    expect(await screen.findByRole('status', { name: 'Correct' })).toBeInTheDocument();
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    expect(gradingService.upsertObjectiveOverride).toHaveBeenCalledTimes(1);

    resolveOverride({ success: true, data: { regradeReport: {} } });
    await screen.findByText(/Added “ANSWER” to the answer key/);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  test('keeps the list on screen while the post-save reload runs in the background', async () => {
    let regraded = false;
    let resolveReload!: (value: unknown) => void;
    const reloadGate = new Promise<unknown>((resolve) => {
      resolveReload = resolve;
    });
    vi.mocked(gradingService.upsertObjectiveOverride).mockResolvedValue({
      success: true,
      data: { regradeReport: {} as never },
    });

    const makeSection = (): SectionSubmission => ({
      id: 'section-1',
      submissionId: 'submission-1',
      section: 'reading',
      answers: { type: 'reading', passages: [] },
      autoGradingResults: {
        generatedAt: '2026-01-01T00:00:00.000Z',
        totalScore: regraded ? 1 : 0,
        maxScore: 1,
        percentage: regraded ? 100 : 0,
        questionResults: [{
          questionId: 'q-1',
          studentAnswer: 'ANSWER',
          correctAnswer: 'Answer',
          isCorrect: regraded,
          awardedScore: regraded ? 1 : 0,
          maxScore: 1,
          scoringRule: 'one_word',
          hasOverride: regraded,
        }],
      },
      gradingStatus: 'auto_graded',
      submittedAt: '2026-01-01T00:00:00.000Z',
    });

    vi.mocked(gradingRepository.getSubmissionsBySession).mockResolvedValue([
      { id: 'submission-1', studentName: 'Narin Example' } as never,
    ]);
    // Initial load resolves; the post-save reload hangs on section submissions.
    vi.mocked(gradingRepository.getSectionSubmissionsBySubmissionId)
      .mockResolvedValueOnce([makeSection()])
      .mockReturnValueOnce(reloadGate as never)
      .mockResolvedValue([makeSection()]);
    vi.mocked(gradingRepository.invalidateSubmissionBundle).mockImplementation(() => {
      regraded = true;
    });

    render(
      <ExamObjectiveOverviewPanel
        session={{ examTitle: 'IELTS Mock Test', id: 'session-1', scheduleId: 'schedule-1' } as never}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'ANSWER' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept for whole exam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept and regrade' }));

    // The save has resolved and the reload is in flight, but the list stays put:
    // no loading skeleton, and the optimistic card is still on screen.
    await waitFor(() => expect(gradingService.upsertObjectiveOverride).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Loading typed answer exceptions...')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Correct' })).toBeInTheDocument();
    expect(screen.getByText('Saving…')).toBeInTheDocument();

    // Server truth arrives and the card reconciles without ever flashing a skeleton.
    resolveReload([makeSection()]);
    await screen.findByText(/Added “ANSWER” to the answer key/);
    expect(screen.queryByText('Loading typed answer exceptions...')).not.toBeInTheDocument();
  });

  test('coalesces a burst of update notifications into a single background reload', async () => {
    let resolveReload!: (value: unknown) => void;
    const reloadGate = new Promise<unknown>((resolve) => {
      resolveReload = resolve;
    });

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

    vi.mocked(gradingRepository.getSubmissionsBySession).mockResolvedValue([
      { id: 'submission-1', studentName: 'Narin Example' } as never,
    ]);
    // First call: initial load resolves. Second call: the coalesced reload hangs.
    vi.mocked(gradingRepository.getSectionSubmissionsBySubmissionId)
      .mockResolvedValueOnce([section])
      .mockReturnValueOnce(reloadGate as never)
      .mockResolvedValue([section]);

    render(
      <ExamObjectiveOverviewPanel
        session={{
          examTitle: 'IELTS Mock Test',
          id: 'session-1',
          examId: 'exam-1',
          scheduleId: 'schedule-1',
        } as never}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'ANSWER' })).toBeInTheDocument();

    // A burst of notifications while one reload is in flight shares the fetch.
    act(() => {
      notifyObjectiveGradingUpdated('exam-1');
      notifyObjectiveGradingUpdated('exam-1');
      notifyObjectiveGradingUpdated('exam-1');
    });

    await waitFor(() => expect(gradingRepository.getSectionSubmissionsBySubmissionId).toHaveBeenCalledTimes(2));
    expect(gradingRepository.getSubmissionsBySession).toHaveBeenCalledTimes(2);
    // No loading skeleton while the shared reload is in flight.
    expect(screen.queryByText('Loading typed answer exceptions...')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ANSWER' })).toBeInTheDocument();

    resolveReload([section]);
    await waitFor(() => expect(gradingRepository.getSubmissionsBySession).toHaveBeenCalledTimes(2));
  });

  test('reverts the optimistic decision when the save fails', async () => {
    vi.mocked(gradingService.upsertObjectiveOverride).mockResolvedValue({
      success: false,
      error: 'Regrade failed',
    });

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

    vi.mocked(gradingRepository.getSubmissionsBySession).mockResolvedValue([
      { id: 'submission-1', studentName: 'Narin Example' } as never,
    ]);
    vi.mocked(gradingRepository.getSectionSubmissionsBySubmissionId).mockResolvedValue([section]);

    render(
      <ExamObjectiveOverviewPanel
        session={{ examTitle: 'IELTS Mock Test', id: 'session-1', scheduleId: 'schedule-1' } as never}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'ANSWER' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept for whole exam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept and regrade' }));

    // Flips optimistically first...
    expect(await screen.findByRole('status', { name: 'Correct' })).toBeInTheDocument();

    // ...then reverts once the save fails.
    await screen.findByRole('alert');
    expect(screen.getByText('Regrade failed')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Correct' })).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Incorrect' })).toBeInTheDocument();
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument();
  });
});
