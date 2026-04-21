import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LISTENING_BAND_TABLE,
  DEFAULT_READING_ACADEMIC_BAND_TABLE,
  DEFAULT_READING_GT_BAND_TABLE,
  createDefaultConfig,
  normalizeExamConfig,
} from '../examDefaults';

describe('examDefaults standards', () => {
  it('creates default standards for academic exams', () => {
    const config = createDefaultConfig('Academic', 'Academic');

    expect(config.security.blockClipboard).toBe(true);
    expect(config.standards.passageWordCount).toEqual({
      optimalMin: 700,
      optimalMax: 1000,
      warningMin: 500,
      warningMax: 1200,
    });
    expect(config.standards.writingTasks.task1).toEqual({
      minWords: 150,
      recommendedTime: 20,
    });
    expect(config.standards.writingTasks.task2).toEqual({
      minWords: 250,
      recommendedTime: 40,
    });
    expect(config.standards.rubricDeviationThreshold).toBe(10);
    expect(config.standards.bandScoreTables.listening).toEqual(DEFAULT_LISTENING_BAND_TABLE);
    expect(config.standards.bandScoreTables.readingAcademic).toEqual(DEFAULT_READING_ACADEMIC_BAND_TABLE);
    expect(config.standards.bandScoreTables.readingGeneralTraining).toEqual(DEFAULT_READING_GT_BAND_TABLE);
  });

  it('backfills standards from legacy section values', () => {
    const config = normalizeExamConfig({
      general: {
        type: 'General Training',
      },
      sections: {
        listening: {
          bandScoreTable: { 38: 9, 35: 8 },
        },
        reading: {
          bandScoreTable: { 34: 9, 30: 8 },
        },
        writing: {
          tasks: [
            { id: 'task1', label: 'Task 1', minWords: 180, recommendedTime: 25 },
            { id: 'task2', label: 'Task 2', minWords: 270, recommendedTime: 45 },
          ],
          rubricWeights: {
            taskResponse: 30,
            coherence: 20,
            lexical: 25,
            grammar: 25,
          },
        },
        speaking: {
          rubricWeights: {
            fluency: 20,
            lexical: 30,
            grammar: 25,
            pronunciation: 25,
          },
        },
      },
    });

    expect(config.standards.writingTasks.task1).toEqual({
      minWords: 180,
      recommendedTime: 25,
    });
    expect(config.standards.writingTasks.task2).toEqual({
      minWords: 270,
      recommendedTime: 45,
    });
    expect(config.standards.rubricWeights.writing).toEqual({
      taskResponse: 30,
      coherence: 20,
      lexical: 25,
      grammar: 25,
    });
    expect(config.standards.rubricWeights.speaking).toEqual({
      fluency: 20,
      lexical: 30,
      grammar: 25,
      pronunciation: 25,
    });
    expect(config.standards.bandScoreTables.listening).toEqual({ 38: 9, 35: 8 });
    expect(config.standards.bandScoreTables.readingGeneralTraining).toEqual({ 34: 9, 30: 8 });
    expect(config.sections.reading.bandScoreTable).toEqual({ 34: 9, 30: 8 });
  });

  it('enforces IELTS authentic mode policy', () => {
    const config = normalizeExamConfig({
      general: {
        ieltsMode: true,
      },
      sections: {
        listening: { duration: 10, gapAfterMinutes: 99, order: 9 },
        reading: { duration: 10, gapAfterMinutes: 99, order: 9 },
        writing: { duration: 10, gapAfterMinutes: 99, order: 9 },
        speaking: { gapAfterMinutes: 99, order: 9 },
      },
      progression: {
        autoSubmit: false,
        lockAfterSubmit: false,
        allowPause: true,
      },
      delivery: {
        allowedExtensionMinutes: [5, 10, 15],
      },
      standards: {
        writingTasks: {
          task1: { minWords: 123, recommendedTime: 1 },
          task2: { minWords: 456, recommendedTime: 2 },
        },
      },
    });

    expect(config.general.ieltsMode).toBe(true);
    expect(config.sections.listening.duration).toBe(30);
    expect(config.sections.reading.duration).toBe(60);
    expect(config.sections.writing.duration).toBe(60);
    expect(config.sections.listening.gapAfterMinutes).toBe(0);
    expect(config.sections.reading.gapAfterMinutes).toBe(0);
    expect(config.sections.writing.gapAfterMinutes).toBe(0);
    expect(config.sections.speaking.gapAfterMinutes).toBe(0);
    expect(config.sections.listening.order).toBe(0);
    expect(config.sections.reading.order).toBe(1);
    expect(config.sections.writing.order).toBe(2);
    expect(config.sections.speaking.order).toBe(3);
    expect(config.progression.autoSubmit).toBe(true);
    expect(config.progression.lockAfterSubmit).toBe(true);
    expect(config.progression.allowPause).toBe(false);
    expect(config.delivery.allowedExtensionMinutes).toEqual([]);
    expect(config.standards.writingTasks.task1).toEqual({ minWords: 150, recommendedTime: 20 });
    expect(config.standards.writingTasks.task2).toEqual({ minWords: 250, recommendedTime: 40 });
  });
});
