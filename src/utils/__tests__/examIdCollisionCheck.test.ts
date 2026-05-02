import { describe, expect, it } from 'vitest';
import type { TFNGBlock, TableCompletionBlock } from '../../types';
import { createInitialExamState } from '../../services/examAdapterService';
import { getExamIdCollisionIssues } from '../examIdCollisionCheck';

describe('examIdCollisionCheck', () => {
  it('detects duplicate answer keys for single-slot questions', () => {
    const state = createInitialExamState('Title', 'Academic', 'Academic');
    const duplicateQuestionId = 'q-dup';

    const blockA: TFNGBlock = {
      id: 'blk-a',
      type: 'TFNG',
      mode: 'TFNG',
      instruction: 'Instruction',
      questions: [{ id: duplicateQuestionId, statement: 'A', correctAnswer: 'T' }],
    };

    const blockB: TFNGBlock = {
      id: 'blk-b',
      type: 'TFNG',
      mode: 'TFNG',
      instruction: 'Instruction',
      questions: [{ id: duplicateQuestionId, statement: 'B', correctAnswer: 'F' }],
    };

    state.reading.passages[0]!.blocks = [blockA, blockB];

    const issues = getExamIdCollisionIssues(state);
    expect(issues.some((issue) => issue.field === 'integrity.answer_key_scalar_collision')).toBe(true);
  });

  it('detects duplicate block IDs even when answer keys differ', () => {
    const state = createInitialExamState('Title', 'Academic', 'Academic');

    const blockA: TFNGBlock = {
      id: 'blk-dup',
      type: 'TFNG',
      mode: 'TFNG',
      instruction: 'Instruction',
      questions: [{ id: 'q-a', statement: 'A', correctAnswer: 'T' }],
    };

    const blockB: TFNGBlock = {
      id: 'blk-dup',
      type: 'TFNG',
      mode: 'TFNG',
      instruction: 'Instruction',
      questions: [{ id: 'q-b', statement: 'B', correctAnswer: 'F' }],
    };

    state.reading.passages[0]!.blocks = [blockA, blockB];

    const issues = getExamIdCollisionIssues(state);
    expect(issues.some((issue) => issue.field === 'integrity.duplicate_block_ids')).toBe(true);
  });

  it('detects duplicate indexed answer slots (same answerKey + index)', () => {
    const state = createInitialExamState('Title', 'Academic', 'Academic');
    const duplicateBlockId = 'blk-indexed';

    const tableBlockA: TableCompletionBlock = {
      id: duplicateBlockId,
      type: 'TABLE_COMPLETION',
      instruction: 'Instruction',
      answerRule: 'ONE_WORD',
      headers: ['A', 'B'],
      rows: [['', '']],
      cells: [{ id: 'cell-1', correctAnswer: 'x', row: 0, col: 0 }],
    };

    const tableBlockB: TableCompletionBlock = {
      id: duplicateBlockId,
      type: 'TABLE_COMPLETION',
      instruction: 'Instruction',
      answerRule: 'ONE_WORD',
      headers: ['A', 'B'],
      rows: [['', '']],
      cells: [{ id: 'cell-2', correctAnswer: 'y', row: 0, col: 0 }],
    };

    state.reading.passages[0]!.blocks = [tableBlockA, tableBlockB];

    const issues = getExamIdCollisionIssues(state);
    expect(issues.some((issue) => issue.field === 'integrity.answer_key_index_collision')).toBe(true);
  });

  it('warns when table completion cells have duplicate or missing IDs', () => {
    const state = createInitialExamState('Title', 'Academic', 'Academic');

    const tableBlock: TableCompletionBlock = {
      id: 'tbl-id-health',
      type: 'TABLE_COMPLETION',
      instruction: 'Instruction',
      answerRule: 'ONE_WORD',
      headers: ['A', 'B', 'C'],
      rows: [['____', '', '____']],
      cells: [
        { id: 'dup-id', correctAnswer: 'left', row: 0, col: 0 },
        { id: 'dup-id', correctAnswer: 'right', row: 0, col: 2 },
      ],
    };

    state.reading.passages[0]!.blocks = [tableBlock];

    const issues = getExamIdCollisionIssues(state);
    expect(issues.some((issue) => issue.field === 'integrity.table_cell_id_collision')).toBe(true);

    const withMissing: TableCompletionBlock = {
      ...tableBlock,
      cells: [
        { id: '', correctAnswer: 'left', row: 0, col: 0 },
        { id: 'ok-id', correctAnswer: 'right', row: 0, col: 2 },
      ],
    };

    state.reading.passages[0]!.blocks = [withMissing];

    const missingIssues = getExamIdCollisionIssues(state);
    expect(missingIssues.some((issue) => issue.field === 'integrity.table_cell_id_missing')).toBe(true);
  });
});
