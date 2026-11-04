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

  test('requires exact case by default when score is missing', () => {
    const columns: CsvColumn[] = [{ key: 'answer:q1', label: 'Q1 Answer' }];

    const rows = buildObjectiveQuestionTableRows(columns, {
      'answer:q1': '  Triangular   graph ',
      'rightAnswer:q1': 'triangular graph',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.correct).toBe('No');
  });

  test('explicit opt-out restores insensitive fallback when score is missing', () => {
    const columns: CsvColumn[] = [{ key: 'answer:q1', label: 'Q1 Answer' }];

    const rows = buildObjectiveQuestionTableRows(columns, {
      'answer:q1': '  Triangular   graph ',
      'rightAnswer:q1': 'triangular graph',
    }, { caseSensitiveByQuestionId: { q1: false } });

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

  test('coalesces score-group rows with a display separator that cannot be read as variants', () => {
    const columns: CsvColumn[] = [
      { key: 'answer:a1', label: 'Q21-22 Answer (1)' },
      { key: 'rightAnswer:a1', label: 'Q21-22 Right Answer (1)' },
      { key: 'answer:a2', label: 'Q21-22 Answer (2)' },
      { key: 'rightAnswer:a2', label: 'Q21-22 Right Answer (2)' },
      { key: 'scoreGroup:g1', label: 'Q21-22 Score' },
    ];

    const rows = buildObjectiveQuestionTableRows(columns, {
      'answer:a1': 'graph',
      'rightAnswer:a1': 'graph',
      'answer:a2': 'cluster',
      'rightAnswer:a2': 'cluster',
      'scoreGroup:g1': '',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      question: 'Q21-22',
      studentAnswer: 'graph, cluster',
      rightAnswer: 'graph, cluster',
      correct: 'Yes',
      score: '',
    });
    // `|` is the accepted-variant separator, so display merging must not emit it.
    expect(rows[0]?.studentAnswer).not.toContain('|');
    expect(rows[0]?.rightAnswer).not.toContain('|');
  });

  test('does not repeat an identical display value when coalescing score-group rows', () => {
    const columns: CsvColumn[] = [
      { key: 'answer:a1', label: 'Q21-22 Answer (1)' },
      { key: 'rightAnswer:a1', label: 'Q21-22 Right Answer (1)' },
      { key: 'answer:a2', label: 'Q21-22 Answer (2)' },
      { key: 'rightAnswer:a2', label: 'Q21-22 Right Answer (2)' },
      { key: 'scoreGroup:g1', label: 'Q21-22 Score' },
    ];

    const rows = buildObjectiveQuestionTableRows(columns, {
      'answer:a1': 'graph',
      'rightAnswer:a1': 'graph',
      'answer:a2': 'graph',
      'rightAnswer:a2': 'graph',
      'scoreGroup:g1': '',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.studentAnswer).toBe('graph');
    expect(rows[0]?.rightAnswer).toBe('graph');
  });

  test('applies the group threshold to merged score-absent verdicts', () => {
    const columns: CsvColumn[] = [
      { key: 'answer:a1', label: 'Q21-22 Answer (1)' },
      { key: 'rightAnswer:a1', label: 'Q21-22 Right Answer (1)' },
      { key: 'answer:a2', label: 'Q21-22 Answer (2)' },
      { key: 'rightAnswer:a2', label: 'Q21-22 Right Answer (2)' },
      { key: 'scoreGroup:g1', label: 'Q21-22 Score' },
    ];

    const rows = buildObjectiveQuestionTableRows(
      columns,
      {
        'answer:a1': 'graph',
        'rightAnswer:a1': 'graph',
        'answer:a2': 'bar',
        'rightAnswer:a2': 'cluster',
        'scoreGroup:g1': '',
      },
      { groupThresholdByScoreKey: { 'scoreGroup:g1': 2 } },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      studentAnswer: 'graph, bar',
      rightAnswer: 'graph, cluster',
      correct: 'No',
      score: '',
    });
  });

  test('counts every member verdict for 3+ slot groups when the score is absent', () => {
    const columns: CsvColumn[] = [
      { key: 'answer:a1', label: 'Q21-23 Answer (1)' },
      { key: 'rightAnswer:a1', label: 'Q21-23 Right Answer (1)' },
      { key: 'answer:a2', label: 'Q21-23 Answer (2)' },
      { key: 'rightAnswer:a2', label: 'Q21-23 Right Answer (2)' },
      { key: 'answer:a3', label: 'Q21-23 Answer (3)' },
      { key: 'rightAnswer:a3', label: 'Q21-23 Right Answer (3)' },
      { key: 'scoreGroup:g1', label: 'Q21-23 Score' },
    ];

    const rows = buildObjectiveQuestionTableRows(
      columns,
      {
        'answer:a1': 'graph',
        'rightAnswer:a1': 'graph',
        'answer:a2': 'graph',
        'rightAnswer:a2': 'graph',
        'answer:a3': 'bar',
        'rightAnswer:a3': 'cluster',
        'scoreGroup:g1': '',
      },
      { groupThresholdByScoreKey: { 'scoreGroup:g1': 2 } },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.correct).toBe('Yes');
    expect(rows[0]?.score).toBe('');

    const belowThreshold = buildObjectiveQuestionTableRows(
      columns,
      {
        'answer:a1': 'graph',
        'rightAnswer:a1': 'graph',
        'answer:a2': 'bar',
        'rightAnswer:a2': 'cluster',
        'answer:a3': 'bar',
        'rightAnswer:a3': 'cluster',
        'scoreGroup:g1': '',
      },
      { groupThresholdByScoreKey: { 'scoreGroup:g1': 2 } },
    );
    expect(belowThreshold[0]?.correct).toBe('No');
  });
});
