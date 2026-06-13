import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../../constants/examDefaults';
import type { ExamState } from '../../types';
import {
  getWritingTaskContent,
  normalizeWritingTaskContents,
  replaceWritingTaskContents,
  updateWritingTaskContent,
} from '../writingTaskUtils';

const createWritingState = (): ExamState['writing'] => ({
  task1Prompt: 'Task 1 prompt',
  task2Prompt: 'Task 2 prompt',
  task1Chart: {
    id: 'chart-1',
    title: 'Chart',
    type: 'bar',
    labels: ['A'],
    values: [1],
  },
});

describe('writingTaskUtils', () => {
  it('normalizes legacy task fields into task content records', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.sections.writing.tasks.push({
      id: 'task3',
      label: 'Task 3',
      minWords: 300,
      recommendedTime: 30,
    });

    const tasks = normalizeWritingTaskContents(createWritingState(), config.sections.writing.tasks);

    expect(tasks.map((task) => task.taskId)).toEqual(['task1', 'task2', 'task3']);
    expect(tasks[0].prompt).toBe('Task 1 prompt');
    expect(tasks[2].prompt).toBe('');
  });

  it('updates arbitrary task prompts while keeping legacy fields in sync', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    config.sections.writing.tasks.push({
      id: 'task3',
      label: 'Task 3',
      minWords: 300,
      recommendedTime: 30,
    });

    const writing = updateWritingTaskContent(
      createWritingState(),
      config.sections.writing.tasks,
      'task3',
      (task) => ({ ...task, prompt: 'Task 3 prompt' }),
    );

    expect(getWritingTaskContent(writing, config.sections.writing.tasks, 'task3').prompt).toBe('Task 3 prompt');
    expect(writing.task1Prompt).toBe('Task 1 prompt');
    expect(writing.task2Prompt).toBe('Task 2 prompt');
  });

  it('replaces task contents and mirrors task1/task2 prompts', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const writing = replaceWritingTaskContents(createWritingState(), config.sections.writing.tasks, [
      { taskId: 'task1', prompt: 'Updated Task 1' },
      { taskId: 'task2', prompt: 'Updated Task 2' },
    ]);

    expect(writing.task1Prompt).toBe('Updated Task 1');
    expect(writing.task2Prompt).toBe('Updated Task 2');
  });

  it('prefers canonical task chart data over legacy task1Chart fallback', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const writing = {
      ...createWritingState(),
      task1Chart: {
        id: 'legacy-chart',
        title: 'Legacy chart',
        type: 'bar' as const,
        labels: ['Legacy'],
        values: [1],
        imageSrc: 'data:image/png;base64,legacy',
      },
      tasks: [
        {
          taskId: 'task1',
          prompt: 'Task 1 prompt',
          chart: {
            id: 'canonical-chart',
            title: 'Canonical chart',
            type: 'bar' as const,
            labels: ['Canonical'],
            values: [2],
            imageSrc: 'data:image/png;base64,canonical',
          },
        },
        { taskId: 'task2', prompt: 'Task 2 prompt' },
      ],
    };

    const task = getWritingTaskContent(writing, config.sections.writing.tasks, 'task1');

    expect(task.chart?.id).toBe('canonical-chart');
    expect(task.chart?.imageSrc).toBe('data:image/png;base64,canonical');
  });

  it('does not mirror canonical task chart images into legacy task1Chart', () => {
    const config = createDefaultConfig('Academic', 'Academic');
    const writing = replaceWritingTaskContents(createWritingState(), config.sections.writing.tasks, [
      {
        taskId: 'task1',
        prompt: 'Updated Task 1',
        chart: {
          id: 'chart-1',
          title: 'Canonical chart',
          type: 'bar',
          labels: ['A'],
          values: [1],
          imageSrc: 'data:image/png;base64,canonical',
        },
      },
      { taskId: 'task2', prompt: 'Updated Task 2' },
    ]);

    expect(writing.tasks?.[0]?.chart?.imageSrc).toBe('data:image/png;base64,canonical');
    expect(writing.task1Chart?.title).toBe('Canonical chart');
    expect(writing.task1Chart?.imageSrc).toBeUndefined();
  });
});
