import { describe, expect, it } from 'vitest';
import { createInitialExamState } from '../../services/examAdapterService';
import type { TableCompletionBlock } from '../../types';
import {
  getCanonicalTableCells,
  isSuspiciousTableCellContent,
  normalizeExamStateTableCompletionBlocks,
  normalizeTableCompletionBlock,
  trimSuspiciousTableCellContent,
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

  it('assigns stable header and row identities during normalization', () => {
    const block = buildTableBlock({
      headers: ['A', 'B'],
      rows: [['first', ''], ['', 'second']],
    });

    const normalized = normalizeTableCompletionBlock(block);
    const normalizedAgain = normalizeTableCompletionBlock(normalized);

    expect(normalized.headerIds).toHaveLength(2);
    expect(normalized.rowIds).toHaveLength(2);
    expect(new Set(normalized.headerIds).size).toBe(2);
    expect(new Set(normalized.rowIds).size).toBe(2);
    expect(normalizedAgain).toBe(normalized);
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

  it('auto-heals duplicate and missing cell IDs while preserving slot answers', () => {
    const block = buildTableBlock({
      headers: ['A', 'B', 'C'],
      rows: [['____', '', '____']],
      cells: [
        { id: 'dup-id', row: 0, col: 0, correctAnswer: 'left', acceptedAnswers: ['left', 'LEFT'] },
        { id: 'dup-id', row: 0, col: 2, correctAnswer: 'right', acceptedAnswers: ['right'] },
      ],
    });

    const normalized = normalizeTableCompletionBlock(block);

    expect(normalized.cells).toHaveLength(2);
    expect(normalized.cells[0]?.correctAnswer).toBe('left');
    expect(normalized.cells[1]?.correctAnswer).toBe('right');
    expect(normalized.cells.map((cell) => cell.id)).toEqual(expect.arrayContaining(['dup-id']));
    expect(new Set(normalized.cells.map((cell) => cell.id)).size).toBe(2);

    const withMissingId = normalizeTableCompletionBlock({
      ...block,
      cells: [
        { id: '', row: 0, col: 0, correctAnswer: 'left' },
        { id: 'valid-id', row: 0, col: 2, correctAnswer: 'right' },
      ],
    });

    expect(withMissingId.cells[0]?.id).not.toBe('');
    expect(withMissingId.cells[0]?.id).toBeTruthy();
  });

  it('creates separate canonical answer slots for multiple placeholders in one cell', () => {
    const block = buildTableBlock({
      headers: ['A', 'B'],
      rows: [['Label', '____, ____']],
      cells: [{ id: 'cell-1', row: 0, col: 1, correctAnswer: 'first' }],
    });

    const normalized = normalizeTableCompletionBlock(block);
    const canonical = getCanonicalTableCells(normalized);

    expect(canonical).toHaveLength(2);
    expect(canonical[0]).toMatchObject({ row: 0, col: 1, placeholderIndex: 0, correctAnswer: 'first' });
    expect(canonical[1]).toMatchObject({ row: 0, col: 1, placeholderIndex: 1 });
    expect(canonical[1]?.id).not.toBe(canonical[0]?.id);
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

  it('detects and trims suspicious long table cell content while keeping placeholders', () => {
    const polluted = `Paragraph A.\nParagraph B.\nParagraph C.\nParagraph D.\n${'x'.repeat(280)} ____ , ____`;
    expect(isSuspiciousTableCellContent(polluted)).toBe(true);

    const trimmed = trimSuspiciousTableCellContent(polluted, 80);
    expect(trimmed.length).toBeLessThan(polluted.length);
    expect(trimmed).toContain('____');
    expect(trimmed.match(/_{2,}/g)?.length).toBe(2);
  });

  it('detects and trims suspicious long table cell content without placeholders', () => {
    const polluted = `${'This is a copied passage sentence. '.repeat(30)}\n${'Another line. '.repeat(20)}`.trim();
    expect(isSuspiciousTableCellContent(polluted)).toBe(true);

    const trimmed = trimSuspiciousTableCellContent(polluted, 80);
    expect(trimmed.length).toBeLessThan(polluted.length);
    expect(trimmed).toContain('…');
  });
});
