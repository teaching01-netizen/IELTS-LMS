import {
  QuestionBlock, 
  SingleMCQBlock, 
  SingleMCQQuestion,
  MCQOption, 
  ShortAnswerBlock, 
  ShortAnswerQuestion,
  SentenceCompletionBlock,
  SentenceCompletionQuestion,
  SentenceBlank,
  DiagramLabelingBlock,
  DiagramLabel,
  FlowChartBlock,
  FlowChartStep,
  TableCompletionBlock,
  TableCell,
  NoteCompletionBlock,
  NoteCompletionQuestion,
  NoteBlank,
  ClassificationBlock,
  ClassificationItem,
  MatchingFeaturesBlock,
  MatchingFeature,
  SlotGroupRule,
  SubAnswerTreeNode,
} from '../types';
import { countBlankPlaceholders } from './blankPlaceholders';
import { resolveAcceptedAnswers } from './acceptedAnswers';
import { analyzeTablePlaceholders, getCanonicalTableCells } from './tableCompletion';
import { getInsertedImages, supportsInsertedImages } from './insertedImages';
import { hasSubAnswerTreeMode, validateSubAnswerTree } from './subAnswerTree';
import { healSubAnswerTreeForBlock } from './subAnswerTreeSlots';

export interface ValidationError {
  field: string;
  message: string;
}

export function validateQuestionBlock(block: QuestionBlock): ValidationError[] {
  const errors: ValidationError[] = [];

  if (hasSubAnswerTreeMode(block)) {
    const tree = healSubAnswerTreeForBlock(
      block,
      1,
      (block as QuestionBlock & { answerTree?: SubAnswerTreeNode[] }).answerTree,
    );
    errors.push(
      ...validateSubAnswerTree(tree).map((issue) => ({
        field: issue.field,
        message: issue.message,
      })),
    );
    errors.push(...validateInsertedImageSet(block));
    return errors;
  }

  // Type-specific validation
  switch (block.type) {
    case 'SINGLE_MCQ':
      errors.push(...validateSingleMCQ(block));
      break;
    case 'SHORT_ANSWER':
      errors.push(...validateShortAnswer(block));
      break;
    case 'SENTENCE_COMPLETION':
      errors.push(...validateSentenceCompletion(block));
      break;
    case 'DIAGRAM_LABELING':
      errors.push(...validateDiagramLabeling(block));
      break;
    case 'FLOW_CHART':
      errors.push(...validateFlowChart(block));
      break;
    case 'TABLE_COMPLETION':
      errors.push(...validateTableCompletion(block));
      break;
    case 'NOTE_COMPLETION':
      errors.push(...validateNoteCompletion(block));
      break;
    case 'CLASSIFICATION':
      errors.push(...validateClassification(block));
      break;
    case 'MATCHING_FEATURES':
      errors.push(...validateMatchingFeatures(block));
      break;
    case 'TFNG':
    case 'CLOZE':
    case 'MATCHING':
    case 'MAP':
    case 'MULTI_MCQ':
      // Existing types - validation already implemented elsewhere
      break;
  }

  errors.push(...validateInsertedImageSet(block));

  return errors;
}

function validateInsertedImageSet(block: QuestionBlock): ValidationError[] {
  if (!supportsInsertedImages(block)) {
    return [];
  }

  const errors: ValidationError[] = [];
  const insertedImages = getInsertedImages(block);

  insertedImages.forEach((image, index) => {
    if (!image.url.trim()) {
      errors.push({
        field: `insertedImages[${index}].url`,
        message: `Inserted image ${index + 1} URL is required`,
      });
    }
  });

  return errors;
}

function validateSingleMCQ(block: SingleMCQBlock): ValidationError[] {
  const errors: ValidationError[] = [];
  const hasQuestionList = Array.isArray(block.questions) && block.questions.length > 0;
  const questions: SingleMCQQuestion[] = hasQuestionList
    ? block.questions!
    : [{ id: block.id, stem: block.stem || '', options: block.options || [] }];

  if (questions.length === 0) {
    errors.push({ field: 'questions', message: 'At least one question is required' });
    return errors;
  }

  questions.forEach((question, questionIndex) => {
    const stemField = hasQuestionList ? `questions[${questionIndex}].stem` : 'stem';
    const optionsField = hasQuestionList ? `questions[${questionIndex}].options` : 'options';

    if (!question.stem || question.stem.trim() === '') {
      errors.push({ field: stemField, message: `Question ${questionIndex + 1} stem is required` });
    }

    if (!Array.isArray(question.options) || question.options.length < 2) {
      errors.push({ field: optionsField, message: `Question ${questionIndex + 1} needs at least 2 options` });
      return;
    }

    const correctCount = question.options.filter((opt: MCQOption) => opt.isCorrect).length;
    if (correctCount !== 1) {
      errors.push({ field: optionsField, message: `Question ${questionIndex + 1} must have exactly one correct option` });
    }

    question.options.forEach((opt: MCQOption, optionIndex: number) => {
      if (!opt.text || opt.text.trim() === '') {
        errors.push({
          field: hasQuestionList
            ? `questions[${questionIndex}].options[${optionIndex}].text`
            : `option-${optionIndex}`,
          message: `Option ${optionIndex + 1} text is required`,
        });
      }
    });
  });

  return errors;
}

function validateShortAnswer(block: ShortAnswerBlock): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!block.questions || block.questions.length === 0) {
    errors.push({ field: 'questions', message: 'At least one question is required' });
  }

  block.questions?.forEach((q: ShortAnswerQuestion, index: number) => {
    if (!q.prompt || q.prompt.trim() === '') {
      errors.push({ field: `question-${index}-prompt`, message: `Question ${index + 1} prompt is required` });
    }
    if (resolveAcceptedAnswers(q).length === 0) {
      errors.push({ field: `question-${index}-answer`, message: `Question ${index + 1} correct answer is required` });
    }
  });

  return errors;
}

function validateSentenceCompletion(block: SentenceCompletionBlock): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!block.questions || block.questions.length === 0) {
    errors.push({ field: 'questions', message: 'At least one sentence is required' });
  }

  block.questions?.forEach((q: SentenceCompletionQuestion, index: number) => {
    if (!q.sentence || q.sentence.trim() === '') {
      errors.push({ field: `sentence-${index}`, message: `Sentence ${index + 1} text is required` });
    }
    const placeholderCount = countBlankPlaceholders(q.sentence);
    if (placeholderCount === 0) {
      errors.push({ field: `sentence-${index}-blanks`, message: `Sentence ${index + 1} must include at least one blank placeholder (____)` });
    } else if (!q.blanks || q.blanks.length !== placeholderCount) {
      errors.push({ field: `sentence-${index}-blanks`, message: `Sentence ${index + 1} blanks must match the number of ____ placeholders` });
    }
    if (q.acceptAnyAnswerKey !== true) {
      q.blanks?.forEach((blank: SentenceBlank, blankIndex: number) => {
        if (resolveAcceptedAnswers(blank).length === 0) {
          errors.push({ field: `sentence-${index}-blank-${blankIndex}`, message: `Blank ${blankIndex + 1} answer is required` });
        }
      });
    }
    errors.push(
      ...validateGroupedSlotScoring(
        q.blanks ?? [],
        `sentence-${index}`,
        'Blank',
      ),
    );
  });

  return errors;
}

function validateDiagramLabeling(block: DiagramLabelingBlock): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!block.imageUrl || block.imageUrl.trim() === '') {
    errors.push({ field: 'imageUrl', message: 'Diagram image URL is required' });
  }

  if (!block.labels || block.labels.length === 0) {
    errors.push({ field: 'labels', message: 'At least one label is required' });
  }

  block.labels?.forEach((label: DiagramLabel, index: number) => {
    if (!label.correctAnswer || label.correctAnswer.trim() === '') {
      errors.push({ field: `label-${index}`, message: `Label ${index + 1} answer is required` });
    }
  });

  return errors;
}

function validateFlowChart(block: FlowChartBlock): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!block.steps || block.steps.length === 0) {
    errors.push({ field: 'steps', message: 'At least one step is required' });
  }

  block.steps?.forEach((step: FlowChartStep, index: number) => {
    if (!step.label || step.label.trim() === '') {
      errors.push({ field: `step-${index}`, message: `Step ${index + 1} label is required` });
    }
    if (!step.correctAnswer || step.correctAnswer.trim() === '') {
      errors.push({ field: `step-${index}-answer`, message: `Step ${index + 1} answer is required` });
    }
  });

  return errors;
}

function validateTableCompletion(block: TableCompletionBlock): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!block.headers || block.headers.length < 2) {
    errors.push({ field: 'headers', message: 'At least 2 table headers are required' });
  }

  if (!block.rows || block.rows.length === 0) {
    errors.push({ field: 'rows', message: 'At least one table row is required' });
  }

  block.headers?.forEach((header: string, index: number) => {
    if (!header || header.trim() === '') {
      errors.push({ field: `header-${index}`, message: `Header ${index + 1} is required` });
    }
  });

  const placeholderAnalysis = analyzeTablePlaceholders(block.rows ?? [], block.headers?.length ?? 0);
  if (placeholderAnalysis.slots.length === 0) {
    errors.push({ field: 'rows-placeholders', message: 'At least one blank placeholder (____) is required' });
  }

  const canonicalCells = getCanonicalTableCells(block);
  if (canonicalCells.length !== placeholderAnalysis.slots.length) {
    errors.push({
      field: 'cells-mismatch',
      message: 'Answer cells must match table placeholders',
    });
  }

  canonicalCells.forEach((cell: TableCell, index: number) => {
    if (resolveAcceptedAnswers(cell).length === 0) {
      errors.push({ field: `cell-${index}`, message: `Cell ${index + 1} answer is required` });
    }
    if (cell.row < 0 || cell.row >= block.rows.length) {
      errors.push({ field: `cell-${index}-row`, message: `Cell ${index + 1} row is invalid` });
    }
    if (cell.col < 0 || cell.col >= block.headers.length) {
      errors.push({ field: `cell-${index}-col`, message: `Cell ${index + 1} column is invalid` });
    }
  });
  errors.push(
    ...validateGroupedSlotScoring(canonicalCells, 'table-cells', 'Cell'),
  );

  return errors;
}

type GroupedSlotCandidate = {
  scoreGroupId?: string;
  scoreWeight?: number;
  groupRule?: SlotGroupRule;
  requiredCorrect?: number;
};

function normalizeScoreGroupId(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validateGroupedSlotScoring(
  slots: GroupedSlotCandidate[],
  fieldPrefix: string,
  slotLabel: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const groupedSlots = new Map<string, Array<{ slot: GroupedSlotCandidate; index: number }>>();

  slots.forEach((slot, index) => {
    const groupId = normalizeScoreGroupId(slot.scoreGroupId);
    const hasGroupOnlyFields =
      slot.groupRule !== undefined
      || slot.requiredCorrect !== undefined
      || slot.scoreWeight !== undefined;

    if (!groupId && hasGroupOnlyFields) {
      errors.push({
        field: `${fieldPrefix}-${index}-score-group`,
        message: `${slotLabel} ${index + 1} must define scoreGroupId when grouped scoring fields are used`,
      });
      return;
    }

    if (slot.scoreWeight !== undefined) {
      const scoreWeight = Number(slot.scoreWeight);
      if (!Number.isFinite(scoreWeight) || scoreWeight < 0) {
        errors.push({
          field: `${fieldPrefix}-${index}-score-weight`,
          message: `${slotLabel} ${index + 1} score weight must be a non-negative number`,
        });
      }
    }

    if (!groupId) return;
    const bucket = groupedSlots.get(groupId);
    if (bucket) {
      bucket.push({ slot, index });
    } else {
      groupedSlots.set(groupId, [{ slot, index }]);
    }
  });

  groupedSlots.forEach((groupSlots, groupId) => {
    const rules = Array.from(
      new Set(
        groupSlots
          .map(({ slot }) => slot.groupRule)
          .filter((rule): rule is SlotGroupRule => rule === 'all_required' || rule === 'at_least_n'),
      ),
    );
    if (rules.length > 1) {
      errors.push({
        field: `${fieldPrefix}-group-${groupId}-rule`,
        message: `Grouped scoring "${groupId}" must use one consistent rule`,
      });
      return;
    }

    const effectiveRule = rules[0] ?? 'all_required';
    if (effectiveRule !== 'at_least_n') {
      return;
    }

    const requirements = Array.from(
      new Set(
        groupSlots
          .map(({ slot }) => slot.requiredCorrect)
          .filter((value): value is number => Number.isFinite(value)),
      ),
    );
    if (requirements.length > 1) {
      errors.push({
        field: `${fieldPrefix}-group-${groupId}-required`,
        message: `Grouped scoring "${groupId}" must use one consistent required-correct value`,
      });
      return;
    }

    const requiredCorrect = requirements[0];
    if (requiredCorrect === undefined || !Number.isInteger(requiredCorrect) || requiredCorrect < 1) {
      errors.push({
        field: `${fieldPrefix}-group-${groupId}-required`,
        message: `Grouped scoring "${groupId}" must define requiredCorrect as an integer >= 1`,
      });
      return;
    }

    if (requiredCorrect > groupSlots.length) {
      errors.push({
        field: `${fieldPrefix}-group-${groupId}-required`,
        message: `Grouped scoring "${groupId}" requires ${requiredCorrect} correct answers but has only ${groupSlots.length} slot(s)`,
      });
    }
  });

  return errors;
}

function validateNoteCompletion(block: NoteCompletionBlock): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!block.questions || block.questions.length === 0) {
    errors.push({ field: 'questions', message: 'At least one note is required' });
  }

  block.questions?.forEach((q: NoteCompletionQuestion, index: number) => {
    if (!q.noteText || q.noteText.trim() === '') {
      errors.push({ field: `note-${index}`, message: `Note ${index + 1} text is required` });
    }
    const placeholderCount = countBlankPlaceholders(q.noteText);
    if (placeholderCount === 0) {
      errors.push({ field: `note-${index}-blanks`, message: `Note ${index + 1} must include at least one blank placeholder (____)` });
    } else if (!q.blanks || q.blanks.length !== placeholderCount) {
      errors.push({ field: `note-${index}-blanks`, message: `Note ${index + 1} blanks must match the number of ____ placeholders` });
    }
    q.blanks?.forEach((blank: NoteBlank, blankIndex: number) => {
      if (resolveAcceptedAnswers(blank).length === 0) {
        errors.push({ field: `note-${index}-blank-${blankIndex}`, message: `Blank ${blankIndex + 1} answer is required` });
      }
    });
  });

  return errors;
}

function validateClassification(block: ClassificationBlock): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!block.categories || block.categories.length < 2) {
    errors.push({ field: 'categories', message: 'At least 2 categories are required' });
  }

  if (!block.items || block.items.length === 0) {
    errors.push({ field: 'items', message: 'At least one item is required' });
  }

  block.categories?.forEach((category: string, index: number) => {
    if (!category || category.trim() === '') {
      errors.push({ field: `category-${index}`, message: `Category ${index + 1} is required` });
    }
  });

  block.items?.forEach((item: ClassificationItem, index: number) => {
    if (!item.text || item.text.trim() === '') {
      errors.push({ field: `item-${index}`, message: `Item ${index + 1} text is required` });
    }
    if (!item.correctCategory || !block.categories.includes(item.correctCategory)) {
      errors.push({ field: `item-${index}-category`, message: `Item ${index + 1} must be assigned to a valid category` });
    }
  });

  return errors;
}

function validateMatchingFeatures(block: MatchingFeaturesBlock): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!block.features || block.features.length === 0) {
    errors.push({ field: 'features', message: 'At least one feature is required' });
  }

  if (!block.options || block.options.length < 2) {
    errors.push({ field: 'options', message: 'At least 2 matching options are required' });
  }

  block.features?.forEach((feature: MatchingFeature, index: number) => {
    if (!feature.text || feature.text.trim() === '') {
      errors.push({ field: `feature-${index}`, message: `Feature ${index + 1} text is required` });
    }
    if (!feature.correctMatch || !block.options.includes(feature.correctMatch)) {
      errors.push({ field: `feature-${index}-match`, message: `Feature ${index + 1} must match a valid option` });
    }
  });

  block.options?.forEach((option: string, index: number) => {
    if (!option || option.trim() === '') {
      errors.push({ field: `option-${index}`, message: `Option ${index + 1} is required` });
    }
  });

  return errors;
}
