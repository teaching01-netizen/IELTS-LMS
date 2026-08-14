import type {
  Passage,
  ListeningPart,
  QuestionBlock,
  TFNGBlock,
  ClozeBlock,
  MatchingBlock,
  MapBlock,
  MultiMCQBlock,
  SingleMCQBlock,
  ShortAnswerBlock,
  SentenceCompletionBlock,
  DiagramLabelingBlock,
  FlowChartBlock,
  TableCompletionBlock,
  NoteCompletionBlock,
  ClassificationBlock,
  MatchingFeaturesBlock,
  StimulusImageAsset,
} from '../types';
import { createId } from './idUtils';

function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneStimulusImageAssetWithNewIds(asset: StimulusImageAsset): StimulusImageAsset {
  const cloned = deepClone(asset);
  return {
    ...cloned,
    id: createId('img'),
    annotations: Array.isArray(cloned.annotations)
      ? cloned.annotations.map((annotation) => ({
          ...annotation,
          id: createId('ann'),
        }))
      : [],
  };
}

export function cloneQuestionBlockWithNewIds(block: QuestionBlock): QuestionBlock {
  const cloned = deepClone(block);
  const nextBlockId = createId('blk');

  switch (cloned.type) {
    case 'TFNG': {
      const typed = cloned as TFNGBlock;
      return {
        ...typed,
        id: nextBlockId,
        questions: typed.questions.map((question) => ({
          ...question,
          id: createId('q'),
        })),
      };
    }

    case 'CLOZE': {
      const typed = cloned as ClozeBlock;
      return {
        ...typed,
        id: nextBlockId,
        questions: typed.questions.map((question) => ({
          ...question,
          id: createId('q'),
        })),
      };
    }

    case 'MATCHING': {
      const typed = cloned as MatchingBlock;
      return {
        ...typed,
        id: nextBlockId,
        headings: typed.headings.map((heading) => ({
          ...heading,
          id: createId('h'),
        })),
        questions: typed.questions.map((question) => ({
          ...question,
          id: createId('q'),
        })),
      };
    }

    case 'MAP': {
      const typed = cloned as MapBlock;
      return {
        ...typed,
        id: nextBlockId,
        questions: typed.questions.map((question) => ({
          ...question,
          id: createId('q'),
        })),
      };
    }

    case 'MULTI_MCQ': {
      const typed = cloned as MultiMCQBlock;
      return {
        ...typed,
        id: nextBlockId,
        options: typed.options.map((option) => ({
          ...option,
          id: createId('opt'),
        })),
      };
    }

    case 'SINGLE_MCQ': {
      const typed = cloned as SingleMCQBlock;
      const legacyOptions = typed.options.map((option) => ({
        ...option,
        id: createId('opt'),
      }));
      const clonedQuestions = Array.isArray(typed.questions)
        ? typed.questions.map((question) => ({
            ...question,
            id: createId('q'),
            options: question.options.map((option) => ({
              ...option,
              id: createId('opt'),
            })),
          }))
        : undefined;
      const firstQuestion = clonedQuestions?.[0];
      return {
        ...typed,
        id: nextBlockId,
        stem: firstQuestion?.stem ?? typed.stem,
        options: firstQuestion?.options ?? legacyOptions,
        ...(clonedQuestions ? { questions: clonedQuestions } : {}),
      };
    }

    case 'SHORT_ANSWER': {
      const typed = cloned as ShortAnswerBlock;
      return {
        ...typed,
        id: nextBlockId,
        questions: typed.questions.map((question) => ({
          ...question,
          id: createId('q'),
        })),
      };
    }

    case 'SENTENCE_COMPLETION': {
      const typed = cloned as SentenceCompletionBlock;
      return {
        ...typed,
        id: nextBlockId,
        questions: typed.questions.map((question) => ({
          ...question,
          id: createId('q'),
          blanks: question.blanks.map((blank) => ({
            ...blank,
            id: createId('blank'),
          })),
        })),
      };
    }

    case 'DIAGRAM_LABELING': {
      const typed = cloned as DiagramLabelingBlock;
      return {
        ...typed,
        id: nextBlockId,
        labels: typed.labels.map((label) => ({
          ...label,
          id: createId('lbl'),
        })),
      };
    }

    case 'FLOW_CHART': {
      const typed = cloned as FlowChartBlock;
      return {
        ...typed,
        id: nextBlockId,
        steps: typed.steps.map((step) => ({
          ...step,
          id: createId('step'),
        })),
      };
    }

    case 'TABLE_COMPLETION': {
      const typed = cloned as TableCompletionBlock;
      return {
        ...typed,
        id: nextBlockId,
        cells: typed.cells.map((cell) => ({
          ...cell,
          id: createId('cell'),
        })),
      };
    }

    case 'NOTE_COMPLETION': {
      const typed = cloned as NoteCompletionBlock;
      return {
        ...typed,
        id: nextBlockId,
        questions: typed.questions.map((question) => ({
          ...question,
          id: createId('q'),
          blanks: question.blanks.map((blank) => ({
            ...blank,
            id: createId('blank'),
          })),
        })),
      };
    }

    case 'CLASSIFICATION': {
      const typed = cloned as ClassificationBlock;
      return {
        ...typed,
        id: nextBlockId,
        items: typed.items.map((item) => ({
          ...item,
          id: createId('item'),
        })),
      };
    }

    case 'MATCHING_FEATURES': {
      const typed = cloned as MatchingFeaturesBlock;
      return {
        ...typed,
        id: nextBlockId,
        features: typed.features.map((feature) => ({
          ...feature,
          id: createId('feat'),
        })),
      };
    }
  }
}

export function cloneReadingPassageWithNewIds(passage: Passage): Passage {
  const cloned = deepClone(passage);
  return {
    ...cloned,
    id: createId('passage'),
    blocks: cloned.blocks.map(cloneQuestionBlockWithNewIds),
    images: Array.isArray(cloned.images)
      ? cloned.images.map(cloneStimulusImageAssetWithNewIds)
      : [],
    metadata: cloned.metadata
      ? {
          ...cloned.metadata,
          id: createId('passage_meta'),
        }
      : undefined,
  };
}

export function cloneListeningPartWithNewIds(part: ListeningPart): ListeningPart {
  const cloned = deepClone(part);
  return {
    ...cloned,
    id: createId('part'),
    pins: Array.isArray(cloned.pins)
      ? cloned.pins.map((pin) => ({
          ...pin,
          id: createId('pin'),
        }))
      : [],
    blocks: cloned.blocks.map(cloneQuestionBlockWithNewIds),
  };
}
