import { describe, expect, it } from 'vitest';
import { createInitialExamState } from '../../../services/examAdapterService';
import type { ExamState, TableCompletionBlock } from '../../../types';
import type { ObjectiveQuestionResult, SectionSubmission } from '../../../types/grading';
import { buildExamObjectiveOverviewRows } from '../examObjectiveOverviewUtils';

function examWithTableGroup(): ExamState {
  const state = createInitialExamState('Overview warning', 'Academic');
  const block: TableCompletionBlock = {
    id: 'table-1',
    type: 'TABLE_COMPLETION',
    instruction: '',
    headers: ['A', 'B'],
    rows: [['1', '2']],
    cells: [
      {
        id: 'c1',
        correctAnswer: 'garden hall',
        row: 0,
        col: 0,
        placeholderIndex: 0,
        scoreGroupId: 'g1',
        requiredCorrect: 1,
      },
      {
        id: 'c2',
        correctAnswer: 'blue',
        row: 0,
        col: 1,
        placeholderIndex: 1,
        scoreGroupId: 'g1',
        requiredCorrect: 1,
      },
    ],
    answerRule: 'ONE_WORD',
  };
  state.reading.passages[0]!.blocks = [block];
  return state;
}

function result(overrides: Partial<ObjectiveQuestionResult>): ObjectiveQuestionResult {
  return {
    questionId: 'table-1:c1',
    studentAnswer: '',
    correctAnswer: '',
    isCorrect: false,
    awardedScore: 0,
    maxScore: 0,
    scoringRule: 'exact_match',
    hasOverride: false,
    ...overrides,
  };
}

function sectionWith(results: ObjectiveQuestionResult[]): SectionSubmission {
  return {
    id: 'sec-1',
    submissionId: 'sub-1',
    section: 'reading',
    answers: {
      type: 'reading',
      answers: { 'table-1:c1': 'Garden hall', 'table-1:c2': 'blue' },
    },
    autoGradingResults: {
      generatedAt: '2026-01-01T00:00:00.000Z',
      totalScore: 1,
      maxScore: 1,
      percentage: 100,
      questionResults: results,
    },
    gradingStatus: 'auto_graded',
    submittedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as SectionSubmission;
}

function overviewRows(examState: ExamState, section: SectionSubmission) {
  return buildExamObjectiveOverviewRows(
    [{ submission: { id: 'sub-1', studentName: 'Student' }, sections: [section] }],
    { examState },
  );
}

describe('overview saved-score warning', () => {
  it('does not warn for a grouped representative whose saved group mark agrees with the scorer', () => {
    // Saved result: group passed on the second cell; the representative cell's
    // own answer is only a case variant, so a per-slot recheck would disagree.
    const rows = overviewRows(examWithTableGroup(), sectionWith([
      result({ questionId: 'table-1:c1', studentAnswer: 'Garden hall', correctAnswer: 'garden hall', isCorrect: true, awardedScore: 1, maxScore: 1 }),
      result({ questionId: 'table-1:c2', studentAnswer: 'blue', correctAnswer: 'blue', isCorrect: true, awardedScore: 0, maxScore: 0 }),
    ]));

    const representative = rows.find((row) => row.questionId === 'table-1:c1');
    expect(representative).toBeDefined();
    expect(representative?.isCorrect).toBe(true);
    expect(representative?.websiteIsCorrect).toBe(true);
    expect(representative?.savedResultOutOfDate).toBe(false);
  });

  it('still warns when the saved group mark really is stale', () => {
    const rows = overviewRows(examWithTableGroup(), sectionWith([
      result({ questionId: 'table-1:c1', studentAnswer: 'Garden hall', correctAnswer: 'garden hall', isCorrect: false, awardedScore: 0, maxScore: 1 }),
      result({ questionId: 'table-1:c2', studentAnswer: 'blue', correctAnswer: 'blue', isCorrect: true, awardedScore: 0, maxScore: 0 }),
    ]));

    const representative = rows.find((row) => row.questionId === 'table-1:c1');
    expect(representative?.isCorrect).toBe(false);
    expect(representative?.websiteIsCorrect).toBe(true);
    expect(representative?.savedResultOutOfDate).toBe(true);
  });
});
