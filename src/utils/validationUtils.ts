import { 
  QuestionBlock, 
  SingleMCQBlock, 
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
  MatchingFeature
} from '../types';
import { countBlankPlaceholders } from './blankPlaceholders';

export interface ValidationError {
  field: string;
  message: string;
}

export function validateQuestionBlock(block: QuestionBlock): ValidationError[] {
  const errors: ValidationError[] = [];

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

  return errors;
}

function validateSingleMCQ(block: SingleMCQBlock): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!block.stem || block.stem.trim() === '') {
    errors.push({ field: 'stem', message: 'Question stem is required' });
  }

  if (!block.options || block.options.length < 2) {
    errors.push({ field: 'options', message: 'At least 2 options are required' });
  }

  const correctCount = block.options?.filter((opt: MCQOption) => opt.isCorrect).length || 0;
  if (correctCount !== 1) {
    errors.push({ field: 'options', message: 'Exactly one option must be marked as correct' });
  }

  block.options?.forEach((opt: MCQOption, index: number) => {
    if (!opt.text || opt.text.trim() === '') {
      errors.push({ field: `option-${index}`, message: `Option ${index + 1} text is required` });
    }
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
    if (!q.correctAnswer || q.correctAnswer.trim() === '') {
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
    q.blanks?.forEach((blank: SentenceBlank, blankIndex: number) => {
      if (!blank.correctAnswer || blank.correctAnswer.trim() === '') {
        errors.push({ field: `sentence-${index}-blank-${blankIndex}`, message: `Blank ${blankIndex + 1} answer is required` });
      }
    });
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

  block.cells?.forEach((cell: TableCell, index: number) => {
    if (!cell.correctAnswer || cell.correctAnswer.trim() === '') {
      errors.push({ field: `cell-${index}`, message: `Cell ${index + 1} answer is required` });
    }
    if (cell.row < 0 || cell.row >= block.rows.length) {
      errors.push({ field: `cell-${index}-row`, message: `Cell ${index + 1} row is invalid` });
    }
    if (cell.col < 0 || cell.col >= block.headers.length) {
      errors.push({ field: `cell-${index}-col`, message: `Cell ${index + 1} column is invalid` });
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
      if (!blank.correctAnswer || blank.correctAnswer.trim() === '') {
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
