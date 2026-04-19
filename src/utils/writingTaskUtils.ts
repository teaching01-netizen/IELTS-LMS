import type { ExamState, WritingTaskConfig, WritingTaskContent } from '../types';

const getLegacyTaskContent = (
  writing: ExamState['writing'],
  taskId: string,
): WritingTaskContent => {
  if (taskId === 'task1') {
    return {
      taskId,
      prompt: writing.task1Prompt,
      chart: writing.task1Chart,
    };
  }

  if (taskId === 'task2') {
    return {
      taskId,
      prompt: writing.task2Prompt,
    };
  }

  return {
    taskId,
    prompt: '',
  };
};

export function normalizeWritingTaskContents(
  writing: ExamState['writing'],
  taskConfigs: WritingTaskConfig[],
): WritingTaskContent[] {
  const existing = new Map((writing.tasks ?? []).map((task) => [task.taskId, { ...task }]));

  return Array.isArray(taskConfigs) ? taskConfigs.map((taskConfig) => existing.get(taskConfig.id) ?? getLegacyTaskContent(writing, taskConfig.id)) : [];
}

export function getWritingTaskContent(
  writing: ExamState['writing'],
  taskConfigs: WritingTaskConfig[],
  taskId: string,
): WritingTaskContent {
  return (
    normalizeWritingTaskContents(writing, taskConfigs).find((task) => task.taskId === taskId) ??
    getLegacyTaskContent(writing, taskId)
  );
}

export function replaceWritingTaskContents(
  writing: ExamState['writing'],
  taskConfigs: WritingTaskConfig[],
  tasks: WritingTaskContent[],
): ExamState['writing'] {
  const normalizedTasks = taskConfigs.map(
    (taskConfig) =>
      tasks.find((task) => task.taskId === taskConfig.id) ??
      getLegacyTaskContent(writing, taskConfig.id),
  );
  const task1 = normalizedTasks.find((task) => task.taskId === 'task1');
  const task2 = normalizedTasks.find((task) => task.taskId === 'task2');

  return {
    ...writing,
    task1Prompt: task1?.prompt ?? writing.task1Prompt,
    task2Prompt: task2?.prompt ?? writing.task2Prompt,
    task1Chart: task1?.chart ?? (task1 ? undefined : writing.task1Chart),
    tasks: normalizedTasks,
  };
}

export function updateWritingTaskContent(
  writing: ExamState['writing'],
  taskConfigs: WritingTaskConfig[],
  taskId: string,
  updater: (task: WritingTaskContent) => WritingTaskContent,
): ExamState['writing'] {
  const updatedTasks = normalizeWritingTaskContents(writing, taskConfigs).map((task) =>
    task.taskId === taskId ? updater(task) : task,
  );

  return replaceWritingTaskContents(writing, taskConfigs, updatedTasks);
}
