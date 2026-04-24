import {
  Exam, ExamConfig, ModuleType, QuestionBlock, Passage, ListeningPart,
  TFNGBlock, ClozeBlock, MatchingBlock, MapBlock, MultiMCQBlock,
  ValidationError, BlockValidation, ExamState,
  TFNGQuestion, ClozeQuestion, MatchingQuestion, MapQuestion, StimulusImageAsset,
  SingleMCQBlock, ShortAnswerBlock, SentenceCompletionBlock, DiagramLabelingBlock,
  FlowChartBlock, TableCompletionBlock, NoteCompletionBlock, ClassificationBlock,
  MatchingFeaturesBlock, ShortAnswerQuestion, SentenceCompletionQuestion,
  NoteCompletionQuestion, ClassificationItem, MatchingFeature
} from '../types';
import { createDefaultConfig, normalizeExamConfig } from '../constants/examDefaults';
import { hydrateExamState } from '../services/examAdapterService';

export const getBlockQuestionCount = (block: QuestionBlock): number => {
  switch (block.type) {
    case 'TFNG':
      return block.questions.length;
    case 'CLOZE':
      return block.questions.length;
    case 'MATCHING':
      return block.questions.length;
    case 'MAP':
      return block.questions.length;
    case 'MULTI_MCQ':
      return block.requiredSelections;
    case 'SINGLE_MCQ':
      return 1;
    case 'SHORT_ANSWER':
      return block.questions.length;
    case 'SENTENCE_COMPLETION':
      return block.questions.reduce((acc, q) => acc + q.blanks.length, 0);
    case 'DIAGRAM_LABELING':
      return block.labels.length;
    case 'FLOW_CHART':
      return block.steps.length;
    case 'TABLE_COMPLETION':
      return block.cells.length;
    case 'NOTE_COMPLETION':
      return block.questions.reduce((acc, q) => acc + q.blanks.length, 0);
    case 'CLASSIFICATION':
      return block.items.length;
    case 'MATCHING_FEATURES':
      return block.features.length;
    default:
      return 0;
  }
};

export const getBlockSpan = (blocks: QuestionBlock[], startNumber: number): { startNum: number; endNum: number }[] => {
  let currentNum = startNumber;
  return blocks.map(block => {
    const count = getBlockQuestionCount(block);
    const start = currentNum;
    const end = currentNum + Math.max(0, count - 1);
    currentNum += count;
    return { startNum: start, endNum: end };
  });
};

export const getPassageQuestionCount = (passage: Passage): number => {
  return passage.blocks.reduce((acc, block) => acc + getBlockQuestionCount(block), 0);
};

export const getPartQuestionCount = (part: ListeningPart): number => {
  return part.blocks.reduce((acc, block) => acc + getBlockQuestionCount(block), 0);
};

export const getReadingTotalQuestions = (passages: Passage[]): number => {
  return passages.reduce((acc, p) => acc + getPassageQuestionCount(p), 0);
};

export const getListeningTotalQuestions = (parts: ListeningPart[]): number => {
  return parts.reduce((acc, p) => acc + getPartQuestionCount(p), 0);
};

export const flattenReadingQuestions = (passages: Passage[]): Array<{ passageId: string; block: QuestionBlock; question: TFNGQuestion | ClozeQuestion | MatchingQuestion | MapQuestion | ShortAnswerQuestion | SentenceCompletionQuestion | NoteCompletionQuestion | null; index: number }> => {
  const result: Array<{ passageId: string; block: QuestionBlock; question: TFNGQuestion | ClozeQuestion | MatchingQuestion | MapQuestion | ShortAnswerQuestion | SentenceCompletionQuestion | NoteCompletionQuestion | null; index: number }> = [];
  let globalIndex = 0;

  for (const passage of passages) {
    for (const block of passage.blocks) {
      // Blocks without questions array - treat as single question
      if (block.type === 'MULTI_MCQ' || block.type === 'SINGLE_MCQ' ||
          block.type === 'DIAGRAM_LABELING' || block.type === 'FLOW_CHART' ||
          block.type === 'TABLE_COMPLETION' || block.type === 'CLASSIFICATION' ||
          block.type === 'MATCHING_FEATURES') {
        result.push({ passageId: passage.id, block, question: null, index: globalIndex++ });
      } else if ('questions' in block) {
        // Blocks with questions array
        for (const q of block.questions) {
          result.push({ passageId: passage.id, block, question: q, index: globalIndex++ });
        }
      }
    }
  }

  return result;
};

export const flattenListeningQuestions = (parts: ListeningPart[]): Array<{ partId: string; block: QuestionBlock; question: TFNGQuestion | ClozeQuestion | MatchingQuestion | MapQuestion | ShortAnswerQuestion | SentenceCompletionQuestion | NoteCompletionQuestion | null; index: number }> => {
  const result: Array<{ partId: string; block: QuestionBlock; question: TFNGQuestion | ClozeQuestion | MatchingQuestion | MapQuestion | ShortAnswerQuestion | SentenceCompletionQuestion | NoteCompletionQuestion | null; index: number }> = [];
  let globalIndex = 0;

  for (const part of parts) {
    for (const block of part.blocks) {
      // Blocks without questions array - treat as single question
      if (block.type === 'MULTI_MCQ' || block.type === 'SINGLE_MCQ' ||
          block.type === 'DIAGRAM_LABELING' || block.type === 'FLOW_CHART' ||
          block.type === 'TABLE_COMPLETION' || block.type === 'CLASSIFICATION' ||
          block.type === 'MATCHING_FEATURES') {
        result.push({ partId: part.id, block, question: null, index: globalIndex++ });
      } else if ('questions' in block) {
        // Blocks with questions array
        for (const q of block.questions) {
          result.push({ partId: part.id, block, question: q, index: globalIndex++ });
        }
      }
    }
  }

  return result;
};

const validateTFNGBlock = (block: TFNGBlock): ValidationError[] => {
  const errors: ValidationError[] = [];
  
  if (block.questions.length === 0) {
    errors.push({ blockId: block.id, field: 'questions', message: 'At least one question is required', type: 'error' });
  }
  
  block.questions.forEach((q, i) => {
    if (!q.statement.trim()) {
      errors.push({ blockId: block.id, field: `questions[${i}].statement`, message: `Question ${i + 1} statement is empty`, type: 'error' });
    }
    if (!q.correctAnswer) {
      errors.push({ blockId: block.id, field: `questions[${i}].correctAnswer`, message: `Question ${i + 1} has no correct answer`, type: 'error' });
    }
  });
  
  return errors;
};

const validateClozeBlock = (block: ClozeBlock): ValidationError[] => {
  const errors: ValidationError[] = [];
  
  if (block.questions.length === 0) {
    errors.push({ blockId: block.id, field: 'questions', message: 'At least one question is required', type: 'error' });
  }
  
  block.questions.forEach((q, i) => {
    if (!q.prompt.trim()) {
      errors.push({ blockId: block.id, field: `questions[${i}].prompt`, message: `Question ${i + 1} prompt is empty`, type: 'error' });
    }
    if (!q.correctAnswer.trim()) {
      errors.push({ blockId: block.id, field: `questions[${i}].correctAnswer`, message: `Question ${i + 1} has no correct answer`, type: 'error' });
    }
  });
  
  return errors;
};

const validateMatchingBlock = (block: MatchingBlock): ValidationError[] => {
  const errors: ValidationError[] = [];
  
  if (block.headings.length === 0) {
    errors.push({ blockId: block.id, field: 'headings', message: 'At least one heading is required', type: 'error' });
  }
  
  block.headings.forEach((h, i) => {
    if (!h.text.trim()) {
      errors.push({ blockId: block.id, field: `headings[${i}].text`, message: `Heading ${i + 1} is empty`, type: 'warning' });
    }
  });
  
  if (block.questions.length === 0) {
    errors.push({ blockId: block.id, field: 'questions', message: 'At least one paragraph is required', type: 'error' });
  }

  const allowedHeadings = new Set(block.headings.map((_, i) => toRoman(i)));
  block.questions.forEach((q, i) => {
    const heading = q.correctHeading?.trim() ?? '';
    if (!heading) {
      errors.push({
        blockId: block.id,
        field: `questions[${i}].correctHeading`,
        message: `Paragraph ${q.paragraphLabel || String.fromCharCode(65 + i)} has no heading selected`,
        type: 'error',
      });
      return;
    }

    if (!allowedHeadings.has(heading)) {
      errors.push({
        blockId: block.id,
        field: `questions[${i}].correctHeading`,
        message: `Paragraph ${q.paragraphLabel || String.fromCharCode(65 + i)} has an invalid heading selected`,
        type: 'error',
      });
    }
  });
  
  const usedHeadings = new Set(
    block.questions
      .map((q) => q.correctHeading?.trim() ?? '')
      .filter((heading): heading is string => Boolean(heading && allowedHeadings.has(heading))),
  );
  const hasUnusedHeadings = block.headings.some((_, i) => {
    const roman = toRoman(i);
    return !usedHeadings.has(roman);
  });
  
  if (hasUnusedHeadings) {
    errors.push({ blockId: block.id, field: 'headings', message: 'Some headings are not assigned to any paragraph', type: 'warning' });
  }
  
  return errors;
};

const validateMapBlock = (block: MapBlock): ValidationError[] => {
  const errors: ValidationError[] = [];
  
  if (!block.assetUrl.trim()) {
    errors.push({ blockId: block.id, field: 'assetUrl', message: 'Image URL is required', type: 'error' });
  } else if (!isValidUrl(block.assetUrl)) {
    errors.push({ blockId: block.id, field: 'assetUrl', message: 'Image URL is invalid', type: 'error' });
  }
  
  if (block.questions.length === 0) {
    errors.push({ blockId: block.id, field: 'questions', message: 'At least one hotspot is required', type: 'error' });
  }
  
  block.questions.forEach((q, i) => {
    if (!q.label.trim()) {
      errors.push({ blockId: block.id, field: `questions[${i}].label`, message: `Hotspot ${i + 1} label is empty`, type: 'warning' });
    }
    if (!q.correctAnswer.trim()) {
      errors.push({ blockId: block.id, field: `questions[${i}].correctAnswer`, message: `Hotspot ${i + 1} has no correct answer`, type: 'error' });
    }
    if (q.x < 0 || q.x > 100 || q.y < 0 || q.y > 100) {
      errors.push({ blockId: block.id, field: `questions[${i}].position`, message: `Hotspot ${i + 1} has invalid coordinates`, type: 'error' });
    }
  });
  
  return errors;
};

const validateMultiMCQBlock = (block: MultiMCQBlock): ValidationError[] => {
  const errors: ValidationError[] = [];
  
  if (!block.stem.trim()) {
    errors.push({ blockId: block.id, field: 'stem', message: 'Question stem is required', type: 'error' });
  }
  
  if (block.requiredSelections < 1 || block.requiredSelections > 4) {
    errors.push({ blockId: block.id, field: 'requiredSelections', message: 'Required selections must be between 1 and 4', type: 'error' });
  }
  
  if (block.options.length < 2) {
    errors.push({ blockId: block.id, field: 'options', message: 'At least 2 options are required', type: 'error' });
  }
  
  const correctCount = block.options.filter(o => o.isCorrect).length;
  if (correctCount !== block.requiredSelections) {
    errors.push({
      blockId: block.id,
      field: 'options',
      message: `Must have exactly ${block.requiredSelections} correct option(s), currently has ${correctCount}`,
      type: 'error'
    });
  }
  
  block.options.forEach((o, i) => {
    if (!o.text.trim()) {
      errors.push({ blockId: block.id, field: `options[${i}].text`, message: `Option ${i + 1} is empty`, type: 'error' });
    }
  });
  
  return errors;
};

const validateSingleMCQBlock = (block: SingleMCQBlock): ValidationError[] => {
  const errors: ValidationError[] = [];
  
  if (!block.stem.trim()) {
    errors.push({ blockId: block.id, field: 'stem', message: 'Question stem is required', type: 'error' });
  }
  
  if (block.options.length < 2) {
    errors.push({ blockId: block.id, field: 'options', message: 'At least 2 options are required', type: 'error' });
  }
  
  const correctCount = block.options.filter(o => o.isCorrect).length;
  if (correctCount !== 1) {
    errors.push({
      blockId: block.id,
      field: 'options',
      message: `Must have exactly 1 correct option, currently has ${correctCount}`,
      type: 'error'
    });
  }
  
  block.options.forEach((o, i) => {
    if (!o.text.trim()) {
      errors.push({ blockId: block.id, field: `options[${i}].text`, message: `Option ${i + 1} is empty`, type: 'error' });
    }
  });
  
  return errors;
};

const validateShortAnswerBlock = (block: ShortAnswerBlock): ValidationError[] => {
  const errors: ValidationError[] = [];
  
  if (block.questions.length === 0) {
    errors.push({ blockId: block.id, field: 'questions', message: 'At least one question is required', type: 'error' });
  }
  
  block.questions.forEach((q, i) => {
    if (!q.prompt.trim()) {
      errors.push({ blockId: block.id, field: `questions[${i}].prompt`, message: `Question ${i + 1} prompt is empty`, type: 'error' });
    }
    if (!q.correctAnswer.trim()) {
      errors.push({ blockId: block.id, field: `questions[${i}].correctAnswer`, message: `Question ${i + 1} has no correct answer`, type: 'error' });
    }
  });
  
  return errors;
};

const validateSentenceCompletionBlock = (block: SentenceCompletionBlock): ValidationError[] => {
  const errors: ValidationError[] = [];
  
  if (block.questions.length === 0) {
    errors.push({ blockId: block.id, field: 'questions', message: 'At least one sentence is required', type: 'error' });
  }
  
  block.questions.forEach((q, i) => {
    if (!q.sentence.trim()) {
      errors.push({ blockId: block.id, field: `questions[${i}].sentence`, message: `Sentence ${i + 1} is empty`, type: 'error' });
    }
    if (q.blanks.length === 0) {
      errors.push({ blockId: block.id, field: `questions[${i}].blanks`, message: `Sentence ${i + 1} has no blanks`, type: 'error' });
    }
    q.blanks.forEach((blank, j) => {
      if (!blank.correctAnswer.trim()) {
        errors.push({ blockId: block.id, field: `questions[${i}].blanks[${j}].correctAnswer`, message: `Blank ${j + 1} in sentence ${i + 1} has no answer`, type: 'error' });
      }
    });
  });
  
  return errors;
};

const validateDiagramLabelingBlock = (block: DiagramLabelingBlock): ValidationError[] => {
  const errors: ValidationError[] = [];
  
  if (!block.imageUrl.trim()) {
    errors.push({ blockId: block.id, field: 'imageUrl', message: 'Diagram image URL is required', type: 'error' });
  } else if (!isValidUrl(block.imageUrl)) {
    errors.push({ blockId: block.id, field: 'imageUrl', message: 'Diagram image URL is invalid', type: 'error' });
  }
  
  if (block.labels.length === 0) {
    errors.push({ blockId: block.id, field: 'labels', message: 'At least one label is required', type: 'error' });
  }
  
  block.labels.forEach((label, i) => {
    if (!label.correctAnswer.trim()) {
      errors.push({ blockId: block.id, field: `labels[${i}].correctAnswer`, message: `Label ${i + 1} has no answer`, type: 'error' });
    }
  });
  
  return errors;
};

const validateFlowChartBlock = (block: FlowChartBlock): ValidationError[] => {
  const errors: ValidationError[] = [];
  
  if (block.steps.length === 0) {
    errors.push({ blockId: block.id, field: 'steps', message: 'At least one step is required', type: 'error' });
  }
  
  block.steps.forEach((step, i) => {
    if (!step.label.trim()) {
      errors.push({ blockId: block.id, field: `steps[${i}].label`, message: `Step ${i + 1} label is empty`, type: 'error' });
    }
    if (!step.correctAnswer.trim()) {
      errors.push({ blockId: block.id, field: `steps[${i}].correctAnswer`, message: `Step ${i + 1} has no answer`, type: 'error' });
    }
  });
  
  return errors;
};

const validateTableCompletionBlock = (block: TableCompletionBlock): ValidationError[] => {
  const errors: ValidationError[] = [];
  
  if (block.headers.length === 0) {
    errors.push({ blockId: block.id, field: 'headers', message: 'At least one header is required', type: 'error' });
  }
  
  if (block.rows.length === 0) {
    errors.push({ blockId: block.id, field: 'rows', message: 'At least one row is required', type: 'error' });
  }
  
  if (block.cells.length === 0) {
    errors.push({ blockId: block.id, field: 'cells', message: 'At least one cell to complete is required', type: 'error' });
  }
  
  block.cells.forEach((cell, i) => {
    if (!cell.correctAnswer.trim()) {
      errors.push({ blockId: block.id, field: `cells[${i}].correctAnswer`, message: `Cell ${i + 1} has no answer`, type: 'error' });
    }
  });
  
  return errors;
};

const validateNoteCompletionBlock = (block: NoteCompletionBlock): ValidationError[] => {
  const errors: ValidationError[] = [];
  
  if (block.questions.length === 0) {
    errors.push({ blockId: block.id, field: 'questions', message: 'At least one note is required', type: 'error' });
  }
  
  block.questions.forEach((q, i) => {
    if (!q.noteText.trim()) {
      errors.push({ blockId: block.id, field: `questions[${i}].noteText`, message: `Note ${i + 1} is empty`, type: 'error' });
    }
    if (q.blanks.length === 0) {
      errors.push({ blockId: block.id, field: `questions[${i}].blanks`, message: `Note ${i + 1} has no blanks`, type: 'error' });
    }
    q.blanks.forEach((blank, j) => {
      if (!blank.correctAnswer.trim()) {
        errors.push({ blockId: block.id, field: `questions[${i}].blanks[${j}].correctAnswer`, message: `Blank ${j + 1} in note ${i + 1} has no answer`, type: 'error' });
      }
    });
  });
  
  return errors;
};

const validateClassificationBlock = (block: ClassificationBlock): ValidationError[] => {
  const errors: ValidationError[] = [];
  
  if (block.categories.length < 2) {
    errors.push({ blockId: block.id, field: 'categories', message: 'At least 2 categories are required', type: 'error' });
  }
  
  if (block.items.length === 0) {
    errors.push({ blockId: block.id, field: 'items', message: 'At least one item to classify is required', type: 'error' });
  }
  
  block.items.forEach((item, i) => {
    if (!item.text.trim()) {
      errors.push({ blockId: block.id, field: `items[${i}].text`, message: `Item ${i + 1} is empty`, type: 'error' });
    }
    if (!block.categories.includes(item.correctCategory)) {
      errors.push({ blockId: block.id, field: `items[${i}].correctCategory`, message: `Item ${i + 1} has invalid category`, type: 'error' });
    }
  });
  
  return errors;
};

const validateMatchingFeaturesBlock = (block: MatchingFeaturesBlock): ValidationError[] => {
  const errors: ValidationError[] = [];
  
  if (block.features.length === 0) {
    errors.push({ blockId: block.id, field: 'features', message: 'At least one feature is required', type: 'error' });
  }
  
  if (block.options.length < 2) {
    errors.push({ blockId: block.id, field: 'options', message: 'At least 2 options to match are required', type: 'error' });
  }
  
  block.features.forEach((feature, i) => {
    if (!feature.text.trim()) {
      errors.push({ blockId: block.id, field: `features[${i}].text`, message: `Feature ${i + 1} is empty`, type: 'error' });
    }
    if (!block.options.includes(feature.correctMatch)) {
      errors.push({ blockId: block.id, field: `features[${i}].correctMatch`, message: `Feature ${i + 1} has invalid match option`, type: 'error' });
    }
  });
  
  return errors;
};

export const validateBlock = (block: QuestionBlock): BlockValidation => {
  let errors: ValidationError[] = [];
  
  switch (block.type) {
    case 'TFNG':
      errors = validateTFNGBlock(block);
      break;
    case 'CLOZE':
      errors = validateClozeBlock(block);
      break;
    case 'MATCHING':
      errors = validateMatchingBlock(block);
      break;
    case 'MAP':
      errors = validateMapBlock(block);
      break;
    case 'MULTI_MCQ':
      errors = validateMultiMCQBlock(block);
      break;
    case 'SINGLE_MCQ':
      errors = validateSingleMCQBlock(block);
      break;
    case 'SHORT_ANSWER':
      errors = validateShortAnswerBlock(block);
      break;
    case 'SENTENCE_COMPLETION':
      errors = validateSentenceCompletionBlock(block);
      break;
    case 'DIAGRAM_LABELING':
      errors = validateDiagramLabelingBlock(block);
      break;
    case 'FLOW_CHART':
      errors = validateFlowChartBlock(block);
      break;
    case 'TABLE_COMPLETION':
      errors = validateTableCompletionBlock(block);
      break;
    case 'NOTE_COMPLETION':
      errors = validateNoteCompletionBlock(block);
      break;
    case 'CLASSIFICATION':
      errors = validateClassificationBlock(block);
      break;
    case 'MATCHING_FEATURES':
      errors = validateMatchingFeaturesBlock(block);
      break;
  }
  
  return {
    blockId: block.id,
    isValid: errors.filter(e => e.type === 'error').length === 0,
    errors
  };
};

export const validatePassage = (passage: Passage): ValidationError[] => {
  const errors: ValidationError[] = [];
  
  if (!passage.title.trim()) {
    errors.push({ passageId: passage.id, field: 'title', message: 'Passage title is required', type: 'error' });
  }
  
  if (!passage.content.trim()) {
    errors.push({ passageId: passage.id, field: 'content', message: 'Passage content is required', type: 'error' });
  }
  
  passage.blocks.forEach(block => {
    const blockValidation = validateBlock(block);
    errors.push(...blockValidation.errors);
  });
  
  return errors;
};

export const validateListeningPart = (part: ListeningPart): ValidationError[] => {
  const errors: ValidationError[] = [];
  
  if (!part.title.trim()) {
    errors.push({ partId: part.id, field: 'title', message: 'Part title is required', type: 'error' });
  }
  
  if (part.audioUrl && !isValidUrl(part.audioUrl)) {
    errors.push({ partId: part.id, field: 'audioUrl', message: 'Audio URL is invalid', type: 'error' });
  }
  
  part.pins.forEach((pin, i) => {
    if (!isValidPinTime(pin.time)) {
      errors.push({ partId: part.id, field: `pins[${i}].time`, message: `Pin ${i + 1} has invalid time format (use mm:ss)`, type: 'error' });
    }
    if (!pin.label.trim()) {
      errors.push({ partId: part.id, field: `pins[${i}].label`, message: `Pin ${i + 1} label is empty`, type: 'warning' });
    }
  });
  
  part.blocks.forEach(block => {
    const blockValidation = validateBlock(block);
    errors.push(...blockValidation.errors);
  });
  
  return errors;
};

export const validateReadingModule = (passages: Passage[]): ValidationError[] => {
  const errors: ValidationError[] = [];
  
  if (passages.length === 0) {
    errors.push({ field: 'reading', message: 'At least one passage is required', type: 'error' });
  }
  
  passages.forEach(passage => {
    errors.push(...validatePassage(passage));
  });
  
  return errors;
};

export const validateListeningModule = (parts: ListeningPart[]): ValidationError[] => {
  const errors: ValidationError[] = [];
  
  if (parts.length === 0) {
    errors.push({ field: 'listening', message: 'At least one listening part is required', type: 'error' });
  }
  
  parts.forEach(part => {
    errors.push(...validateListeningPart(part));
  });
  
  return errors;
};

export const canPublishExam = (exam: Exam): { canPublish: boolean; errors: ValidationError[] } => {
  const errors: ValidationError[] = [];
  
  if (!exam.title.trim()) {
    errors.push({ field: 'title', message: 'Exam title is required', type: 'error' });
  }
  
  errors.push(...validateReadingModule(exam.content.reading.passages));
  errors.push(...validateListeningModule(exam.content.listening.parts));
  
  return {
    canPublish: errors.filter(e => e.type === 'error').length === 0,
    errors
  };
};

const toRoman = (num: number): string => {
  const roman = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];
  return roman[num] || num.toString();
};

const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

const isValidPinTime = (time: string): boolean => {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return false;
  const minutesText = match[1];
  const secondsText = match[2];
  if (!minutesText || !secondsText) {
    return false;
  }
  const minutes = parseInt(minutesText, 10);
  const seconds = parseInt(secondsText, 10);
  return minutes >= 0 && seconds >= 0 && seconds < 60;
};

interface LegacyBlock {
  id: string;
  type: string;
  instruction?: string;
  stem?: string;
  assetUrl?: string;
  correctCount?: number;
  requiredSelections?: number;
  questions?: Array<{
    id?: string;
    text?: string;
    prompt?: string;
    statement?: string;
    answer?: string;
    paragraph?: string;
    paragraphLabel?: string;
    correctHeading?: string;
    label?: string;
    x?: number;
    y?: number;
  }>;
  headings?: Array<{
    id?: string;
    text?: string;
  }>;
  options?: Array<{
    id?: string;
    text?: string;
    isCorrect?: boolean;
  }>;
}

const migrateLegacyBlock = (block: LegacyBlock): QuestionBlock => {
  const baseBlock = {
    id: block.id,
    type: block.type,
    instruction: block.instruction || ''
  };
  
  switch (block.type) {
    case 'TFNG':
      return {
        ...baseBlock,
        type: 'TFNG',
        mode: 'TFNG',
        questions: (block.questions || []).map((q) => ({
          id: q.id || `q${Date.now()}${Math.random()}`,
          statement: q.text || q.statement || '',
          correctAnswer: q.answer === 'T' ? 'T' : q.answer === 'F' ? 'F' : q.answer === 'NG' ? 'NG' : 'T'
        }))
      } as TFNGBlock;
      
    case 'CLOZE':
      return {
        ...baseBlock,
        type: 'CLOZE',
        answerRule: 'TWO_WORDS',
        questions: (block.questions || []).map((q) => ({
          id: q.id || `q${Date.now()}${Math.random()}`,
          prompt: q.text || q.prompt || '',
          correctAnswer: q.answer || ''
        }))
      } as ClozeBlock;
      
    case 'MATCHING':
      return {
        ...baseBlock,
        type: 'MATCHING',
        headings: (block.headings || []).map((h) => ({
          id: h.id || `h${Date.now()}${Math.random()}`,
          text: h.text || ''
        })),
        questions: (block.questions || []).map((q) => ({
          id: q.id || `q${Date.now()}${Math.random()}`,
          paragraphLabel: q.paragraph || q.paragraphLabel || '',
          correctHeading: q.answer || q.correctHeading || ''
        }))
      } as MatchingBlock;
      
    case 'MAP':
      return {
        ...baseBlock,
        type: 'MAP',
        assetUrl: block.assetUrl || '',
        questions: (block.questions || []).map((q) => ({
          id: q.id || `q${Date.now()}${Math.random()}`,
          label: q.label || q.text || '',
          correctAnswer: q.answer || '',
          x: q.x ?? 50,
          y: q.y ?? 50
        }))
      } as MapBlock;
      
    case 'MULTI_MCQ':
      return {
        ...baseBlock,
        type: 'MULTI_MCQ',
        stem: block.stem || block.instruction || '',
        requiredSelections: block.correctCount || block.requiredSelections || 2,
        options: (block.options || []).map((o) => ({
          id: o.id || `o${Date.now()}${Math.random()}`,
          text: o.text || '',
          isCorrect: o.isCorrect || false
        }))
      } as MultiMCQBlock;
      
    default:
      return {
        ...baseBlock,
        type: 'TFNG',
        mode: 'TFNG',
        questions: []
      } as TFNGBlock;
  }
};

interface LegacyPassage {
  id: string;
  title?: string;
  content?: string;
  blocks?: LegacyBlock[];
  images?: unknown[] | undefined;
  wordCount?: number | undefined;
}

const migrateLegacyPassage = (passage: LegacyPassage): Passage => {
  return {
    id: passage.id,
    title: passage.title || '',
    content: passage.content || '',
    blocks: (passage.blocks || []).map(migrateLegacyBlock),
    images: (passage.images as StimulusImageAsset[] | undefined) ?? [],
    wordCount: passage.wordCount || 0,
  };
};

interface LegacyListeningPart {
  id: string;
  title?: string;
  audioUrl?: string | undefined;
  pins?: Array<{
    id?: string;
    time?: string;
    label?: string;
  }> | undefined;
  blocks?: LegacyBlock[] | undefined;
}

const migrateLegacyListeningPart = (part: LegacyListeningPart): ListeningPart => {
  return {
    id: part.id,
    title: part.title || '',
    audioUrl: part.audioUrl ?? '',
    pins: (part.pins || []).map((p) => ({
      id: p.id || `pin${Date.now()}${Math.random()}`,
      time: p.time || '00:00',
      label: p.label || ''
    })),
    blocks: (part.blocks || []).map(migrateLegacyBlock)
  };
};

export const migrateExam = (exam: Exam): Exam => {
  let content = exam.content;
  
  if (!content || !content.config) {
    content = {
      ...content,
      config: createDefaultConfig(
        exam.type,
        exam.type as ExamConfig['general']['preset']
      )
    } as ExamState;
  }
  
  if (content.reading?.passages) {
    content = {
      ...content,
      reading: {
        passages: content.reading.passages.map((passage) => migrateLegacyPassage(passage as LegacyPassage))
      }
    };
  }
  
  if (content.listening?.parts) {
    content = {
      ...content,
      listening: {
        parts: content.listening.parts.map((part) => migrateLegacyListeningPart(part as LegacyListeningPart))
      }
    };
  }
  
  const config = normalizeExamConfig(content.config);

  return {
    ...exam,
    status: exam.status === 'Published' ? 'Draft' : exam.status,
    content: hydrateExamState({
      ...content,
      config
    })
  };
};

export const migrateExams = (exams: Exam[]): Exam[] => {
  return exams.map(migrateExam);
};

export const calculateBandScore = (rawScore: number, table: Record<number, number>): number => {
  const sortedRaws = Object.keys(table).map(Number).sort((a, b) => b - a);
  for (const raw of sortedRaws) {
    if (rawScore >= raw) {
      return table[raw] ?? 0;
    }
  }
  return 0;
};

export const roundOverallBand = (average: number, method: 'nearest-0.5' | 'floor' | 'ceil'): number => {
  if (method === 'floor') return Math.floor(average);
  if (method === 'ceil') return Math.ceil(average);
  return Math.round(average * 2) / 2;
};

export const calculateOverallBand = (
  scores: { listening?: number; reading?: number; writing?: number; speaking?: number },
  config: ExamConfig
): number => {
  const enabledScores = Object.entries(scores)
    .filter(([key]) => config.sections[key as ModuleType].enabled)
    .map(([, score]) => score || 0);

  if (enabledScores.length === 0) return 0;

  const average = enabledScores.reduce((a, b) => a + b, 0) / enabledScores.length;
  return roundOverallBand(average, config.scoring.overallRounding);
};
