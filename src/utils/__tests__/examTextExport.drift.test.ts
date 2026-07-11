import { describe, expect, it } from 'vitest';
import { createInitialExamState } from '../../services/examAdapterService';
import { enumerateBlockQuestionUnits } from '../examUtils';
import type { Exam, QuestionBlock, SingleMCQBlock } from '../../types';
import { buildExamTextExport } from '../examTextExport';

/**
 * Counts the number of question entries in the exported answer-key sections.
 * Each rendered question produces exactly one `Q<n> -> answer` line.
 */
function countExportedAnswerKeys(output: string): number {
  return output
    .split('\n')
    .filter((line) => /^Q[\d-]+ -> /.test(line.trim()))
    .length;
}

/**
 * The number of rows the export must produce: exactly one per enumerated
 * question unit. MULTI_MCQ contributes one row that spans `requiredSelections`
 * slots (rendered as `Q1-2`), which is why `enumerateBlockQuestionUnits`
 * returns a single unit for it.
 */
function expectedExportedRows(exam: Exam): number {
  const blocks: QuestionBlock[] = [
    ...exam.content.reading.passages.flatMap((p) => p.blocks),
    ...exam.content.listening.parts.flatMap((p) => p.blocks),
  ];
  return blocks.reduce((acc, block) => acc + enumerateBlockQuestionUnits(block).length, 0);
}

function buildAllTypesExam(id: string): Exam {
  const state = createInitialExamState('All Types', 'Academic', 'Academic');
  state.reading.passages = [
    {
      id: 'passage-1',
      title: 'Passage One',
      content: '<p>Alpha beta.</p>',
      images: [],
      wordCount: 2,
      blocks: [
        { id: 'r-tfng', type: 'TFNG', mode: 'TFNG', instruction: '', questions: [
          { id: 'q1', statement: 'S1', correctAnswer: 'T' },
          { id: 'q2', statement: 'S2', correctAnswer: 'F' },
        ] },
        { id: 'r-cloze', type: 'CLOZE', instruction: '', answerRule: 'ONE_WORD', questions: [
          { id: 'q1', prompt: 'P1', correctAnswer: 'A' },
        ] },
        { id: 'r-matching', type: 'MATCHING', instruction: '', headings: [{ id: 'i', text: 'H' }], questions: [
          { id: 'q1', paragraphLabel: 'A', correctHeading: 'i' },
        ] },
        { id: 'r-map', type: 'MAP', instruction: '', assetUrl: 'img', questions: [
          { id: 'q1', label: 'L1', correctAnswer: 'A', x: 1, y: 2 },
        ] },
        { id: 'r-multi', type: 'MULTI_MCQ', instruction: '', stem: 'Pick two', requiredSelections: 2, options: [
          { id: 'o1', text: 'A', isCorrect: true },
          { id: 'o2', text: 'B', isCorrect: true },
        ] },
        { id: 'r-single', type: 'SINGLE_MCQ', instruction: '', stem: 'Block stem', options: [
          { id: 'o1', text: 'A', isCorrect: true },
        ] },
        { id: 'r-short', type: 'SHORT_ANSWER', instruction: '', questions: [
          { id: 'q1', prompt: 'P1', correctAnswer: 'A', answerRule: 'ONE_WORD' },
        ] },
        { id: 'r-sentence', type: 'SENTENCE_COMPLETION', instruction: '', questions: [
          { id: 'q1', sentence: 'The __ fox', blanks: [
            { id: 'b1', correctAnswer: 'quick', answerRule: 'ONE_WORD' },
            { id: 'b2', correctAnswer: 'brown', answerRule: 'ONE_WORD' },
          ] },
        ] },
        { id: 'r-diagram', type: 'DIAGRAM_LABELING', instruction: '', imageUrl: 'img', labels: [
          { id: 'l1', correctAnswer: 'A' },
        ] },
        { id: 'r-flow', type: 'FLOW_CHART', instruction: '', steps: [
          { id: 's1', label: 'Step', correctAnswer: 'A' },
        ] },
        { id: 'r-table', type: 'TABLE_COMPLETION', instruction: '', headers: ['H1'], rows: [['c1']], cells: [
          { id: 'c1', correctAnswer: 'A' },
        ] },
        { id: 'r-note', type: 'NOTE_COMPLETION', instruction: '', questions: [
          { id: 'q1', noteText: 'Note', blanks: [
            { id: 'b1', correctAnswer: 'A', answerRule: 'ONE_WORD' },
          ] },
        ] },
        { id: 'r-classification', type: 'CLASSIFICATION', instruction: '', categories: ['A'], items: [
          { id: 'i1', text: 'Item', correctCategory: 'A' },
        ] },
        { id: 'r-matching-features', type: 'MATCHING_FEATURES', instruction: '', options: ['A'], features: [
          { id: 'f1', text: 'Feat', correctMatch: 'A' },
        ] },
      ],
    },
  ];
  state.listening.parts = [
    {
      id: 'part-1',
      title: 'Part One',
      audioUrl: 'audio',
      pins: [],
      blocks: [
        { id: 'l-tfng', type: 'TFNG', mode: 'TFNG', instruction: '', questions: [
          { id: 'q1', statement: 'S1', correctAnswer: 'T' },
        ] },
      ],
    },
  ];
  return {
    id,
    title: 'All Types',
    type: 'Academic',
    status: 'Draft',
    author: 'Admin',
    lastModified: '2026-07-11T00:00:00.000Z',
    createdAt: '2026-07-10T00:00:00.000Z',
    content: state,
  };
}

describe('exam text export vs enumerated question units (drift guard)', () => {
  it('renders exactly one row per enumerated question unit for every block type, including SINGLE_MCQ sub-questions', () => {
    const exam = buildAllTypesExam('exam-all');
    const singleMcq = exam.content.reading.passages[0]?.blocks.find(
      (b) => b.type === 'SINGLE_MCQ',
    ) as SingleMCQBlock | undefined;

    if (singleMcq) {
      singleMcq.questions = [
        { id: 'sq1', stem: 'Sub one', options: [{ id: 'a', text: 'A', isCorrect: true }] },
        { id: 'sq2', stem: 'Sub two', options: [{ id: 'b', text: 'B', isCorrect: true }] },
        { id: 'sq3', stem: 'Sub three', options: [{ id: 'c', text: 'C', isCorrect: true }] },
      ];
    }

    const output = buildExamTextExport([exam], new Date('2026-07-11T12:00:00.000Z'));

    const expectedRows = expectedExportedRows(exam);
    const exportedRows = countExportedAnswerKeys(output);

    expect(exportedRows).toBe(expectedRows);
  });
});
