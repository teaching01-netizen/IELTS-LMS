import { describe, expect, it } from 'vitest';
import type { ExamState } from '../../../../types';
import { applyAnswerKeyEdit, type AnswerKeyRow } from '../answerKeyOverview';
import { resolveAcceptedAnswers } from '../../../../utils/acceptedAnswers';

function baseState(): ExamState {
  return {
    title: 'Exam',
    type: 'Academic',
    activeModule: 'reading',
    activePassageId: 'passage-1',
    activeListeningPartId: 'part-1',
    config: {
      general: {
        preset: 'Academic',
        type: 'Academic',
        ieltsMode: true,
        title: 'Exam',
        summary: '',
        instructions: '',
      },
      sections: {
        listening: {
          enabled: true,
          label: 'Listening',
          duration: 30,
          order: 1,
          gapAfterMinutes: 0,
          allowedQuestionTypes: [],
          partCount: 1,
          bandScoreTable: {},
        },
        reading: {
          enabled: true,
          label: 'Reading',
          duration: 60,
          order: 2,
          gapAfterMinutes: 0,
          allowedQuestionTypes: [],
          passageCount: 1,
          bandScoreTable: {},
        },
        writing: {
          enabled: false,
          label: 'Writing',
          duration: 60,
          order: 3,
          gapAfterMinutes: 0,
          allowedQuestionTypes: [],
          tasks: [],
          rubricWeights: { taskResponse: 0, coherence: 0, lexical: 0, grammar: 0 },
        },
        speaking: {
          enabled: false,
          label: 'Speaking',
          duration: 15,
          order: 4,
          gapAfterMinutes: 0,
          allowedQuestionTypes: [],
          parts: [],
          rubricWeights: { fluency: 0, lexical: 0, grammar: 0, pronunciation: 0 },
        },
      },
      standards: {
        passageWordCount: { optimalMin: 0, optimalMax: 0, warningMin: 0, warningMax: 0 },
        writingTasks: { task1: { minWords: 0, recommendedTime: 0 }, task2: { minWords: 0, recommendedTime: 0 } },
        rubricDeviationThreshold: 0,
        rubricWeights: {
          writing: { taskResponse: 0, coherence: 0, lexical: 0, grammar: 0 },
          speaking: { fluency: 0, lexical: 0, grammar: 0, pronunciation: 0 },
        },
        bandScoreTables: { listening: {}, readingAcademic: {}, readingGeneralTraining: {} },
      },
      progression: { autoSubmit: false, lockAfterSubmit: false, allowPause: true, showWarnings: true, warningThreshold: 0 },
      delivery: { launchMode: 'proctor_start', transitionMode: 'auto_with_proctor_override', allowedExtensionMinutes: [] },
      scoring: { overallRounding: 'nearest-0.5' },
      security: {
        requireFullscreen: false,
        tabSwitchRule: 'none',
        detectSecondaryScreen: false,
        blockClipboard: false,
        antiScreenshotGuardEnabled: false,
        preventAutofill: true,
        preventAutocorrect: true,
        preventTranslation: false,
        fullscreenAutoReentry: false,
        fullscreenMaxViolations: 0,
        proctoringFlags: { webcam: false, audio: false, screen: false },
      },
    },
    reading: {
      passages: [
        {
          id: 'passage-1',
          title: 'Passage 1',
          content: '',
          blocks: [],
          wordCount: 0,
        },
      ],
    },
    listening: {
      parts: [
        {
          id: 'part-1',
          title: 'Part 1',
          pins: [],
          blocks: [],
        },
      ],
    },
    writing: {
      task1Prompt: '',
      task2Prompt: '',
    },
    speaking: {
      part1Topics: [],
      cueCard: '',
      part3Discussion: [],
    },
  };
}

describe('answerKeyOverview.applyAnswerKeyEdit', () => {
  it('updates short answer accepted answers using accepted answer fields (correctAnswer + acceptedAnswers)', () => {
    const state = baseState();
    state.reading.passages[0]!.blocks.push({
      id: 'block-1',
      type: 'SHORT_ANSWER',
      instruction: '',
      questions: [
        { id: 'q1', prompt: 'P', correctAnswer: '', acceptedAnswers: [], answerRule: 'ONE_WORD' },
      ],
    } as any);

    const row: AnswerKeyRow = {
      rowId: 'reading:q1',
      moduleType: 'reading',
      groupId: 'passage-1',
      groupLabel: 'Passage 1',
      blockId: 'block-1',
      blockType: 'SHORT_ANSWER',
      descriptorId: 'q1',
      answerKey: 'q1',
      numberLabel: 'Q1',
      prompt: 'P',
      sortKey: 'reading:1:1:0',
      jumpField: 'content.reading.passages[0].blocks[0]',
    };

    const next = applyAnswerKeyEdit(state, row, {
      kind: 'set_accepted_answer_fields',
      questionId: 'q1',
      acceptedAnswers: ['Alpha', 'alpha', 'beta'],
    });

    const q = (next.reading.passages[0]!.blocks[0] as any).questions[0];
    expect(resolveAcceptedAnswers(q)).toEqual(['Alpha', 'beta']);
    expect(q.correctAnswer).toBe('Alpha');
    expect(q.acceptedAnswers).toEqual(['Alpha', 'beta']);
  });

  it('updates single MCQ so exactly one option is correct', () => {
    const state = baseState();
    state.reading.passages[0]!.blocks.push({
      id: 'mcq-1',
      type: 'SINGLE_MCQ',
      instruction: '',
      stem: 'S',
      options: [
        { id: 'a', text: 'A', isCorrect: true },
        { id: 'b', text: 'B', isCorrect: false },
      ],
      questions: [
        { id: 'q1', stem: 'Q1', options: [
          { id: 'a', text: 'A', isCorrect: true },
          { id: 'b', text: 'B', isCorrect: false },
        ] },
      ],
    } as any);

    const row: AnswerKeyRow = {
      rowId: 'reading:q1',
      moduleType: 'reading',
      groupId: 'passage-1',
      groupLabel: 'Passage 1',
      blockId: 'mcq-1',
      blockType: 'SINGLE_MCQ',
      descriptorId: 'q1',
      answerKey: 'q1',
      numberLabel: 'Q1',
      prompt: 'Q1',
      sortKey: 'reading:1:1:0',
      jumpField: 'content.reading.passages[0].blocks[0]',
    };

    const next = applyAnswerKeyEdit(state, row, {
      kind: 'set_single_mcq_correct',
      questionId: 'q1',
      optionId: 'b',
    });

    const block = next.reading.passages[0]!.blocks[0] as any;
    const q = block.questions[0];
    expect(q.options.find((o: any) => o.id === 'a')?.isCorrect).toBe(false);
    expect(q.options.find((o: any) => o.id === 'b')?.isCorrect).toBe(true);
  });

  it('updates sub-answer tree leaf accepted answers for the targeted leaf', () => {
    const state = baseState();
    state.reading.passages[0]!.blocks.push({
      id: 'tree-block',
      type: 'CLOZE',
      instruction: '',
      answerRule: 'ONE_WORD',
      subAnswerModeEnabled: true,
      answerTree: [
        {
          id: 'root-a',
          label: 'Root prompt',
          children: [
            { id: 'leaf-a', acceptedAnswers: ['one'] },
            { id: 'leaf-b', acceptedAnswers: ['two'] },
          ],
        },
      ],
      questions: [{ id: 'ignored-q', prompt: 'x', correctAnswer: '', acceptedAnswers: [] }],
    } as any);

    const row: AnswerKeyRow = {
      rowId: 'reading:tree-block::tree::root-a::leaf-a',
      moduleType: 'reading',
      groupId: 'passage-1',
      groupLabel: 'Passage 1',
      blockId: 'tree-block',
      blockType: 'CLOZE',
      descriptorId: 'tree-block::tree::root-a::leaf-a',
      answerKey: 'tree-block::tree::root-a::leaf-a',
      numberLabel: 'Q1.1',
      prompt: 'Root prompt',
      sortKey: 'reading:1:1.1:0',
      jumpField: 'content.reading.passages[0].blocks[0]',
    };

    const next = applyAnswerKeyEdit(state, row, {
      kind: 'set_sub_answer_leaf_accepted_answers',
      leafId: 'tree-block::tree::root-a::leaf-a',
      acceptedAnswers: ['alpha'],
    });

    const tree = (next.reading.passages[0]!.blocks[0] as any).answerTree;
    expect(tree[0].children[0].acceptedAnswers).toEqual(['alpha']);
    expect(tree[0].children[1].acceptedAnswers).toEqual(['two']);
  });
});

