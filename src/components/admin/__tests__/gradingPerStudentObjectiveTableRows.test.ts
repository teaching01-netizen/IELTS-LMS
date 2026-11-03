import { describe, expect, test } from 'vitest';

import type { CsvColumn } from '../gradingReviewUtils';
import { buildObjectiveQuestionTableRows } from '../gradingPerStudentExport/objective/tableRows';

describe('buildObjectiveQuestionTableRows', () => {
  test('derives correctness from numeric score when available', () => {
    const columns: CsvColumn[] = [
      { key: 'answer:q1', label: 'Q1 Answer' },
      { key: 'score:q1', label: 'Q1 Score' },
    ];

    const rows = buildObjectiveQuestionTableRows(columns, {
      'answer:q1': 'A',
      'rightAnswer:q1': 'A',
      'score:q1': 1,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      question: 'Q1',
      studentAnswer: 'A',
      rightAnswer: 'A',
      correct: 'Yes',
      score: '1',
    });
  });

  test('ignores answer-key case when score is missing', () => {
    const columns: CsvColumn[] = [{ key: 'answer:q1', label: 'Q1 Answer' }];

    const rows = buildObjectiveQuestionTableRows(columns, {
      'answer:q1': '  Triangular   graph ',
      'rightAnswer:q1': 'triangular graph',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.correct).toBe('Yes');
  });

  test('compares each pipe-separated accepted answer separately', () => {
    const columns: CsvColumn[] = [{ key: 'answer:q1', label: 'Q1 Answer' }];

    const rows = buildObjectiveQuestionTableRows(columns, {
      'answer:q1': 'b',
      'rightAnswer:q1': 'graph | b',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.correct).toBe('Yes');
  });

  test('splits pipe variants without surrounding spaces', () => {
    const columns: CsvColumn[] = [{ key: 'answer:q1', label: 'Q1 Answer' }];

    const rows = buildObjectiveQuestionTableRows(columns, {
      'answer:q1': 'waiters',
      'rightAnswer:q1': 'waiter|waiters',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.correct).toBe('Yes');
  });

  test('renders one row per question number for choose-N with saved partial score', () => {
    const columns: CsvColumn[] = [
      { key: 'answer:multi', label: 'Q21-22 Answer' },
      { key: 'rightAnswer:multi', label: 'Q21-22 Right Answer' },
      { key: 'score:multi', label: 'Q21-22 Score' },
    ];

    const rows = buildObjectiveQuestionTableRows(columns, {
      'answer:multi': 'Option one, Option two',
      'rightAnswer:multi': 'Option one, Option two',
      'score:multi': 1,
      'selectionScores:multi': [1, 0],
      'selectionAnswers:multi': ['Option one', 'Option two'],
      'selectionCorrectAnswers:multi': ['Option one', 'Option two'],
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.question)).toEqual(['Q21', 'Q22']);
    expect(rows.map((row) => row.correct)).toEqual(['Yes', 'No']);
    expect(rows.filter((row) => row.correct === 'Yes')).toHaveLength(1);
  });
});
