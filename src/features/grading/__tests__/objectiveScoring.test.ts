import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createInitialExamState, getStudentQuestionsForModule } from '../../../services/examAdapterService';
import type { ExamState, QuestionBlock } from '../../../types';
import { scoreObjectiveDescriptors } from '../objectiveScoring';

function stateWith(blocks: QuestionBlock[]): ExamState {
  const state = createInitialExamState('Objective scoring', 'Academic');
  state.reading.passages[0]!.blocks = blocks;
  return state;
}

function score(blocks: QuestionBlock[], answers: Record<string, unknown>) {
  const descriptors = getStudentQuestionsForModule(stateWith(blocks), 'reading');
  return scoreObjectiveDescriptors(descriptors, answers as never);
}

describe('objective scoring groups', () => {
  it('gives a grouped table slot pair one shared mark', () => {
    const blocks: QuestionBlock[] = [
      {
        id: 'table',
        type: 'TABLE_COMPLETION',
        instruction: '',
        answerRule: 'ONE_WORD',
        headers: ['A'],
        rows: [[''], ['']],
        cells: [
          { id: 'c1', row: 0, col: 0, correctAnswer: 'x', scoreGroupId: 'g1', requiredCorrect: 2 },
          { id: 'c2', row: 1, col: 0, correctAnswer: 'y', scoreGroupId: 'g1', requiredCorrect: 2 },
        ],
      },
    ];

    const partial = score(blocks, { table: ['x'] });
    expect(partial.byId.get('table:c1')?.awardedScore).toBe(0);
    expect(partial.byId.get('table:c1')?.maxScore).toBe(1);
    expect(partial.byId.get('table:c2')?.maxScore).toBe(0);
    expect(partial.totalScore).toBe(0);
    expect(partial.maxScore).toBe(1);

    const complete = score(blocks, { table: ['x', 'y'] });
    expect(complete.byId.get('table:c1')?.awardedScore).toBe(1);
    expect(complete.totalScore).toBe(1);
    expect(complete.maxScore).toBe(1);
  });

  it('consumes a shared sentence pool key once', () => {
    const blocks: QuestionBlock[] = [
      {
        id: 'sentence',
        type: 'SENTENCE_COMPLETION',
        instruction: '',
        questions: [
          {
            id: 's1',
            sentence: 'The ____ and ____.',
            answerRule: 'ONE_WORD',
            acceptAnyAnswerKey: true,
            sharedAcceptedAnswers: ['alpha', 'beta'],
            blanks: [
              { id: 'b1', position: 0, correctAnswer: 'alpha' },
              { id: 'b2', position: 1, correctAnswer: 'beta' },
            ],
          },
        ],
      },
    ];

    const swapped = score(blocks, { s1: ['beta', 'alpha'] });
    expect(swapped.byId.get('s1:b1')?.awardedScore).toBe(1);
    expect(swapped.byId.get('s1:b2')?.awardedScore).toBe(1);
    expect(swapped.totalScore).toBe(2);

    const repeated = score(blocks, { s1: ['alpha', 'alpha'] });
    expect(repeated.byId.get('s1:b1')?.awardedScore).toBe(1);
    expect(repeated.byId.get('s1:b2')?.awardedScore).toBe(0);
    expect(repeated.totalScore).toBe(1);
  });

  it('matches sub-answer tree leaves unordered and awards the root one mark', () => {
    const blocks: QuestionBlock[] = [
      {
        id: 'tree',
        type: 'SHORT_ANSWER',
        instruction: '',
        questions: [],
        subAnswerModeEnabled: true,
        answerTree: [
          {
            id: 'r1',
            children: [
              { id: 'lf1', acceptedAnswers: ['yes'], required: true },
              { id: 'lf2', acceptedAnswers: ['no'], required: true },
            ],
          },
        ],
      },
    ];

    const swapped = score(blocks, {
      'tree::tree::r1::lf1': 'no',
      'tree::tree::r1::lf2': 'yes',
    });
    expect(swapped.byId.get('tree::tree::r1::lf1')?.awardedScore).toBe(1);
    expect(swapped.byId.get('tree::tree::r1::lf2')?.awardedScore).toBe(0);
    expect(swapped.totalScore).toBe(1);
    expect(swapped.maxScore).toBe(1);

    const missing = score(blocks, { 'tree::tree::r1::lf1': 'yes' });
    expect(missing.totalScore).toBe(0);
  });

  it('awards one mark per correct choose-N selection', () => {
    const blocks: QuestionBlock[] = [
      {
        id: 'multi',
        type: 'MULTI_MCQ',
        instruction: '',
        stem: 'Choose TWO',
        requiredSelections: 2,
        options: [
          { id: 'o1', text: 'One', isCorrect: true },
          { id: 'o2', text: 'Two', isCorrect: true },
          { id: 'o3', text: 'Three', isCorrect: false },
        ],
      },
    ];

    expect(score(blocks, { multi: ['o1'] }).byId.get('multi')?.awardedScore).toBe(1);
    expect(score(blocks, { multi: ['o1'] }).byId.get('multi')?.maxScore).toBe(2);
    expect(score(blocks, { multi: ['o1', 'o2'] }).byId.get('multi')?.correctness).toBe(true);
    expect(score(blocks, { multi: ['o1', 'o2', 'o3'] }).totalScore).toBe(0);
  });

  it('keeps the baseline fixture at the Go grader totals', () => {
    const fixture = JSON.parse(
      readFileSync('testdata/objective-grading-parity/baseline-exam.json', 'utf8'),
    ) as { cases: Array<{ examState: ExamState; answers: Record<string, unknown> }> };
    const testCase = fixture.cases[0]!;
    const descriptors = getStudentQuestionsForModule(testCase.examState, 'reading');
    const scoring = scoreObjectiveDescriptors(descriptors, testCase.answers as never);
    expect(scoring.totalScore).toBe(10);
    expect(scoring.maxScore).toBe(12);
  });
});

describe('full-coverage parity exam', () => {
  it('matches the saved expected per-question results', () => {
    const fixture = JSON.parse(
      readFileSync('testdata/objective-grading-parity/full-coverage-exam.json', 'utf8'),
    ) as {
      examState: ExamState;
      answers: Record<string, unknown>;
      overrides: Record<string, never>;
      expected: {
        totalScore: number;
        maxScore: number;
        questions: Array<{
          questionId: string;
          correctness: boolean | null;
          awardedScore: number | null;
          maxScore: number | null;
        }>;
      };
    };
    const descriptors = getStudentQuestionsForModule(fixture.examState, 'reading');
    const scoring = scoreObjectiveDescriptors(descriptors, fixture.answers as never, fixture.overrides);
    expect(scoring.totalScore).toBe(fixture.expected.totalScore);
    expect(scoring.maxScore).toBe(fixture.expected.maxScore);

    for (const expected of fixture.expected.questions) {
      const score = scoring.byId.get(expected.questionId);
      expect(score, `missing ${expected.questionId}`).toBeDefined();
      expect(score?.correctness).toBe(expected.correctness);
      expect(score?.awardedScore).toBe(expected.awardedScore);
      expect(score?.maxScore).toBe(expected.maxScore);
    }
  });
});

describe('group override scoring', () => {
  it('uses an override max on a grouped table slot', () => {
    const blocks: QuestionBlock[] = [
      {
        id: 'table',
        type: 'TABLE_COMPLETION',
        instruction: '',
        answerRule: 'ONE_WORD',
        headers: ['A'],
        rows: [[''], ['']],
        cells: [
          { id: 'c1', row: 0, col: 0, correctAnswer: 'x', scoreGroupId: 'g1', requiredCorrect: 2 },
          { id: 'c2', row: 1, col: 0, correctAnswer: 'y', scoreGroupId: 'g1', requiredCorrect: 2 },
        ],
      },
    ];
    const scoring = scoreObjectiveDescriptors(
      getStudentQuestionsForModule(stateWith(blocks), 'reading'),
      { table: ['x', 'y'] },
      { 'table:c1': { acceptedAnswers: ['x'], scoringRule: 'exact_match', maxScore: 2 } },
    );
    expect(scoring.byId.get('table:c1')?.awardedScore).toBe(2);
    expect(scoring.byId.get('table:c1')?.maxScore).toBe(2);
    expect(scoring.totalScore).toBe(2);
    expect(scoring.maxScore).toBe(2);
  });

  it('uses an override max and accepted answer on a tree root', () => {
    const blocks: QuestionBlock[] = [
      {
        id: 'tree',
        type: 'SHORT_ANSWER',
        instruction: '',
        questions: [],
        subAnswerModeEnabled: true,
        answerTree: [
          {
            id: 'r1',
            children: [
              { id: 'lf1', acceptedAnswers: ['yes'], required: true },
              { id: 'lf2', acceptedAnswers: ['no'], required: true },
            ],
          },
        ],
      },
    ];
    const scoring = scoreObjectiveDescriptors(
      getStudentQuestionsForModule(stateWith(blocks), 'reading'),
      {
        'tree::tree::r1::lf1': 'no',
        'tree::tree::r1::lf2': 'yes',
      },
      { 'tree::tree::r1::lf1': { acceptedAnswers: ['yes'], scoringRule: 'exact_match', maxScore: 2 } },
    );
    expect(scoring.byId.get('tree::tree::r1::lf1')?.awardedScore).toBe(2);
    expect(scoring.byId.get('tree::tree::r1::lf1')?.maxScore).toBe(2);
    expect(scoring.totalScore).toBe(2);
    expect(scoring.maxScore).toBe(2);
  });
});
