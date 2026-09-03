import {
  createDefaultConfig,
  DEFAULT_ACT_EXAM_SUMMARY,
  normalizeExamConfig,
} from '../constants/examDefaults';
import type {
  ClassificationBlock,
  ActScienceStimulus,
  ClozeQuestion,
  DiagramLabelingBlock,
  Exam,
  ExamConfig,
  ExamPreset,
  ExamState,
  ExamType,
  FlowChartBlock,
  MapQuestion,
  MatchingBlock,
  MatchingFeaturesBlock,
  MatchingQuestion,
  ModuleType,
  MultiMCQBlock,
  NoteCompletionQuestion,
  QuestionBlock,
  SentenceCompletionQuestion,
  ShortAnswerQuestion,
  SubAnswerTreeNode,
  SingleMCQQuestion,
  SingleMCQBlock,
  TableCompletionBlock,
  TFNGQuestion,
  MCQOption,
} from '../types';
import type { ExamEntity, ExamStatus } from '../types/domain';
import type { StudentAnswerValue } from '../types/answers';
import type { IExamRepository } from './examRepository';
import {
  buildSpeakingRubric,
  buildWritingRubric,
  OFFICIAL_SPEAKING_RUBRIC,
  OFFICIAL_WRITING_RUBRIC,
} from '../utils/builderEnhancements';
import { replaceWritingTaskContents } from '../utils/writingTaskUtils';
import { flattenSubAnswerTree, hasSubAnswerTreeMode } from '../utils/subAnswerTree';
import { getMultiSelectSelectionLimit } from '../utils/multiSelectMcq';

const MODULE_ORDER: ModuleType[] = ['listening', 'reading', 'writing', 'speaking', 'science'];

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

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDiagramImageUrl(block: DiagramLabelingBlock): DiagramLabelingBlock {
  const normalizedImageUrl =
    readNonEmptyString(block.imageUrl) ??
    readNonEmptyString(block.imageSrc) ??
    readNonEmptyString(block.assetUrl) ??
    '';

  if (normalizedImageUrl === block.imageUrl) {
    return block;
  }

  return {
    ...block,
    imageUrl: normalizedImageUrl,
  };
}

function normalizeMcqOptions(options: unknown, idPrefix: string): MCQOption[] {
  if (!Array.isArray(options)) {
    return [];
  }

  return options.map((option, optionIndex) => {
    const optionValue = option as Partial<MCQOption> | undefined;
    return {
      id: readNonEmptyString(optionValue?.id) ?? `${idPrefix}:opt${optionIndex + 1}`,
      text: typeof optionValue?.text === 'string' ? optionValue.text : '',
      isCorrect: Boolean(optionValue?.isCorrect),
    };
  });
}

function normalizeSingleMcqBlock(block: SingleMCQBlock): SingleMCQBlock {
  const legacyStem = readNonEmptyString(block.stem) ?? '';
  const legacyOptions = normalizeMcqOptions(block.options, block.id);
  const rawQuestions = Array.isArray(block.questions) ? block.questions : [];

  const normalizedQuestions = rawQuestions.map((question, questionIndex) => {
    const questionValue = question as Partial<SingleMCQQuestion> | undefined;
    const questionId =
      readNonEmptyString(questionValue?.id) ??
      (questionIndex === 0 ? block.id : `${block.id}:q${questionIndex + 1}`);
    const questionStem = readNonEmptyString(questionValue?.stem) ?? '';
    const questionOptions = normalizeMcqOptions(questionValue?.options, questionId);

    return {
      id: questionId,
      stem: questionStem,
      options: questionOptions,
      skillCategory:
        questionValue?.skillCategory === 'interpretation_of_data'
        || questionValue?.skillCategory === 'scientific_investigation'
        || questionValue?.skillCategory === 'evaluating_scientific_arguments_and_models_with_evidence'
          ? questionValue.skillCategory
          : undefined,
    } satisfies SingleMCQQuestion;
  });

  if (normalizedQuestions.length === 0) {
    return {
      ...block,
      stem: legacyStem,
      options: legacyOptions,
      questions: [
        {
          id: block.id,
          stem: legacyStem,
          options: legacyOptions,
        },
      ],
    };
  }

  const firstQuestion = normalizedQuestions[0];
  return {
    ...block,
    stem: legacyStem || firstQuestion?.stem || '',
    options: legacyOptions.length > 0 ? legacyOptions : firstQuestion?.options ?? [],
    questions: normalizedQuestions,
  };
}

function normalizeQuestionBlock(block: QuestionBlock): QuestionBlock {
  if (block.type === 'DIAGRAM_LABELING') {
    return normalizeDiagramImageUrl(block);
  }

  if (block.type === 'SINGLE_MCQ') {
    return normalizeSingleMcqBlock(block);
  }

  return block;
}

function normalizeQuestionBlocks(blocks: QuestionBlock[] | undefined): QuestionBlock[] {
  if (!Array.isArray(blocks)) {
    return [];
  }

  return blocks.map((block) => normalizeQuestionBlock(block));
}

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
    | SingleMCQQuestion
    | NoteCompletionQuestion
    | null;
  rootId?: string | undefined;
  rootNumber?: number | undefined;
  numberLabel?: string | undefined;
  rootLeafQuestionIds?: string[] | undefined;
  isSubAnswerTreeLeaf?: boolean | undefined;
  treeRequired?: boolean | undefined;
  treePrompt?: string | undefined;
}

export function getEnabledModules(config: ExamConfig): ModuleType[] {
  return MODULE_ORDER
    .filter((moduleKey) => config.sections[moduleKey]?.enabled)
    .sort(
      (left, right) =>
        (config.sections[left]?.order ?? 0) - (config.sections[right]?.order ?? 0),
    );
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

  return hydrateExamState({
    ...version.contentSnapshot,
    config: version.configSnapshot ?? (version.contentSnapshot as ExamState).config,
  } satisfies ExamState);
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
    workflowStatus: entity.status,
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
  const results = await Promise.allSettled(
    entities.map((entity) => adaptExamEntityToLegacyExam(entity, repository)),
  );

  const exams: Exam[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      exams.push(result.value);
      return;
    }

    const entity = entities[index];
    const reason =
      result.reason instanceof Error ? result.reason.message : String(result.reason);
    // Do not block the entire admin experience because of a single corrupt/incomplete exam entity.
    // This can happen if legacy data lacks a draft/published version reference.
    console.warn(`Skipping exam ${entity?.id ?? '(unknown)'}: ${reason}`);
  });

  return exams;
}

export function createInitialExamState(
  title: string,
  type: ExamType,
  preset: ExamPreset = 'Academic',
  baseConfig?: ExamConfig,
): ExamState {
  const base = structuredClone(baseConfig ?? createDefaultConfig(type, preset));
  const shouldUseActDefaultSummary =
    type === 'ACT' &&
    (base.general.summary === `Standard IELTS ${base.general.type} Exam` ||
      base.general.summary === 'ACT Science Practice Test');
  const config = normalizeExamConfig({
    ...base,
    general: {
      ...base.general,
      preset,
      type,
      title,
      ...(shouldUseActDefaultSummary
        ? { summary: DEFAULT_ACT_EXAM_SUMMARY }
        : {}),
    },
  });
  const isActScience = config.general.type === 'ACT';

  if (isActScience) {
    config.sections.science.enabled = true;
  } else if (preset !== 'Academic' && preset !== 'General Training' && preset !== 'Custom') {
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
    activePassageId: config.sections.reading.enabled ? 'p1' : '',
    activeListeningPartId: config.sections.listening.enabled ? 'l1' : '',
    activeScienceStimulusId: '',
    config,
    reading: {
      passages: config.sections.reading.enabled ? Array(config.sections.reading.passageCount)
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
        ) : [],
    },
    listening: {
      parts: config.sections.listening.enabled ? Array(config.sections.listening.partCount)
        .fill(null)
        .map((_, index) => ({
          id: `l${index + 1}`,
          title: `Part ${index + 1}`,
          pins:
            index === 0
              ? [{ id: 'pin1', time: '00:45', label: 'Q1-5 Location' }]
              : [],
          blocks: [],
        })) : [],
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
    science: {
      stimuli: isActScience ? [] : [],
    },
  };
}

export function hydrateExamState(state: ExamState): ExamState {
  const partialState = state as Partial<ExamState>;
  const config = normalizeExamConfig(partialState.config);
  const fallback = createInitialExamState(
    partialState.title ?? config.general.title,
    partialState.type ?? config.general.type,
    config.general.preset,
    config,
  );
  const mergedState: ExamState = {
    ...fallback,
    ...partialState,
    config,
    reading: {
      ...fallback.reading,
      ...partialState.reading,
      passages: partialState.reading?.passages ?? fallback.reading.passages,
    },
    listening: {
      ...fallback.listening,
      ...partialState.listening,
      parts: Array.isArray(partialState.listening?.parts) ? partialState.listening.parts : fallback.listening.parts,
    },
    writing: {
      ...fallback.writing,
      ...partialState.writing,
    },
    speaking: {
      ...fallback.speaking,
      ...partialState.speaking,
    },
    science: {
      ...fallback.science,
      ...partialState.science,
      stimuli: Array.isArray(partialState.science?.stimuli)
        ? partialState.science.stimuli
        : fallback.science.stimuli,
    },
  };
  const writing = replaceWritingTaskContents(
    {
      ...mergedState.writing,
      customPromptTemplates: Array.isArray(mergedState.writing.customPromptTemplates) ? mergedState.writing.customPromptTemplates : [],
      rubric: buildWritingRubric(config, structuredClone(mergedState.writing.rubric ?? OFFICIAL_WRITING_RUBRIC)),
      gradeHistory: Array.isArray(mergedState.writing.gradeHistory) ? mergedState.writing.gradeHistory : [],
    },
    config.sections.writing.tasks,
    mergedState.writing.tasks ?? [],
  );

  return {
    ...mergedState,
    config,
    reading: {
      ...mergedState.reading,
      passages: Array.isArray(mergedState.reading.passages) ? mergedState.reading.passages.map((passage) => ({
        ...passage,
        blocks: normalizeQuestionBlocks(passage.blocks),
        images: passage.images ?? [],
        wordCount:
          passage.wordCount ??
          (passage.content.trim() ? passage.content.trim().split(/\s+/).length : 0),
      })) : [],
    },
    listening: {
      ...mergedState.listening,
      parts: Array.isArray(mergedState.listening.parts)
        ? mergedState.listening.parts.map((part) => ({
          ...part,
          blocks: normalizeQuestionBlocks(part.blocks),
        }))
        : [],
    },
    science: {
      ...mergedState.science,
      stimuli: Array.isArray(mergedState.science?.stimuli)
        ? mergedState.science.stimuli.map((stimulus: ActScienceStimulus) => ({
            ...stimulus,
            blocks: normalizeQuestionBlocks(stimulus.blocks) as ActScienceStimulus['blocks'],
            images: stimulus.images ?? [],
            wordCount:
              stimulus.wordCount ??
              (stimulus.content.trim() ? stimulus.content.trim().split(/\s+/).length : 0),
          }))
        : [],
    },
    writing,
    speaking: {
      ...mergedState.speaking,
      part1Topics: Array.isArray(mergedState.speaking.part1Topics) ? mergedState.speaking.part1Topics : [],
      cueCardDetails: mergedState.speaking.cueCardDetails ? {
        ...mergedState.speaking.cueCardDetails,
        topic: mergedState.speaking.cueCardDetails.topic || mergedState.speaking.cueCard || '',
        bullets: Array.isArray(mergedState.speaking.cueCardDetails.bullets) ? mergedState.speaking.cueCardDetails.bullets : ['', '', '', ''],
        timeAllocation: mergedState.speaking.cueCardDetails.timeAllocation || '1 minute preparation + up to 2 minutes speaking',
        evaluatorNotes: mergedState.speaking.cueCardDetails.evaluatorNotes || mergedState.speaking.evaluatorNotes || '',
      } : {
        topic: mergedState.speaking.cueCard || '',
        bullets: ['', '', '', ''],
        timeAllocation: '1 minute preparation + up to 2 minutes speaking',
        evaluatorNotes: mergedState.speaking.evaluatorNotes ?? '',
      },
      part3Discussion: Array.isArray(mergedState.speaking.part3Discussion) ? mergedState.speaking.part3Discussion : [],
      evaluatorNotes: mergedState.speaking.evaluatorNotes ?? '',
      rubric: buildSpeakingRubric(config, structuredClone(mergedState.speaking.rubric ?? OFFICIAL_SPEAKING_RUBRIC)),
      gradeHistory: Array.isArray(mergedState.speaking.gradeHistory) ? mergedState.speaking.gradeHistory : [],
    },
  };
}

export function getStudentQuestionsForModule(
  state: ExamState,
  moduleType: ModuleType,
): StudentQuestionDescriptor[] {
  if (moduleType === 'reading') {
    const questions: StudentQuestionDescriptor[] = [];
    let nextRootNumber = 1;

    state.reading.passages.forEach((passage) => {
      passage.blocks.forEach((block) => {
        const { descriptors, nextNumber } = buildStudentQuestionDescriptors(
          block,
          passage.id,
          passage.title,
          nextRootNumber,
        );
        questions.push(...descriptors);
        nextRootNumber = nextNumber;
      });
    });

    return questions;
  }

  if (moduleType === 'listening') {
    const questions: StudentQuestionDescriptor[] = [];
    let nextRootNumber = 1;

    state.listening.parts.forEach((part) => {
      part.blocks.forEach((block) => {
        const { descriptors, nextNumber } = buildStudentQuestionDescriptors(
          block,
          part.id,
          part.title,
          nextRootNumber,
        );
        questions.push(...descriptors);
        nextRootNumber = nextNumber;
      });
    });

    return questions;
  }

  if (moduleType === 'science') {
    const questions: StudentQuestionDescriptor[] = [];
    let nextRootNumber = 1;

    state.science.stimuli.forEach((stimulus) => {
      stimulus.blocks.forEach((block) => {
        const { descriptors, nextNumber } = buildStudentQuestionDescriptors(
          block,
          stimulus.id,
          stimulus.title,
          nextRootNumber,
        );
        questions.push(...descriptors);
        nextRootNumber = nextNumber;
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
  answers: Record<string, StudentAnswerValue | undefined>,
): number {
  const groupedSlots = new Map<string, StudentQuestionDescriptor[]>();
  let count = 0;

  for (const question of questions) {
    const groupKey = getGroupedScoringSlotKey(question);
    if (groupKey) {
      const existing = groupedSlots.get(groupKey);
      if (existing) {
        existing.push(question);
      } else {
        groupedSlots.set(groupKey, [question]);
      }
      continue;
    }

    count += getAnsweredSlotCount(question, answers);
  }

  for (const groupQuestions of groupedSlots.values()) {
    const requiredCorrect = resolveGroupedScoringRequiredCorrect(groupQuestions);
    const answeredSlots = groupQuestions.reduce((acc, groupedQuestion) => {
      const answer = getQuestionAnswer(groupedQuestion, answers);
      return acc + (hasAnsweredValue(answer) ? 1 : 0);
    }, 0);
    if (answeredSlots >= requiredCorrect) {
      count += 1;
    }
  }

  return count;
}

export function countQuestionSlots(questions: StudentQuestionDescriptor[]): number {
  const groupedSlotKeys = new Set<string>();
  let count = 0;

  for (const question of questions) {
    if (question.isMulti) {
      count += question.correctCount;
      continue;
    }

    const groupKey = getGroupedScoringSlotKey(question);
    if (groupKey) {
      groupedSlotKeys.add(groupKey);
      continue;
    }

    count += 1;
  }

  return count + groupedSlotKeys.size;
}

export function getQuestionStartNumber(
  questions: StudentQuestionDescriptor[],
  questionId: string,
): number | null {
  const lookup = buildQuestionStartNumberLookup(questions);
  return lookup.get(questionId) ?? null;
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
    const end = start + question.correctCount - 1;
    return end === start ? `${start}` : `${start}-${end}`;
  }

  return `${start}`;
}

function getGroupedScoringSlotKey(question: StudentQuestionDescriptor): string | null {
  if (typeof question.rootId !== 'string') {
    return null;
  }
  // Only collapse slots explicitly marked as grouped scoring (e.g. 2-for-1),
  // not other uses of rootId such as the sub-answer tree.
  return question.rootId.includes('::group::') ? question.rootId : null;
}

function resolveGroupedScoringRequiredCorrect(groupQuestions: StudentQuestionDescriptor[]): number {
  const candidates: number[] = [];

  for (const question of groupQuestions) {
    if (question.block.type === 'SENTENCE_COMPLETION' && question.question && question.answerIndex !== undefined) {
      const blank = (question.question as SentenceCompletionQuestion).blanks[question.answerIndex];
      if (blank?.requiredCorrect !== undefined) {
        candidates.push(blank.requiredCorrect);
      }
      continue;
    }

    if (question.block.type === 'TABLE_COMPLETION' && question.answerIndex !== undefined) {
      const cell = (question.block as TableCompletionBlock).cells[question.answerIndex];
      if (cell?.requiredCorrect !== undefined) {
        candidates.push(cell.requiredCorrect);
      }
    }
  }

  const normalized = candidates
    .map((value) => (Number.isFinite(value) ? Math.floor(value) : 0))
    .filter((value) => value >= 1);

  return normalized.length > 0 ? Math.max(...normalized) : 1;
}

function buildQuestionStartNumberLookup(
  questions: StudentQuestionDescriptor[],
): Map<string, number> {
  const lookup = new Map<string, number>();
  const groupedStartNumbers = new Map<string, number>();
  let current = 1;

  for (const question of questions) {
    if (question.isMulti) {
      lookup.set(question.id, current);
      current += question.correctCount;
      continue;
    }

    const groupKey = getGroupedScoringSlotKey(question);
    if (groupKey) {
      const existing = groupedStartNumbers.get(groupKey);
      if (existing !== undefined) {
        lookup.set(question.id, existing);
        continue;
      }

      groupedStartNumbers.set(groupKey, current);
      lookup.set(question.id, current);
      current += 1;
      continue;
    }

    lookup.set(question.id, current);
    current += 1;
  }

  return lookup;
}

export function getQuestionAnswer(
  question: StudentQuestionDescriptor,
  answers: Record<string, StudentAnswerValue | undefined>,
): StudentAnswerValue | undefined {
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
  answers: Record<string, StudentAnswerValue | undefined>,
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
  answers: Record<string, StudentAnswerValue | undefined>,
): boolean {
  const groupKey = getGroupedScoringSlotKey(question);
  if (!groupKey) {
    return getAnsweredSlotCount(question, answers) > 0;
  }

  const groupQuestions = questionsForGroupedScoringSlot(groupKey, question, answers);
  return groupQuestions.some((groupedQuestion) => hasAnsweredValue(getQuestionAnswer(groupedQuestion, answers)));
}

export function isQuestionFullyAnswered(
  question: StudentQuestionDescriptor,
  answers: Record<string, StudentAnswerValue | undefined>,
): boolean {
  if (question.isMulti) {
    return getAnsweredSlotCount(question, answers) >= question.correctCount;
  }

  const groupKey = getGroupedScoringSlotKey(question);
  if (!groupKey) {
    return isQuestionAnswered(question, answers);
  }

  const groupQuestions = questionsForGroupedScoringSlot(groupKey, question, answers);
  const requiredCorrect = resolveGroupedScoringRequiredCorrect(groupQuestions);
  const answeredSlots = groupQuestions.reduce((acc, groupedQuestion) => {
    const answer = getQuestionAnswer(groupedQuestion, answers);
    return acc + (hasAnsweredValue(answer) ? 1 : 0);
  }, 0);
  return answeredSlots >= requiredCorrect;
}

function questionsForGroupedScoringSlot(
  groupKey: string,
  representative: StudentQuestionDescriptor,
  answers: Record<string, StudentAnswerValue | undefined>,
): StudentQuestionDescriptor[] {
  void answers;
  // We don't have the entire question list here, so fall back to using the block/question
  // shape to locate all sibling slots that belong to the same group key.
  // This is only used for grouped scoring on SentenceCompletion/TableCompletion slots.
  if (representative.block.type === 'SENTENCE_COMPLETION' && representative.question) {
    const question = representative.question as SentenceCompletionQuestion;
    return question.blanks
      .map((blank, index) => ({
        ...representative,
        id: `${question.id}:${blank.id}`,
        answerIndex: index,
        rootId: (() => {
          const scoreGroupId = typeof blank.scoreGroupId === 'string' ? blank.scoreGroupId.trim() : '';
          return scoreGroupId
            ? `${representative.block.id}::sentence::${question.id}::group::${scoreGroupId}`
            : `${representative.block.id}::sentence::${question.id}::slot::${blank.id}`;
        })(),
      }))
      .filter((entry) => entry.rootId === groupKey);
  }

  if (representative.block.type === 'TABLE_COMPLETION') {
    const block = representative.block as TableCompletionBlock;
    return block.cells
      .map((cell, index) => ({
        ...representative,
        id: `${block.id}:${cell.id}`,
        answerKey: block.id,
        answerIndex: index,
        rootId: (() => {
          const scoreGroupId = typeof cell.scoreGroupId === 'string' ? cell.scoreGroupId.trim() : '';
          return scoreGroupId
            ? `${block.id}::table::group::${scoreGroupId}`
            : `${block.id}::table::slot::${cell.id}`;
        })(),
      }))
      .filter((entry) => entry.rootId === groupKey);
  }

  return [representative];
}

function buildStudentQuestionDescriptors(
  block: QuestionBlock,
  groupId: string,
  groupLabel: string,
  startRootNumber: number,
): { descriptors: StudentQuestionDescriptor[]; nextNumber: number } {
  if (hasSubAnswerTreeMode(block)) {
    const tree = (block as QuestionBlock & { answerTree?: SubAnswerTreeNode[] }).answerTree;
    const flattened = flattenSubAnswerTree(block.id, tree, startRootNumber);
    const rootById = new Map(flattened.roots.map((root) => [root.rootId, root]));
    const descriptors = flattened.leaves.map((leaf) => {
      const root = rootById.get(leaf.rootId);
      return {
        id: leaf.id,
        blockId: block.id,
        groupId,
        groupLabel,
        isMulti: false,
        correctCount: 1,
        answerKey: leaf.id,
        block,
        question: null,
        rootId: leaf.rootId,
        rootNumber: leaf.rootNumber,
        numberLabel: leaf.numberLabel,
        rootLeafQuestionIds: root?.leafQuestionIds ?? [leaf.id],
        isSubAnswerTreeLeaf: true,
        treeRequired: leaf.required,
        treePrompt: root?.rootLabel ?? '',
      } satisfies StudentQuestionDescriptor;
    });

    return {
      descriptors,
      nextNumber: flattened.nextRootNumber,
    };
  }

  const normalizeScoreGroupId = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const buildGroupedSlotRootNumbers = (
    slotKeys: string[],
    firstRootNumber: number,
  ): { rootNumbers: number[]; nextNumber: number } => {
    const rootNumbers: number[] = [];
    const assigned = new Map<string, number>();
    let nextNumber = firstRootNumber;

    for (const key of slotKeys) {
      const existing = assigned.get(key);
      if (existing !== undefined) {
        rootNumbers.push(existing);
        continue;
      }
      assigned.set(key, nextNumber);
      rootNumbers.push(nextNumber);
      nextNumber += 1;
    }

    return { rootNumbers, nextNumber };
  };

  const descriptors: StudentQuestionDescriptor[] = (() => {
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
      return (() => {
        let nextNumber = startRootNumber;
        const result: StudentQuestionDescriptor[] = [];

        for (const question of block.questions) {
          const slotKeys = question.blanks.map((blank) => {
            const groupKey = normalizeScoreGroupId(blank.scoreGroupId);
            return groupKey
              ? `${block.id}::sentence::${question.id}::group::${groupKey}`
              : `${block.id}::sentence::${question.id}::slot::${blank.id}`;
          });
          const numbering = buildGroupedSlotRootNumbers(slotKeys, nextNumber);
          nextNumber = numbering.nextNumber;

          question.blanks.forEach((blank, blankIndex) => {
            result.push({
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
              rootId: slotKeys[blankIndex],
              rootNumber: numbering.rootNumbers[blankIndex],
            });
          });
        }

        return result;
      })();

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

    case 'SINGLE_MCQ': {
      if (Array.isArray(block.questions) && block.questions.length > 0) {
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
      }

      return [buildSingleQuestionDescriptor(block, groupId, groupLabel)];
    }

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
      return (() => {
        const slotKeys = block.cells.map((cell) => {
          const groupKey = normalizeScoreGroupId(cell.scoreGroupId);
          return groupKey
            ? `${block.id}::table::group::${groupKey}`
            : `${block.id}::table::slot::${cell.id}`;
        });
        const numbering = buildGroupedSlotRootNumbers(slotKeys, startRootNumber);

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
          rootId: slotKeys[cellIndex],
          rootNumber: numbering.rootNumbers[cellIndex],
        }));
      })();

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
  })();

  return {
    descriptors,
    nextNumber: (() => {
      const definedRootNumbers = descriptors
        .map((descriptor) => descriptor.rootNumber)
        .filter((value): value is number => typeof value === 'number');
      if (definedRootNumbers.length > 0) {
        return Math.max(...definedRootNumbers) + 1;
      }
      return startRootNumber + countQuestionSlots(descriptors);
    })(),
  };
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
    correctCount: getMultiSelectSelectionLimit(block),
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
