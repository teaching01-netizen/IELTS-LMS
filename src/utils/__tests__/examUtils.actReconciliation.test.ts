import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../constants/examDefaults';
import {
  canPublishExam,
  getActScienceTotalQuestions,
  validateActScienceModule,
} from '../examUtils';
import { createActScienceBlock, createActScienceQuestion } from '../../components/ActScienceQuestionBuilderPane';
import type { ActScienceStimulus, Exam } from '../../types';

function buildActExam(questionCount: number): Exam {
  const questions = Array.from({ length: questionCount }, (_, index) => ({
    ...createActScienceQuestion(`question-${index + 1}`),
    stem: `Question ${index + 1}`,
  }));
  const block = createActScienceBlock('block-1');
  const stimulus: ActScienceStimulus = {
    id: 'stimulus-1',
    title: 'Experiment 1',
    content: '<p>Experiment data</p>',
    blocks: [
      {
        ...block,
        stem: questions[0]?.stem ?? '',
        options: questions[0]?.options ?? block.options,
        questions,
      },
    ],
  };
  const state = {
    title: 'ACT Science Practice',
    type: 'ACT' as const,
    activeModule: 'science' as const,
    activePassageId: '',
    activeListeningPartId: '',
    activeScienceStimulusId: stimulus.id,
    config: createDefaultConfig('ACT', 'ACT Science'),
    reading: { passages: [] },
    listening: { parts: [] },
    writing: { task1Prompt: '', task2Prompt: '', part3Discussion: [], cueCard: '', part1Topics: [] },
    speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
    science: { stimuli: [stimulus] },
  };
  return {
    id: 'exam-1',
    title: state.title,
    type: 'ACT',
    status: 'Draft',
    author: 'Admin',
    lastModified: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    content: state,
  };
}

describe('Phase 03 ACT reconciliation: examUtils', () => {
  it('counts SINGLE_MCQ sub-questions via the canonical block count model', () => {
    const block = createActScienceBlock('block-count');
    const stimulus: ActScienceStimulus = {
      id: 'stim-count',
      title: 'Counting',
      content: 'Content',
      blocks: [
        { ...block, questions: [createActScienceQuestion('qc-1'), createActScienceQuestion('qc-2')] },
      ],
    };
    expect(getActScienceTotalQuestions([stimulus])).toBe(2);
  });

  it('allows a 10-question draft to publish with a non-blocking 40-question warning', () => {
    const exam = buildActExam(10);
    const validation = validateActScienceModule(exam.content.science.stimuli);
    expect(getActScienceTotalQuestions(exam.content.science.stimuli)).toBe(10);
    expect(validation.some((error) => error.type === 'error')).toBe(false);
    expect(validation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'warning',
          field: 'science.questions',
          message: expect.stringContaining('full-set target is 40'),
        }),
      ]),
    );
    expect(canPublishExam(exam).canPublish).toBe(true);
  });

  it('emits no count warning at exactly 40 questions', () => {
    const exam = buildActExam(40);
    const validation = validateActScienceModule(exam.content.science.stimuli);
    expect(validation.filter((error) => error.field === 'science.questions')).toHaveLength(0);
    expect(canPublishExam(exam).canPublish).toBe(true);
  });

  it('blocks a non-SINGLE_MCQ block type instead of silently validating it', () => {
    const exam = buildActExam(1);
    const stimulus = exam.content.science.stimuli[0]!;
    const invalid = {
      ...exam,
      content: {
        ...exam.content,
        science: {
          stimuli: [
            {
              ...stimulus,
              blocks: [{ ...stimulus.blocks[0]!, type: 'TFNG' } as never],
            },
          ],
        },
      },
    };
    const validation = validateActScienceModule(invalid.content.science.stimuli);
    expect(validation).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'error' })]),
    );
    expect(canPublishExam(invalid).canPublish).toBe(false);
  });

  it('routes ACT exams through science validation, never reading/listening', () => {
    const exam = buildActExam(1);
    expect(canPublishExam(exam).canPublish).toBe(true);
  });

  it('keeps IELTS publish behavior unchanged', () => {
    const ielts = {
      title: 'IELTS',
      type: 'Academic',
      content: {
        reading: { passages: [] },
        listening: { parts: [] },
        science: { stimuli: [] },
      },
    } as unknown as Exam;
    const result = canPublishExam(ielts);
    expect(result.canPublish).toBe(false);
    expect(result.errors.some((error) => error.field === 'reading')).toBe(true);
  });
});
