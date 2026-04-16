import { createDefaultConfig, normalizeExamConfig } from '../constants/examDefaults';
import type { Exam, ExamConfig, ExamState, ModuleType } from '../types';
import type { ExamEntity, ExamStatus } from '../types/domain';
import type { IExamRepository } from './examRepository';
import {
  buildSpeakingRubric,
  buildWritingRubric,
  OFFICIAL_SPEAKING_RUBRIC,
  OFFICIAL_WRITING_RUBRIC,
} from '../utils/builderEnhancements';
import { replaceWritingTaskContents } from '../utils/writingTaskUtils';

const MODULE_ORDER: ModuleType[] = ['listening', 'reading', 'writing', 'speaking'];

const LEGACY_STATUS_MAP: Record<ExamStatus, Exam['status']> = {
  draft: 'Draft',
  in_review: 'Draft',
  approved: 'Draft',
  rejected: 'Draft',
  scheduled: 'Published',
  published: 'Published',
  unpublished: 'Draft',
  archived: 'Archived',
};

export interface StudentQuestionDescriptor {
  id: string;
  blockId: string;
  groupId: string;
  groupLabel: string;
  isMulti: boolean;
  correctCount: number;
}

export function getEnabledModules(config: ExamConfig): ModuleType[] {
  return MODULE_ORDER
    .filter((moduleKey) => config.sections[moduleKey].enabled)
    .sort((left, right) => config.sections[left].order - config.sections[right].order);
}

export async function getExamStateFromEntity(
  entity: ExamEntity,
  repository: Pick<IExamRepository, 'getVersionById'>,
): Promise<ExamState> {
  const versionId = entity.currentDraftVersionId || entity.currentPublishedVersionId;
  if (!versionId) {
    throw new Error(`Exam ${entity.id} has no version`);
  }

  const version = await repository.getVersionById(versionId);
  if (!version) {
    throw new Error(`Version ${versionId} not found`);
  }

  return hydrateExamState(version.contentSnapshot);
}

export async function adaptExamEntityToLegacyExam(
  entity: ExamEntity,
  repository: Pick<IExamRepository, 'getVersionById'>,
): Promise<Exam> {
  const content = await getExamStateFromEntity(entity, repository);

  return {
    id: entity.id,
    title: entity.title,
    type: entity.type,
    status: LEGACY_STATUS_MAP[entity.status],
    author: entity.owner,
    lastModified: entity.updatedAt,
    createdAt: entity.createdAt,
    content,
  };
}

export async function adaptExamEntitiesToLegacyExams(
  entities: ExamEntity[],
  repository: Pick<IExamRepository, 'getVersionById'>,
): Promise<Exam[]> {
  return Promise.all(entities.map((entity) => adaptExamEntityToLegacyExam(entity, repository)));
}

export function createInitialExamState(
  title: string,
  type: 'Academic' | 'General Training',
  preset: ExamConfig['general']['preset'] = 'Academic',
  baseConfig?: ExamConfig,
): ExamState {
  const base = structuredClone(baseConfig ?? createDefaultConfig(type, preset));
  const config = normalizeExamConfig({
    ...base,
    general: {
      ...base.general,
      preset,
      type,
      title,
    },
  });

  if (preset !== 'Academic' && preset !== 'General Training' && preset !== 'Custom') {
    MODULE_ORDER.forEach((moduleKey) => {
      config.sections[moduleKey].enabled = false;
    });

    const targetModule = preset.toLowerCase() as ModuleType;
    if (config.sections[targetModule]) {
      config.sections[targetModule].enabled = true;
    }
  }

  const enabledModules = getEnabledModules(config);
  const activeModule = enabledModules[0] ?? 'reading';

  const initialPassage = {
    id: 'p1',
    title: 'Passage 1',
    content:
      'The Industrial Revolution, which began in Britain in the late 18th century, was driven by several key factors.',
    blocks: [],
    images: [],
    wordCount: 17,
  };

  const writing = replaceWritingTaskContents(
    {
      task1Prompt:
        'The chart below shows the number of visitors to three museums in London between 2000 and 2020.',
      task2Prompt:
        'Some people believe that universities should focus on providing skills for the workplace.',
      task1Chart: {
        id: 'chart-1',
        title: 'Museum visitors (millions)',
        type: 'bar',
        labels: ['Museum A', 'Museum B', 'Museum C'],
        values: [2.1, 3.4, 2.8],
      },
      customPromptTemplates: [],
      rubric: buildWritingRubric(config, structuredClone(OFFICIAL_WRITING_RUBRIC)),
      gradeHistory: [],
    },
    config.sections.writing.tasks,
    [
      {
        taskId: 'task1',
        prompt:
          'The chart below shows the number of visitors to three museums in London between 2000 and 2020.',
        chart: {
          id: 'chart-1',
          title: 'Museum visitors (millions)',
          type: 'bar',
          labels: ['Museum A', 'Museum B', 'Museum C'],
          values: [2.1, 3.4, 2.8],
        },
      },
      {
        taskId: 'task2',
        prompt:
          'Some people believe that universities should focus on providing skills for the workplace.',
      },
    ],
  );

  return {
    title,
    type,
    activeModule,
    activePassageId: 'p1',
    activeListeningPartId: 'l1',
    config,
    reading: {
      passages: Array(config.sections.reading.passageCount)
        .fill(null)
        .map((_, index) =>
          index === 0
            ? initialPassage
            : {
                id: `p${index + 1}`,
                title: `Passage ${index + 1}`,
                content: '',
                blocks: [],
                images: [],
                wordCount: 0,
              },
        ),
    },
    listening: {
      parts: Array(config.sections.listening.partCount)
        .fill(null)
        .map((_, index) => ({
          id: `l${index + 1}`,
          title: `Part ${index + 1}`,
          pins:
            index === 0
              ? [{ id: 'pin1', time: '00:45', label: 'Q1-5 Location' }]
              : [],
          blocks: [],
        })),
    },
    writing,
    speaking: {
      part1Topics: ['Work/Studies', 'Home Town/Accommodation'],
      cueCard: 'Describe something you own which is very important to you.',
      cueCardDetails: {
        topic: 'Describe something you own which is very important to you.',
        bullets: [
          'what it is',
          'when you got it',
          'why it matters to you',
          'how often you use it',
        ],
        timeAllocation: '1 minute preparation + up to 2 minutes speaking',
        evaluatorNotes: '',
      },
      part3Discussion: [
        'Why do some people value material possessions more than experiences?',
      ],
      evaluatorNotes: '',
      rubric: buildSpeakingRubric(config, structuredClone(OFFICIAL_SPEAKING_RUBRIC)),
      gradeHistory: [],
    },
  };
}

export function hydrateExamState(state: ExamState): ExamState {
  const config = normalizeExamConfig(state.config);
  const writing = replaceWritingTaskContents(
    {
      ...state.writing,
      customPromptTemplates: state.writing.customPromptTemplates ?? [],
      rubric: buildWritingRubric(config, structuredClone(state.writing.rubric ?? OFFICIAL_WRITING_RUBRIC)),
      gradeHistory: state.writing.gradeHistory ?? [],
    },
    config.sections.writing.tasks,
    state.writing.tasks ?? [],
  );

  return {
    ...state,
    config,
    reading: {
      ...state.reading,
      passages: state.reading.passages.map((passage) => ({
        ...passage,
        images: passage.images ?? [],
        wordCount:
          passage.wordCount ??
          (passage.content.trim() ? passage.content.trim().split(/\s+/).length : 0),
      })),
    },
    writing,
    speaking: {
      ...state.speaking,
      cueCardDetails: state.speaking.cueCardDetails ?? {
        topic: state.speaking.cueCard || '',
        bullets: ['', '', '', ''],
        timeAllocation: '1 minute preparation + up to 2 minutes speaking',
        evaluatorNotes: state.speaking.evaluatorNotes ?? '',
      },
      evaluatorNotes: state.speaking.evaluatorNotes ?? '',
      rubric: buildSpeakingRubric(config, structuredClone(state.speaking.rubric ?? OFFICIAL_SPEAKING_RUBRIC)),
      gradeHistory: state.speaking.gradeHistory ?? [],
    },
  };
}

export function getStudentQuestionsForModule(
  state: ExamState,
  moduleType: ModuleType,
): StudentQuestionDescriptor[] {
  if (moduleType === 'reading') {
    const questions: StudentQuestionDescriptor[] = [];

    state.reading.passages.forEach((passage) => {
      passage.blocks.forEach((block) => {
        if (!('questions' in block)) {
          questions.push({
            id: block.id,
            blockId: block.id,
            groupId: passage.id,
            groupLabel: passage.title,
            isMulti: block.type === 'MULTI_MCQ',
            correctCount: block.type === 'MULTI_MCQ' ? block.requiredSelections : 1,
          });
          return;
        }

        block.questions.forEach((question) => {
          questions.push({
            id: question.id,
            blockId: block.id,
            groupId: passage.id,
            groupLabel: passage.title,
            isMulti: false,
            correctCount: 1,
          });
        });
      });
    });

    return questions;
  }

  if (moduleType === 'listening') {
    const questions: StudentQuestionDescriptor[] = [];

    state.listening.parts.forEach((part) => {
      part.blocks.forEach((block) => {
        if (!('questions' in block)) {
          questions.push({
            id: block.id,
            blockId: block.id,
            groupId: part.id,
            groupLabel: part.title,
            isMulti: block.type === 'MULTI_MCQ',
            correctCount: block.type === 'MULTI_MCQ' ? block.requiredSelections : 1,
          });
          return;
        }

        block.questions.forEach((question) => {
          questions.push({
            id: question.id,
            blockId: block.id,
            groupId: part.id,
            groupLabel: part.title,
            isMulti: false,
            correctCount: 1,
          });
        });
      });
    });

    return questions;
  }

  return [];
}

export function getFirstQuestionIdForModule(
  state: ExamState,
  moduleType: ModuleType,
): string | null {
  return getStudentQuestionsForModule(state, moduleType)[0]?.id ?? null;
}

export function countAnsweredQuestions(
  questions: StudentQuestionDescriptor[],
  answers: Record<string, unknown>,
): number {
  return questions.reduce((count, question) => {
    const answer = answers[question.id];

    if (question.isMulti) {
      return count + (Array.isArray(answer) ? answer.length : 0);
    }

    return count + (answer !== undefined && answer !== '' ? 1 : 0);
  }, 0);
}

export function countQuestionSlots(questions: StudentQuestionDescriptor[]): number {
  return questions.reduce(
    (count, question) => count + (question.isMulti ? question.correctCount : 1),
    0,
  );
}
