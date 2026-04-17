import { createDefaultConfig, normalizeExamConfig } from '../constants/examDefaults';
import type {
  ClassificationBlock,
  ClozeQuestion,
  DiagramLabelingBlock,
  Exam,
  ExamConfig,
  ExamState,
  FlowChartBlock,
  MapQuestion,
  MatchingBlock,
  MatchingFeaturesBlock,
  MatchingQuestion,
  ModuleType,
  MultiMCQBlock,
  NoteCompletionQuestion,
  QuestionAnswer,
  QuestionBlock,
  SentenceCompletionQuestion,
  ShortAnswerQuestion,
  SingleMCQBlock,
  TFNGQuestion,
} from '../types';
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
  answerKey: string;
  answerIndex?: number;
  block: QuestionBlock;
  question:
    | TFNGQuestion
    | ClozeQuestion
    | MapQuestion
    | MatchingQuestion
    | ShortAnswerQuestion
    | SentenceCompletionQuestion
    | NoteCompletionQuestion
    | null;
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
        questions.push(...buildStudentQuestionDescriptors(block, passage.id, passage.title));
      });
    });

    return questions;
  }

  if (moduleType === 'listening') {
    const questions: StudentQuestionDescriptor[] = [];

    state.listening.parts.forEach((part) => {
      part.blocks.forEach((block) => {
        questions.push(...buildStudentQuestionDescriptors(block, part.id, part.title));
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
    return count + getAnsweredSlotCount(question, answers);
  }, 0);
}

export function countQuestionSlots(questions: StudentQuestionDescriptor[]): number {
  return questions.reduce(
    (count, question) => count + (question.isMulti ? question.correctCount : 1),
    0,
  );
}

export function getQuestionStartNumber(
  questions: StudentQuestionDescriptor[],
  questionId: string,
): number | null {
  let current = 1;

  for (const question of questions) {
    if (question.id === questionId) {
      return current;
    }
    current += question.isMulti ? question.correctCount : 1;
  }

  return null;
}

export function getQuestionNumberLabel(
  questions: StudentQuestionDescriptor[],
  questionId: string,
): string {
  const start = getQuestionStartNumber(questions, questionId);
  if (start === null) {
    return '';
  }

  const question = questions.find((candidate) => candidate.id === questionId);
  if (!question) {
    return '';
  }

  if (question.isMulti) {
    return `${start}-${start + question.correctCount - 1}`;
  }

  return `${start}`;
}

export function getQuestionAnswer(
  question: StudentQuestionDescriptor,
  answers: Record<string, unknown>,
): unknown {
  const answer = answers[question.answerKey];

  if (question.answerIndex === undefined) {
    return answer;
  }

  if (!Array.isArray(answer)) {
    return undefined;
  }

  return answer[question.answerIndex];
}

export function getAnsweredSlotCount(
  question: StudentQuestionDescriptor,
  answers: Record<string, unknown>,
): number {
  const answer = getQuestionAnswer(question, answers);

  if (question.answerIndex !== undefined) {
    return hasAnsweredValue(answer) ? 1 : 0;
  }

  if (question.isMulti) {
    return Array.isArray(answer) ? answer.filter(hasAnsweredValue).length : 0;
  }

  return hasAnsweredValue(answer) ? 1 : 0;
}

export function isQuestionAnswered(
  question: StudentQuestionDescriptor,
  answers: Record<string, unknown>,
): boolean {
  return getAnsweredSlotCount(question, answers) > 0;
}

export function isQuestionFullyAnswered(
  question: StudentQuestionDescriptor,
  answers: Record<string, unknown>,
): boolean {
  if (question.isMulti) {
    return getAnsweredSlotCount(question, answers) >= question.correctCount;
  }

  return isQuestionAnswered(question, answers);
}

function buildStudentQuestionDescriptors(
  block: QuestionBlock,
  groupId: string,
  groupLabel: string,
): StudentQuestionDescriptor[] {
  switch (block.type) {
    case 'TFNG':
    case 'CLOZE':
    case 'MATCHING':
    case 'MAP':
    case 'SHORT_ANSWER':
      return block.questions.map((question) => ({
        id: question.id,
        blockId: block.id,
        groupId,
        groupLabel,
        isMulti: false,
        correctCount: 1,
        answerKey: question.id,
        block,
        question,
      }));

    case 'SENTENCE_COMPLETION':
      return block.questions.flatMap((question) =>
        question.blanks.map((blank, blankIndex) => ({
          id: `${question.id}:${blank.id}`,
          blockId: block.id,
          groupId,
          groupLabel,
          isMulti: false,
          correctCount: 1,
          answerKey: question.id,
          answerIndex: blankIndex,
          block,
          question,
        })),
      );

    case 'NOTE_COMPLETION':
      return block.questions.flatMap((question) =>
        question.blanks.map((blank, blankIndex) => ({
          id: `${question.id}:${blank.id}`,
          blockId: block.id,
          groupId,
          groupLabel,
          isMulti: false,
          correctCount: 1,
          answerKey: question.id,
          answerIndex: blankIndex,
          block,
          question,
        })),
      );

    case 'MULTI_MCQ':
      return [buildMultiQuestionDescriptor(block, groupId, groupLabel)];

    case 'SINGLE_MCQ':
      return [buildSingleQuestionDescriptor(block, groupId, groupLabel)];

    case 'DIAGRAM_LABELING':
      return block.labels.map((label, labelIndex) => ({
        id: `${block.id}:${label.id}`,
        blockId: block.id,
        groupId,
        groupLabel,
        isMulti: false,
        correctCount: 1,
        answerKey: block.id,
        answerIndex: labelIndex,
        block,
        question: null,
      }));

    case 'FLOW_CHART':
      return block.steps.map((step, stepIndex) => ({
        id: `${block.id}:${step.id}`,
        blockId: block.id,
        groupId,
        groupLabel,
        isMulti: false,
        correctCount: 1,
        answerKey: block.id,
        answerIndex: stepIndex,
        block,
        question: null,
      }));

    case 'TABLE_COMPLETION':
      return block.cells.map((cell, cellIndex) => ({
        id: `${block.id}:${cell.id}`,
        blockId: block.id,
        groupId,
        groupLabel,
        isMulti: false,
        correctCount: 1,
        answerKey: block.id,
        answerIndex: cellIndex,
        block,
        question: null,
      }));

    case 'CLASSIFICATION':
      return block.items.map((item, itemIndex) => ({
        id: `${block.id}:${item.id}`,
        blockId: block.id,
        groupId,
        groupLabel,
        isMulti: false,
        correctCount: 1,
        answerKey: block.id,
        answerIndex: itemIndex,
        block,
        question: null,
      }));

    case 'MATCHING_FEATURES':
      return block.features.map((feature, featureIndex) => ({
        id: `${block.id}:${feature.id}`,
        blockId: block.id,
        groupId,
        groupLabel,
        isMulti: false,
        correctCount: 1,
        answerKey: block.id,
        answerIndex: featureIndex,
        block,
        question: null,
      }));
  }
}

function buildMultiQuestionDescriptor(
  block: MultiMCQBlock,
  groupId: string,
  groupLabel: string,
): StudentQuestionDescriptor {
  return {
    id: block.id,
    blockId: block.id,
    groupId,
    groupLabel,
    isMulti: true,
    correctCount: block.requiredSelections,
    answerKey: block.id,
    block,
    question: null,
  };
}

function buildSingleQuestionDescriptor(
  block: SingleMCQBlock,
  groupId: string,
  groupLabel: string,
): StudentQuestionDescriptor {
  return {
    id: block.id,
    blockId: block.id,
    groupId,
    groupLabel,
    isMulti: false,
    correctCount: 1,
    answerKey: block.id,
    block,
    question: null,
  };
}

function hasAnsweredValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.trim() !== '';
  }

  if (Array.isArray(value)) {
    return value.some(hasAnsweredValue);
  }

  return value !== null && value !== undefined;
}
