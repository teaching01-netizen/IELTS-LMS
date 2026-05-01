import { describe, expect, it } from 'vitest';
import { createInitialExamState } from '../../services/examAdapterService';
import type { TableCompletionBlock } from '../../types';
import {
  getCanonicalTableCells,
  normalizeExamStateTableCompletionBlocks,
  normalizeTableCompletionBlock,
} from '../tableCompletion';

function buildTableBlock(overrides: Partial<TableCompletionBlock> = {}): TableCompletionBlock {
  return {
    id: 'tbl-1',
    type: 'TABLE_COMPLETION',
    instruction: 'Complete the table.',
    answerRule: 'ONE_WORD',
    headers: ['Column A', 'Column B'],
    rows: [['', '']],
    cells: [],
    ...overrides,
  };
}

describe('tableCompletion utils', () => {
  it('orders canonical slots in row-major order and preserves coordinate-matched answers', () => {
    const block = buildTableBlock({
      headers: ['A', 'B', 'C'],
      rows: [
        ['Name', '____', ''],
        ['____', '', ''],
      ],
      cells: [
        { id: 'cell-b', row: 1, col: 0, correctAnswer: 'second', acceptedAnswers: ['second', '2nd'] },
        { id: 'cell-a', row: 0, col: 1, correctAnswer: 'first', acceptedAnswers: ['first'] },
      ],
    });

    const canonical = getCanonicalTableCells(block);

    expect(canonical.map((cell) => `${cell.row}:${cell.col}`)).toEqual(['0:1', '1:0']);
    expect(canonical.map((cell) => cell.correctAnswer)).toEqual(['first', 'second']);
    expect(canonical.map((cell) => cell.acceptedAnswers)).toEqual([['first'], ['second', '2nd']]);
  });

  it('converts legacy mapped cells into placeholder-driven rows and drops invalid/duplicate cells', () => {
    const block = buildTableBlock({
      rows: [['Label', 'Value'], ['Other', 'Text']],
      cells: [
        { id: 'cell-keep', row: 0, col: 1, correctAnswer: 'alpha' },
        { id: 'cell-dup', row: 0, col: 1, correctAnswer: 'beta' },
        { id: 'cell-invalid', row: 9, col: 0, correctAnswer: 'ignored' },
      ],
    });

    const normalized = normalizeTableCompletionBlock(block);

    expect(normalized.rows[0][1]).toContain('____');
    expect(normalized.cells).toHaveLength(1);
    expect(normalized.cells[0]).toMatchObject({
      id: 'cell-keep',
      row: 0,
      col: 1,
      correctAnswer: 'alpha',
      acceptedAnswers: ['alpha'],
    });
  });

  it('maps existing answers by slot position when placeholder coordinates change', () => {
    const block = buildTableBlock({
      headers: ['A', 'B'],
      rows: [
        ['____', ''],
        ['', '____'],
      ],
      cells: [
        { id: 'cell-1', row: 0, col: 1, correctAnswer: 'first' },
        { id: 'cell-2', row: 1, col: 0, correctAnswer: 'second' },
      ],
    });

    const canonical = getCanonicalTableCells(block);

    expect(canonical).toHaveLength(2);
    expect(canonical[0]).toMatchObject({ row: 0, col: 0, correctAnswer: 'first' });
    expect(canonical[1]).toMatchObject({ row: 1, col: 1, correctAnswer: 'second' });
  });

  it('normalizes table blocks across reading and listening state trees', () => {
    const state = createInitialExamState('Table Normalization', 'Academic');
    state.reading.passages[0].blocks = [
      buildTableBlock({
        id: 'reading-table',
        rows: [['A', 'B']],
        cells: [{ id: 'r-cell', row: 0, col: 1, correctAnswer: 'reading' }],
      }),
    ];
    state.listening.parts[0].blocks = [
      buildTableBlock({
        id: 'listening-table',
        rows: [['X', 'Y']],
        cells: [{ id: 'l-cell', row: 0, col: 0, correctAnswer: 'listening' }],
      }),
    ];

    const normalizedState = normalizeExamStateTableCompletionBlocks(state);
    const readingBlock = normalizedState.reading.passages[0].blocks[0] as TableCompletionBlock;
    const listeningBlock = normalizedState.listening.parts[0].blocks[0] as TableCompletionBlock;

    expect(normalizedState).not.toBe(state);
    expect(readingBlock.rows[0][1]).toContain('____');
    expect(listeningBlock.rows[0][0]).toContain('____');
    expect(readingBlock.cells[0]?.acceptedAnswers).toEqual(['reading']);
    expect(listeningBlock.cells[0]?.acceptedAnswers).toEqual(['listening']);
  });
});
