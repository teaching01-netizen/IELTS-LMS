import {
  BandScoreTable,
  DeepPartial,
  ExamConfig,
  ModuleType,
  PassageWordCountStandards,
  SpeakingPartConfig,
  SpeakingRubricWeights,
  StandardsConfig,
  WritingRubricWeights,
  WritingTaskConfig,
  WritingTaskStandard,
  WritingTaskType,
} from '../types';

export const DEFAULT_DELIVERY_POLICY: ExamConfig['delivery'] = {
  launchMode: 'proctor_start',
  transitionMode: 'auto_with_proctor_override',
  allowedExtensionMinutes: [5, 10]
};

export const DEFAULT_LISTENING_BAND_TABLE: BandScoreTable = {
  39: 9.0, 37: 8.5, 35: 8.0, 32: 7.5, 30: 7.0, 26: 6.5, 23: 6.0, 18: 5.5, 16: 5.0, 13: 4.5, 10: 4.0, 6: 3.5, 4: 3.0, 2: 2.5
};

export const DEFAULT_READING_ACADEMIC_BAND_TABLE: BandScoreTable = {
  39: 9.0, 37: 8.5, 35: 8.0, 33: 7.5, 30: 7.0, 27: 6.5, 23: 6.0, 19: 5.5, 15: 5.0, 13: 4.5, 10: 4.0, 8: 3.5, 6: 3.0, 4: 2.5
};

export const DEFAULT_READING_GT_BAND_TABLE: BandScoreTable = {
  40: 9.0, 39: 8.5, 37: 8.0, 36: 7.5, 34: 7.0, 32: 6.5, 30: 6.0, 27: 5.5, 23: 5.0, 19: 4.5, 15: 4.0, 12: 3.5, 9: 3.0, 6: 2.5
};

export const ALL_QUESTION_TYPES: ExamConfig['sections']['reading']['allowedQuestionTypes'] = ['TFNG', 'CLOZE', 'MATCHING', 'MAP', 'MULTI_MCQ'];

export const DEFAULT_PASSAGE_WORD_COUNT: PassageWordCountStandards = {
  optimalMin: 700,
  optimalMax: 1000,
  warningMin: 500,
  warningMax: 1200,
};

export const DEFAULT_WRITING_TASK_STANDARDS: StandardsConfig['writingTasks'] = {
  task1: {
    minWords: 150,
    recommendedTime: 20,
  },
  task2: {
    minWords: 250,
    recommendedTime: 40,
  },
};

export const DEFAULT_WRITING_RUBRIC_WEIGHTS: WritingRubricWeights = {
  taskResponse: 25,
  coherence: 25,
  lexical: 25,
  grammar: 25,
};

export const DEFAULT_SPEAKING_RUBRIC_WEIGHTS: SpeakingRubricWeights = {
  fluency: 25,
  lexical: 25,
  grammar: 25,
  pronunciation: 25,
};

export const DEFAULT_RUBRIC_DEVIATION_THRESHOLD = 10;

const cloneBandTable = (table: BandScoreTable): BandScoreTable => ({ ...table });

const normalizeBandTable = (
  table: DeepPartial<BandScoreTable> | undefined,
  fallback: BandScoreTable,
): BandScoreTable =>
  Object.entries(table ?? fallback).reduce((result, [raw, band]) => {
    if (typeof band === 'number') {
      result[Number(raw)] = band;
    }

    return result;
  }, {} as BandScoreTable);

const cloneWritingTaskStandard = (task: WritingTaskStandard): WritingTaskStandard => ({ ...task });

const cloneWritingTasks = (tasks: StandardsConfig['writingTasks']): StandardsConfig['writingTasks'] => ({
  task1: cloneWritingTaskStandard(tasks.task1),
  task2: cloneWritingTaskStandard(tasks.task2),
});

const cloneStandards = (standards: StandardsConfig): StandardsConfig => ({
  passageWordCount: { ...standards.passageWordCount },
  writingTasks: cloneWritingTasks(standards.writingTasks),
  rubricDeviationThreshold: standards.rubricDeviationThreshold,
  rubricWeights: {
    writing: { ...standards.rubricWeights.writing },
    speaking: { ...standards.rubricWeights.speaking },
  },
  bandScoreTables: {
    listening: cloneBandTable(standards.bandScoreTables.listening),
    readingAcademic: cloneBandTable(standards.bandScoreTables.readingAcademic),
    readingGeneralTraining: cloneBandTable(standards.bandScoreTables.readingGeneralTraining),
  },
});

const buildDefaultStandards = (): StandardsConfig => ({
  passageWordCount: { ...DEFAULT_PASSAGE_WORD_COUNT },
  writingTasks: cloneWritingTasks(DEFAULT_WRITING_TASK_STANDARDS),
  rubricDeviationThreshold: DEFAULT_RUBRIC_DEVIATION_THRESHOLD,
  rubricWeights: {
    writing: { ...DEFAULT_WRITING_RUBRIC_WEIGHTS },
    speaking: { ...DEFAULT_SPEAKING_RUBRIC_WEIGHTS },
  },
  bandScoreTables: {
    listening: cloneBandTable(DEFAULT_LISTENING_BAND_TABLE),
    readingAcademic: cloneBandTable(DEFAULT_READING_ACADEMIC_BAND_TABLE),
    readingGeneralTraining: cloneBandTable(DEFAULT_READING_GT_BAND_TABLE),
  },
});

const buildWritingTasksFromStandards = (
  tasks: WritingTaskConfig[] | undefined,
  standards: StandardsConfig['writingTasks'],
): WritingTaskConfig[] => {
  const defaultTask1: WritingTaskConfig = { id: 'task1', label: 'Task 1', taskType: 'task1-academic', minWords: 150, recommendedTime: 20 };
  const defaultTask2: WritingTaskConfig = { id: 'task2', label: 'Task 2', taskType: 'task2-essay', minWords: 250, recommendedTime: 40 };

  const currentTasks = tasks && tasks.length > 0
    ? tasks.map((task) => ({ ...task }))
    : [defaultTask1, defaultTask2];

  const [task1 = defaultTask1, task2 = defaultTask2] = currentTasks;

  const syncedTasks: WritingTaskConfig[] = [
    {
      ...task1,
      minWords: standards.task1.minWords,
      recommendedTime: standards.task1.recommendedTime,
    },
    {
      ...task2,
      minWords: standards.task2.minWords,
      recommendedTime: standards.task2.recommendedTime,
    },
  ];

  if (currentTasks.length <= 2) {
    return syncedTasks;
  }

  return [...syncedTasks, ...currentTasks.slice(2)];
};

const deriveStandards = (
  base: StandardsConfig,
  incoming?: DeepPartial<ExamConfig>,
): StandardsConfig => {
  const type = incoming?.general?.type ?? 'Academic';
  const legacyTasks = incoming?.sections?.writing?.tasks ?? [];
  const legacyTask1 = legacyTasks[0];
  const legacyTask2 = legacyTasks[1];
  const incomingStandards = incoming?.standards;

  return {
    passageWordCount: {
      ...base.passageWordCount,
      ...incomingStandards?.passageWordCount,
    },
    writingTasks: {
      task1: {
        ...base.writingTasks.task1,
        ...(legacyTask1 ? {
          minWords: legacyTask1.minWords,
          recommendedTime: legacyTask1.recommendedTime,
        } : {}),
        ...incomingStandards?.writingTasks?.task1,
      },
      task2: {
        ...base.writingTasks.task2,
        ...(legacyTask2 ? {
          minWords: legacyTask2.minWords,
          recommendedTime: legacyTask2.recommendedTime,
        } : {}),
        ...incomingStandards?.writingTasks?.task2,
      },
    },
    rubricDeviationThreshold:
      incomingStandards?.rubricDeviationThreshold ?? base.rubricDeviationThreshold,
    rubricWeights: {
      writing: {
        ...base.rubricWeights.writing,
        ...incoming?.sections?.writing?.rubricWeights,
        ...incomingStandards?.rubricWeights?.writing,
      },
      speaking: {
        ...base.rubricWeights.speaking,
        ...incoming?.sections?.speaking?.rubricWeights,
        ...incomingStandards?.rubricWeights?.speaking,
      },
    },
    bandScoreTables: {
      listening: normalizeBandTable(
        incomingStandards?.bandScoreTables?.listening ??
          incoming?.sections?.listening?.bandScoreTable,
        base.bandScoreTables.listening,
      ),
      readingAcademic: normalizeBandTable(
        incomingStandards?.bandScoreTables?.readingAcademic ??
          (type === 'Academic' ? incoming?.sections?.reading?.bandScoreTable : undefined),
        base.bandScoreTables.readingAcademic,
      ),
      readingGeneralTraining: normalizeBandTable(
        incomingStandards?.bandScoreTables?.readingGeneralTraining ??
          (type === 'General Training' ? incoming?.sections?.reading?.bandScoreTable : undefined),
        base.bandScoreTables.readingGeneralTraining,
      ),
    },
  };
};

export const syncConfigWithStandards = (config: ExamConfig): ExamConfig => {
  const synced = {
    ...config,
    standards: cloneStandards(config.standards),
    sections: {
      ...config.sections,
      listening: {
        ...config.sections.listening,
        bandScoreTable: cloneBandTable(config.standards.bandScoreTables.listening),
      },
      reading: {
        ...config.sections.reading,
        bandScoreTable: cloneBandTable(
          config.general.type === 'General Training'
            ? config.standards.bandScoreTables.readingGeneralTraining
            : config.standards.bandScoreTables.readingAcademic,
        ),
      },
      writing: {
        ...config.sections.writing,
        tasks: buildWritingTasksFromStandards(config.sections.writing.tasks, config.standards.writingTasks),
        rubricWeights: { ...config.standards.rubricWeights.writing },
      },
      speaking: {
        ...config.sections.speaking,
        rubricWeights: { ...config.standards.rubricWeights.speaking },
      },
    },
  };

  return synced;
};

const buildDefaultConfig = (
  type: 'Academic' | 'General Training' = 'Academic',
  preset: ExamConfig['general']['preset'] = 'Academic'
): ExamConfig => {
  const isListeningOnly = preset === 'Listening';
  const isReadingOnly = preset === 'Reading';
  const isWritingOnly = preset === 'Writing';
  const isSpeakingOnly = preset === 'Speaking';
  const isFull = preset === 'Academic' || preset === 'General Training';

  return {
    general: {
      preset,
      type,
      title: '',
      summary: `Standard IELTS ${type} Exam`,
      instructions: 'Please follow the instructions for each section carefully.'
    },
    sections: {
      listening: {
        enabled: isFull || isListeningOnly,
        label: 'Listening',
        duration: 30,
        order: 0,
        gapAfterMinutes: 0,
        partCount: 4,
        bandScoreTable: { ...DEFAULT_LISTENING_BAND_TABLE },
        allowedQuestionTypes: [...ALL_QUESTION_TYPES]
      },
      reading: {
        enabled: isFull || isReadingOnly,
        label: 'Reading',
        duration: 60,
        order: 1,
        gapAfterMinutes: 0,
        passageCount: 3,
        bandScoreTable: type === 'Academic' 
          ? { ...DEFAULT_READING_ACADEMIC_BAND_TABLE } 
          : { ...DEFAULT_READING_GT_BAND_TABLE },
        allowedQuestionTypes: [...ALL_QUESTION_TYPES]
      },
      writing: {
        enabled: isFull || isWritingOnly,
        label: 'Writing',
        duration: 60,
        order: 2,
        gapAfterMinutes: 0,
        tasks: [
          { id: 'task1', label: 'Task 1', taskType: type === 'Academic' ? 'task1-academic' : 'task1-general', minWords: 150, recommendedTime: 20 },
          { id: 'task2', label: 'Task 2', taskType: 'task2-essay', minWords: 250, recommendedTime: 40 }
        ],
        rubricWeights: { ...DEFAULT_WRITING_RUBRIC_WEIGHTS },
        allowedQuestionTypes: []
      },
      speaking: {
        enabled: isFull || isSpeakingOnly,
        label: 'Speaking',
        duration: 15,
        order: 3,
        gapAfterMinutes: 0,
        parts: [
          { id: 'part1', label: 'Part 1: Introduction & Interview', prepTime: 0, speakingTime: 300 },
          { id: 'part2', label: 'Part 2: Individual Long Turn', prepTime: 60, speakingTime: 120 },
          { id: 'part3', label: 'Part 3: Two-way Discussion', prepTime: 0, speakingTime: 300 }
        ],
        rubricWeights: { ...DEFAULT_SPEAKING_RUBRIC_WEIGHTS },
        allowedQuestionTypes: []
      }
    },
    standards: buildDefaultStandards(),
    progression: {
      autoSubmit: true,
      lockAfterSubmit: true,
      allowPause: false,
      showWarnings: true,
      warningThreshold: 3
    },
    delivery: { ...DEFAULT_DELIVERY_POLICY },
    scoring: {
      overallRounding: 'nearest-0.5'
    },
    security: {
      requireFullscreen: true,
      tabSwitchRule: 'warn',
      detectSecondaryScreen: true,
      preventAutofill: true,
      preventAutocorrect: true,
      fullscreenAutoReentry: true,
      fullscreenMaxViolations: 3,
      heartbeatIntervalSeconds: 15,
      heartbeatMissThreshold: 3,
      pauseOnOffline: true,
      bufferAnswersOffline: true,
      requireDeviceContinuityOnReconnect: true,
      allowSafariWithAcknowledgement: true,
      proctoringFlags: {
        webcam: true,
        audio: true,
        screen: true
      }
    }
  };
};

const normalizeModuleConfig = <T extends ExamConfig['sections'][ModuleType]>(base: T, incoming?: DeepPartial<T>): T => {
  const normalized = {
    ...base,
    ...incoming,
    gapAfterMinutes: incoming?.gapAfterMinutes ?? base.gapAfterMinutes,
    allowedQuestionTypes: incoming?.allowedQuestionTypes ?? base.allowedQuestionTypes
  } as T;

  if ('bandScoreTable' in base) {
    (normalized as T & { bandScoreTable: BandScoreTable }).bandScoreTable = 
      (incoming as T & { bandScoreTable?: BandScoreTable })?.bandScoreTable ?? 
      (base as T & { bandScoreTable: BandScoreTable }).bandScoreTable;
  }

  if ('tasks' in base) {
    (normalized as T & { tasks: WritingTaskConfig[] }).tasks = 
      (incoming as T & { tasks?: WritingTaskConfig[] })?.tasks ?? 
      (base as T & { tasks: WritingTaskConfig[] }).tasks;
  }

  if ('parts' in base) {
    (normalized as T & { parts: SpeakingPartConfig[] }).parts = 
      (incoming as T & { parts?: SpeakingPartConfig[] })?.parts ?? 
      (base as T & { parts: SpeakingPartConfig[] }).parts;
  }

  if ('partCount' in base) {
    (normalized as T & { partCount: number }).partCount = 
      (incoming as T & { partCount?: number })?.partCount ?? 
      (base as T & { partCount: number }).partCount;
  }

  if ('passageCount' in base) {
    (normalized as T & { passageCount: number }).passageCount = 
      (incoming as T & { passageCount?: number })?.passageCount ?? 
      (base as T & { passageCount: number }).passageCount;
  }

  if ('rubricWeights' in base) {
    (normalized as T & { rubricWeights: Record<string, number> }).rubricWeights = 
      (incoming as T & { rubricWeights?: Record<string, number> })?.rubricWeights ?? 
      (base as T & { rubricWeights: Record<string, number> }).rubricWeights;
  }

  return normalized;
};

export const normalizeExamConfig = (config?: DeepPartial<ExamConfig>): ExamConfig => {
  const base = buildDefaultConfig(
    config?.general?.type ?? 'Academic',
    config?.general?.preset ?? 'Academic'
  );

  if (!config) {
    return base;
  }

  const normalized = {
    ...base,
    ...config,
    general: {
      ...base.general,
      ...config.general
    },
    sections: {
      listening: normalizeModuleConfig(base.sections.listening, config.sections?.listening),
      reading: normalizeModuleConfig(base.sections.reading, config.sections?.reading),
      writing: normalizeModuleConfig(base.sections.writing, config.sections?.writing),
      speaking: normalizeModuleConfig(base.sections.speaking, config.sections?.speaking)
    },
    standards: deriveStandards(base.standards, config),
    progression: {
      ...base.progression,
      ...config.progression
    },
    delivery: {
      ...base.delivery,
      ...config.delivery,
      allowedExtensionMinutes: config.delivery?.allowedExtensionMinutes ?? base.delivery.allowedExtensionMinutes
    },
    scoring: {
      ...base.scoring,
      ...config.scoring
    },
    security: {
      ...base.security,
      ...config.security,
      proctoringFlags: {
        ...base.security.proctoringFlags,
        ...config.security?.proctoringFlags
      }
    }
  };

  return syncConfigWithStandards(normalized);
};

export const createDefaultConfig = (
  type: 'Academic' | 'General Training' = 'Academic',
  preset: ExamConfig['general']['preset'] = 'Academic'
): ExamConfig => buildDefaultConfig(type, preset);
