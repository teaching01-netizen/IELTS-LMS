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

  test('requires answer-key case when score is missing', () => {
    const columns: CsvColumn[] = [{ key: 'answer:q1', label: 'Q1 Answer' }];

    const rows = buildObjectiveQuestionTableRows(columns, {
      'answer:q1': '  Triangular   graph ',
      'rightAnswer:q1': 'triangular graph',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.correct).toBe('No');
  });
});
