import type { ExamState } from '../../../../types';

/** A minimal valid IELTS exam with one empty reading passage and listening part. */
export function baseAnswerKeyState(): ExamState {
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
        tabSwitchRule: 'none',
        detectSecondaryScreen: false,
        blockClipboard: false,
        antiScreenshotGuardEnabled: false,
        preventAutofill: true,
        preventAutocorrect: true,
        preventTranslation: false,
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
