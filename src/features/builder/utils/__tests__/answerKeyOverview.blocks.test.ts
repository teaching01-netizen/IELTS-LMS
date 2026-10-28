import { describe, expect, it } from 'vitest';
import type { QuestionBlock } from '../../../../types';
import { applyAnswerKeyEdit, type AnswerKeyRow } from '../answerKeyOverview';
import { baseAnswerKeyState } from './answerKeyFixture';

// Characterizes the per-block-type answer edits so the typed reducer keeps the
// exact output of the untyped one, including stored blocks missing a collection.
function apply(block: unknown, edit: Parameters<typeof applyAnswerKeyEdit>[2]) {
  const state = baseAnswerKeyState();
  state.reading.passages[0]!.blocks.push(block as QuestionBlock);
  const row = { blockId: 'block-1', moduleType: 'reading', groupId: 'passage-1' } as AnswerKeyRow;
  return applyAnswerKeyEdit(state, row, edit).reading.passages[0]!.blocks[0] as unknown as Record<string, unknown>;
}

describe('answerKeyOverview.applyAnswerKeyEdit per block type', () => {
  it('sets a TFNG answer on the targeted question only', () => {
    const next = apply(
      { id: 'block-1', type: 'TFNG', instruction: '', mode: 'TFNG', questions: [{ id: 'q1', statement: 'a', correctAnswer: 'T' }, { id: 'q2', statement: 'b', correctAnswer: 'T' }] },
      { kind: 'set_tfng', questionId: 'q2', value: 'NG' },
    );
    expect(next.questions).toEqual([{ id: 'q1', statement: 'a', correctAnswer: 'T' }, { id: 'q2', statement: 'b', correctAnswer: 'NG' }]);
  });

  it('sets a MAP text answer', () => {
    const next = apply(
      { id: 'block-1', type: 'MAP', instruction: '', assetUrl: '', questions: [{ id: 'q1', label: 'A', correctAnswer: '', x: 0, y: 0 }] },
      { kind: 'set_text_answer', questionId: 'q1', value: 'bank' },
    );
    expect(next.questions).toEqual([{ id: 'q1', label: 'A', correctAnswer: 'bank', x: 0, y: 0 }]);
  });

  it('leaves a non-text block unchanged for a text answer edit', () => {
    const block = { id: 'block-1', type: 'FLOW_CHART', instruction: '', steps: [] };
    expect(apply(block, { kind: 'set_text_answer', questionId: 'q1', value: 'x' })).toEqual(block);
  });

  it('sets a diagram label and a flow step by index', () => {
    const diagram = apply(
      { id: 'block-1', type: 'DIAGRAM_LABELING', instruction: '', imageUrl: '', labels: [{ id: 'l1', x: 0, y: 0, correctAnswer: '' }, { id: 'l2', x: 1, y: 1, correctAnswer: '' }] },
      { kind: 'set_diagram_label_answer', labelIndex: 1, value: 'valve' },
    );
    expect(diagram.labels).toEqual([{ id: 'l1', x: 0, y: 0, correctAnswer: '' }, { id: 'l2', x: 1, y: 1, correctAnswer: 'valve' }]);
    const flow = apply(
      { id: 'block-1', type: 'FLOW_CHART', instruction: '', steps: [{ id: 's1', label: 'S', correctAnswer: '' }] },
      { kind: 'set_flow_step_answer', stepIndex: 0, value: 'heat' },
    );
    expect(flow.steps).toEqual([{ id: 's1', label: 'S', correctAnswer: 'heat' }]);
  });

  it('turns a missing stored collection into an empty one instead of throwing', () => {
    expect(apply({ id: 'block-1', type: 'DIAGRAM_LABELING', instruction: '', imageUrl: '' }, { kind: 'set_diagram_label_answer', labelIndex: 0, value: 'x' }).labels).toEqual([]);
    expect(apply({ id: 'block-1', type: 'FLOW_CHART', instruction: '' }, { kind: 'set_flow_step_answer', stepIndex: 0, value: 'x' }).steps).toEqual([]);
    expect(apply({ id: 'block-1', type: 'TABLE_COMPLETION', instruction: '', headers: [], rows: [], answerRule: 'ONE_WORD' }, { kind: 'set_table_cell_accepted_answer_fields', cellIndex: 0, acceptedAnswers: ['x'] }).cells).toEqual([]);
    expect(apply({ id: 'block-1', type: 'NOTE_COMPLETION', instruction: '' }, { kind: 'set_note_blank_accepted_answer_fields', questionId: 'q1', blankIndex: 0, acceptedAnswers: ['x'] }).questions).toEqual([]);
  });

  it('writes accepted answer fields to a table cell and to sentence and note blanks', () => {
    const table = apply(
      { id: 'block-1', type: 'TABLE_COMPLETION', instruction: '', headers: [], rows: [], answerRule: 'ONE_WORD', cells: [{ id: 'c1', correctAnswer: '', row: 0, col: 0 }] },
      { kind: 'set_table_cell_accepted_answer_fields', cellIndex: 0, acceptedAnswers: ['Rome', 'rome'] },
    );
    expect(table.cells).toEqual([{ id: 'c1', correctAnswer: 'Rome', acceptedAnswers: ['Rome', 'rome'], row: 0, col: 0 }]);

    for (const type of ['SENTENCE_COMPLETION', 'NOTE_COMPLETION'] as const) {
      const kind = type === 'SENTENCE_COMPLETION' ? 'set_sentence_blank_accepted_answer_fields' : 'set_note_blank_accepted_answer_fields';
      const next = apply(
        {
          id: 'block-1',
          type,
          instruction: '',
          questions: [
            { id: 'q1', blanks: [{ id: 'b1', correctAnswer: '', position: 0 }, { id: 'b2', correctAnswer: '', position: 1 }], answerRule: 'ONE_WORD' },
            { id: 'q2', answerRule: 'ONE_WORD' },
          ],
        },
        { kind, questionId: 'q1', blankIndex: 1, acceptedAnswers: ['oxygen'] },
      );
      expect(next.questions).toEqual([
        { id: 'q1', blanks: [{ id: 'b1', correctAnswer: '', position: 0 }, { id: 'b2', correctAnswer: 'oxygen', acceptedAnswers: ['oxygen'], position: 1 }], answerRule: 'ONE_WORD' },
        { id: 'q2', answerRule: 'ONE_WORD' },
      ]);
      // A question stored without blanks gains an empty list when targeted.
      const bare = apply(
        { id: 'block-1', type, instruction: '', questions: [{ id: 'q1', answerRule: 'ONE_WORD' }] },
        { kind, questionId: 'q1', blankIndex: 0, acceptedAnswers: ['x'] },
      );
      expect(bare.questions).toEqual([{ id: 'q1', answerRule: 'ONE_WORD', blanks: [] }]);
    }
  });
});
