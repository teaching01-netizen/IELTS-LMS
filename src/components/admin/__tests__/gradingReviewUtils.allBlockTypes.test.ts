import { describe, expect, test } from 'vitest';
import {
  createInitialExamState,
  getStudentQuestionsForModule,
} from '../../../services/examAdapterService';
import type { StudentQuestionDescriptor } from '../../../services/examAdapterService';
import type { ExamState } from '../../../types';
import type { SectionSubmission } from '../../../types/grading';
import { buildQuestionTracebackGroups } from '../gradingReviewUtils';

/**
 * The review lost the student's answers for every block type, which is the
 * signature of a broken answer-map boundary rather than eleven separate
 * rendering bugs. These tests read the traceback through both shapes that
 * boundary can produce:
 *
 *  - delivery shape: the client saves ONE value under the block id — a scalar
 *    for single-answer blocks, an array indexed by slot for the rest;
 *  - grading shape: the projection saves one value per canonical question id
 *    ("block:slot").
 *
 * If a block type stops resolving in either shape, its answer disappears from
 * review and from scoring, so each block is asserted individually.
 */

function emptyExam(): ExamState {
  const state = createInitialExamState('All blocks', 'Academic');
  state.reading.passages = [];
  return state;
}

/** One reading passage whose blocks cover every objective IELTS block type. */
function readBlocks(): any[] {
  return [
    {
      id: 'tfng', type: 'TFNG', instruction: 'Choose TRUE, FALSE or NOT GIVEN.',
      questions: [{ id: 'tfng-q1', statement: 'The town has a bridge.', correctAnswer: 'TRUE' }],
    },
    {
      id: 'short', type: 'SHORT_ANSWER', instruction: 'Answer the question.',
      questions: [{ id: 'short-q1', prompt: 'What is it?', correctAnswer: 'wood', answerRule: 'ONE_WORD' }],
    },
    {
      id: 'sentence', type: 'SENTENCE_COMPLETION', instruction: 'Complete the sentence.',
      questions: [{
        id: 'sentence-q1', sentence: 'The ___ was built in the ___.', answerRule: 'ONE_WORD',
        blanks: [
          { id: 'sentence-b1', correctAnswer: 'bridge', position: 0 },
          { id: 'sentence-b2', correctAnswer: '1890', position: 1 },
        ],
      }],
    },
    {
      id: 'note', type: 'NOTE_COMPLETION', instruction: 'Complete the notes.',
      questions: [{
        id: 'note-q1', noteText: 'Venue: ___', answerRule: 'TWO_WORDS',
        blanks: [{ id: 'note-b1', correctAnswer: 'garden hall', position: 0 }],
      }],
    },
    {
      id: 'single', type: 'SINGLE_MCQ', instruction: 'Choose the best answer.', stem: 'Pick one',
      questions: [{
        id: 'single-q1', stem: 'Pick one',
        options: [
          { id: 'single-a', text: 'Alpha', isCorrect: true },
          { id: 'single-b', text: 'Beta', isCorrect: false },
        ],
      }],
    },
    {
      id: 'multi', type: 'MULTI_MCQ', instruction: 'Choose two.', stem: 'Pick two', requiredSelections: 2,
      options: [
        { id: 'multi-a', text: 'Alpha', isCorrect: true },
        { id: 'multi-b', text: 'Beta', isCorrect: true },
        { id: 'multi-c', text: 'Charlie', isCorrect: false },
      ],
    },
    {
      id: 'diagram', type: 'DIAGRAM_LABELING', instruction: 'Label the diagram.', imageUrl: 'img.png',
      labels: [{ id: 'diagram-l1', correctAnswer: 'valve' }],
    },
    {
      id: 'flow', type: 'FLOW_CHART', instruction: 'Complete the flow chart.',
      steps: [{ id: 'flow-s1', label: 'Step', correctAnswer: 'filter' }],
    },
    {
      id: 'table', type: 'TABLE_COMPLETION', instruction: 'Complete the table.',
      headers: ['Answer'], rows: [['']],
      cells: [{ id: 'table-c1', row: 0, col: 0, correctAnswer: 'faces of china' }],
    },
    {
      id: 'classification', type: 'CLASSIFICATION', instruction: 'Classify each item.',
      categories: ['A', 'B'],
      items: [{ id: 'class-i1', text: 'Item one', correctCategory: 'A' }],
    },
    {
      id: 'features', type: 'MATCHING_FEATURES', instruction: 'Match each feature.',
      options: ['Option A', 'Option B'],
      features: [{ id: 'feature-f1', text: 'Feature one', correctMatch: 'Option A' }],
    },
  ];
}

function examWithBlocks(): ExamState {
  const state = emptyExam();
  state.reading.passages = [{
    id: 'passage-1', title: 'Passage 1', content: 'Content', images: [], wordCount: 1,
    blocks: readBlocks(),
  }] as any;
  return state;
}

/** The client's save shape: scalar at the block id, or an array of slots. */
function deliveryAnswers(
  descriptors: StudentQuestionDescriptor[],
  valueFor: (descriptor: StudentQuestionDescriptor) => string,
): Record<string, any> {
  const answers: Record<string, any> = {};
  for (const descriptor of descriptors) {
    const value = valueFor(descriptor);
    if (descriptor.answerIndex === undefined) {
      answers[descriptor.answerKey] = descriptor.isMulti ? [value] : value;
      continue;
    }
    const slots: string[] = Array.isArray(answers[descriptor.answerKey])
      ? answers[descriptor.answerKey]
      : [];
    slots[descriptor.answerIndex] = value;
    answers[descriptor.answerKey] = slots;
  }
  return answers;
}

/** The projection's save shape: one canonical id per question/slot. */
function gradingAnswers(
  descriptors: StudentQuestionDescriptor[],
  valueFor: (descriptor: StudentQuestionDescriptor) => string,
): Record<string, any> {
  const answers: Record<string, any> = {};
  for (const descriptor of descriptors) {
    const value = valueFor(descriptor);
    answers[descriptor.id] = descriptor.isMulti ? [value] : value;
  }
  return answers;
}

function submission(answers: Record<string, any>): SectionSubmission {
  return {
    id: 'section-reading',
    submissionId: 'sub-1',
    section: 'reading',
    answers: { type: 'reading', answers },
    gradingStatus: 'auto_graded',
    submittedAt: '2026-01-01T00:00:00.000Z',
  } as any;
}

/** Every value the traceback displays as the student's answer, per question id. */
function displayedStudentAnswers(examState: ExamState, answers: Record<string, any>): Map<string, string> {
  const displayed = new Map<string, string>();
  for (const group of buildQuestionTracebackGroups(examState, submission(answers), 'reading')) {
    for (const item of group.items) {
      const slots = item.studentAnswerSlots?.join(' | ') ?? '';
      displayed.set(item.questionId, [item.studentAnswer ?? '', slots].join(' | '));
    }
  }
  return displayed;
}

describe('question traceback keeps saved answers for every block type', () => {
  test('delivery-shaped answers (block key, slot arrays) survive review', () => {
    const examState = examWithBlocks();
    const descriptors = getStudentQuestionsForModule(examState, 'reading');
    expect(descriptors.length).toBeGreaterThanOrEqual(11);

    const saved = deliveryAnswers(descriptors, (descriptor) => `delivered-${descriptor.id}`);
    const displayed = displayedStudentAnswers(examState, saved);

    const missing = descriptors
      .map((descriptor) => descriptor.id)
      .filter((questionId) => !(displayed.get(questionId) ?? '').includes(`delivered-${questionId}`));
    expect(missing).toEqual([]);
    expect(displayed.size).toBeGreaterThanOrEqual(descriptors.length);
  });

  test('grading-shaped answers (canonical question ids) survive review', () => {
    const examState = examWithBlocks();
    const descriptors = getStudentQuestionsForModule(examState, 'reading');

    const saved = gradingAnswers(descriptors, (descriptor) => `projected-${descriptor.id}`);
    const displayed = displayedStudentAnswers(examState, saved);

    const missing = descriptors
      .map((descriptor) => descriptor.id)
      .filter((questionId) => !(displayed.get(questionId) ?? '').includes(`projected-${questionId}`));
    expect(missing).toEqual([]);
  });

  test('no block type renders an empty student answer when one was saved', () => {
    const examState = examWithBlocks();
    const descriptors = getStudentQuestionsForModule(examState, 'reading');
    const saved = deliveryAnswers(descriptors, () => 'saved');

    // Control: with the answer map empty every item must read as unanswered.
    // Without it this test could pass on a panel that ignores the map entirely.
    for (const group of buildQuestionTracebackGroups(examState, submission({}), 'reading')) {
      for (const item of group.items) {
        expect(`${item.studentAnswer ?? ''}${(item.studentAnswerSlots ?? []).join('')}`.trim()).toBe('');
      }
    }

    for (const group of buildQuestionTracebackGroups(examState, submission(saved), 'reading')) {
      for (const item of group.items) {
        const shown = `${item.studentAnswer ?? ''}${(item.studentAnswerSlots ?? []).join('')}`;
        expect(shown.trim(), `block type lost its answer: ${item.questionId}`).not.toBe('');
        expect(shown).not.toBe('—');
      }
    }
  });
});
