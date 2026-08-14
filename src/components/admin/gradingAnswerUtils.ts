import type {
  StudentQuestionDescriptor,
} from '../../services/examAdapterService';
import { getQuestionAnswer } from '../../services/examAdapterService';
import type { StudentAnswerValue } from '../../types/answers';
import type { SentenceCompletionQuestion } from '../../types';
import { normalizeAnswerForMatching, resolveAcceptedAnswers } from '../../utils/acceptedAnswers';
import { getSharedSentenceAnswerPool, matchSharedSentenceAnswers } from '../../utils/sentenceCompletionAnswerPool';

type UnknownRecord = Record<string, unknown>;

export function extractObjectiveAnswerMap(
  sectionAnswers: unknown,
): Record<string, StudentAnswerValue | undefined> {
  if (!sectionAnswers || typeof sectionAnswers !== 'object') {
    return {};
  }

  const payload = sectionAnswers as UnknownRecord;
  const candidate = payload['answers'];
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    return candidate as Record<string, StudentAnswerValue | undefined>;
  }

  return {};
}

function normalizeComparable(value: string): string {
  return normalizeAnswerForMatching(value);
}

function stringifyFallback(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatAnswerValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((entry) => formatAnswerValue(entry))
      .filter((entry) => entry.trim() !== '')
      .join(', ');
  }

  return stringifyFallback(value);
}

function lookupOptionText(
  options: Array<{ id: string; text: string }> | undefined,
  id: string,
): string {
  return options?.find((opt) => opt.id === id)?.text ?? id;
}

function lookupHeadingText(
  headings: Array<{ id: string; text: string }> | undefined,
  id: string,
): string {
  return headings?.find((h) => h.id === id)?.text ?? id;
}

function getSingleMcqOptions(
  descriptor: StudentQuestionDescriptor,
): Array<{ id: string; text: string; isCorrect?: boolean }> {
  const questionLevel =
    descriptor.question && 'options' in descriptor.question && Array.isArray(descriptor.question.options)
      ? descriptor.question
      : null;

  if (questionLevel) {
    return questionLevel.options;
  }

  const blockWithQuestions = descriptor.block as { questions?: Array<{ id: string; options?: Array<{ id: string; text: string; isCorrect?: boolean }> }> };
  if (Array.isArray(blockWithQuestions.questions) && blockWithQuestions.questions.length > 0) {
    const matchedQuestion = blockWithQuestions.questions.find((question) => question.id === descriptor.answerKey);
    if (matchedQuestion && Array.isArray(matchedQuestion.options)) {
      return matchedQuestion.options;
    }
    if (Array.isArray(blockWithQuestions.questions[0]?.options)) {
      return blockWithQuestions.questions[0].options;
    }
  }

  const blockOptions = (descriptor.block as { options?: Array<{ id: string; text: string; isCorrect?: boolean }> }).options;
  return Array.isArray(blockOptions) ? blockOptions : [];
}

export function getQuestionPrompt(descriptor: StudentQuestionDescriptor): string {
  const { block, question, answerIndex } = descriptor;
  switch (block.type) {
    case 'TFNG':
      return (question && 'statement' in question ? (question.statement ?? '') : '') || block.instruction || '';
    case 'CLOZE':
      return (question && 'prompt' in question ? (question.prompt ?? '') : '') || block.instruction || '';
    case 'MATCHING':
      return (question && 'paragraphLabel' in question ? (question.paragraphLabel ?? '') : '') || block.instruction || '';
    case 'MAP':
      return (question && 'label' in question ? (question.label ?? '') : '') || block.instruction || '';
    case 'SHORT_ANSWER':
      return (question && 'prompt' in question ? (question.prompt ?? '') : '') || block.instruction || '';
    case 'SENTENCE_COMPLETION': {
      if (question && 'sentence' in question) {
        const base = question.sentence ?? '';
        return typeof answerIndex === 'number' ? `${base} (blank ${answerIndex + 1})` : base;
      }
      return block.instruction || '';
    }
    case 'NOTE_COMPLETION': {
      if (question && 'noteText' in question) {
        const base = question.noteText ?? '';
        return typeof answerIndex === 'number' ? `Note (blank ${answerIndex + 1})` : base;
      }
      return block.instruction || '';
    }
    case 'MULTI_MCQ':
      return block.stem || block.instruction || '';
    case 'SINGLE_MCQ': {
      if (question && 'stem' in question) {
        return question.stem || block.stem || block.instruction || '';
      }
      const blockWithQuestions = block as { questions?: Array<{ id: string; stem?: string }> };
      if (Array.isArray(blockWithQuestions.questions) && blockWithQuestions.questions.length > 0) {
        const matchedQuestion = blockWithQuestions.questions.find((candidate) => candidate.id === descriptor.answerKey);
        const fallbackQuestion = matchedQuestion ?? blockWithQuestions.questions[0];
        return fallbackQuestion?.stem || block.stem || block.instruction || '';
      }
      return block.stem || block.instruction || '';
    }
    case 'DIAGRAM_LABELING':
      return typeof answerIndex === 'number' ? `Diagram label ${answerIndex + 1}` : block.instruction || '';
    case 'FLOW_CHART':
      return typeof answerIndex === 'number' ? `Flow step ${answerIndex + 1}` : block.instruction || '';
    case 'TABLE_COMPLETION':
      return typeof answerIndex === 'number' ? `Table cell ${answerIndex + 1}` : block.instruction || '';
    case 'CLASSIFICATION':
      return typeof answerIndex === 'number' ? `Classification item ${answerIndex + 1}` : block.instruction || '';
    case 'MATCHING_FEATURES':
      return typeof answerIndex === 'number' ? `Feature ${answerIndex + 1}` : block.instruction || '';
  }
}

export function getCorrectAnswerValue(descriptor: StudentQuestionDescriptor): unknown {
  const { block, question, answerIndex } = descriptor;

  switch (block.type) {
    case 'TFNG':
      return question && 'correctAnswer' in question ? (question.correctAnswer ?? null) : null;
    case 'CLOZE':
      return question && 'correctAnswer' in question ? (question.correctAnswer ?? null) : null;
    case 'MATCHING':
      return question && 'correctHeading' in question ? (question.correctHeading ?? null) : null;
    case 'MAP':
      return question && 'correctAnswer' in question ? (question.correctAnswer ?? null) : null;
    case 'SHORT_ANSWER':
      return question && 'correctAnswer' in question ? (question.correctAnswer ?? null) : null;
    case 'SENTENCE_COMPLETION': {
      if (!question || !('blanks' in question) || !Array.isArray(question.blanks)) return null;
      if (typeof answerIndex !== 'number') return null;
      return question.blanks[answerIndex]?.correctAnswer ?? null;
    }
    case 'NOTE_COMPLETION': {
      if (!question || !('blanks' in question) || !Array.isArray(question.blanks)) return null;
      if (typeof answerIndex !== 'number') return null;
      return question.blanks[answerIndex]?.correctAnswer ?? null;
    }
    case 'MULTI_MCQ': {
      const options = 'options' in block && Array.isArray(block.options) ? block.options : [];
      return options.filter((opt) => opt.isCorrect).map((opt) => opt.id);
    }
    case 'SINGLE_MCQ': {
      const options = getSingleMcqOptions(descriptor);
      return options.find((opt) => opt.isCorrect)?.id ?? null;
    }
    case 'DIAGRAM_LABELING': {
      if (!('labels' in block) || !Array.isArray(block.labels)) return null;
      if (typeof answerIndex !== 'number') return null;
      return block.labels[answerIndex]?.correctAnswer ?? null;
    }
    case 'FLOW_CHART': {
      if (!('steps' in block) || !Array.isArray(block.steps)) return null;
      if (typeof answerIndex !== 'number') return null;
      return block.steps[answerIndex]?.correctAnswer ?? null;
    }
    case 'TABLE_COMPLETION': {
      if (!('cells' in block) || !Array.isArray(block.cells)) return null;
      if (typeof answerIndex !== 'number') return null;
      return block.cells[answerIndex]?.correctAnswer ?? null;
    }
    case 'CLASSIFICATION': {
      if (!('items' in block) || !Array.isArray(block.items)) return null;
      if (typeof answerIndex !== 'number') return null;
      return block.items[answerIndex]?.correctCategory ?? null;
    }
    case 'MATCHING_FEATURES': {
      if (!('features' in block) || !Array.isArray(block.features)) return null;
      if (typeof answerIndex !== 'number') return null;
      return block.features[answerIndex]?.correctMatch ?? null;
    }
  }
}

export function getCorrectAnswerDisplay(descriptor: StudentQuestionDescriptor): string {
  const acceptedAnswers = getAcceptedAnswersForDescriptor(descriptor);
  const { block, question } = descriptor;
  if (acceptedAnswers && acceptedAnswers.length > 0) {
    return acceptedAnswers.join(' | ');
  }

  if (
    block.type === 'SENTENCE_COMPLETION' &&
    acceptedAnswers !== null &&
    question &&
    'blanks' in question &&
    Array.isArray(question.blanks) &&
    (question as SentenceCompletionQuestion).acceptAnyAnswerKey === true
  ) {
    return acceptedAnswers.join(' | ');
  }

  const correct = getCorrectAnswerValue(descriptor);

  if (block.type === 'MULTI_MCQ') {
    const options = Array.isArray(block.options) ? block.options : [];
    const ids = Array.isArray(correct) ? (correct as string[]) : [];
    return ids.map((id) => lookupOptionText(options, id)).join(', ');
  }

  if (block.type === 'SINGLE_MCQ') {
    const options = getSingleMcqOptions(descriptor);
    return typeof correct === 'string' ? lookupOptionText(options, correct) : '';
  }

  if (block.type === 'MATCHING') {
    const headings = Array.isArray(block.headings) ? block.headings : [];
    return typeof correct === 'string' ? lookupHeadingText(headings, correct) : '';
  }

  return formatAnswerValue(correct);
}

function getAcceptedAnswersForDescriptor(descriptor: StudentQuestionDescriptor): string[] | null {
  const { block, question, answerIndex } = descriptor;

  switch (block.type) {
    case 'CLOZE':
    case 'SHORT_ANSWER':
      return question && 'correctAnswer' in question ? resolveAcceptedAnswers(question) : null;
    case 'SENTENCE_COMPLETION': {
      if (!question || !('blanks' in question) || !Array.isArray(question.blanks)) return null;
      if (typeof answerIndex !== 'number') return null;
      const sentenceQuestion = question as SentenceCompletionQuestion;
      if (sentenceQuestion.acceptAnyAnswerKey === true) {
        return getSharedSentenceAnswerPool(sentenceQuestion);
      }
      const blank = question.blanks[answerIndex];
      return blank ? resolveAcceptedAnswers(blank) : null;
    }
    case 'NOTE_COMPLETION': {
      if (!question || !('blanks' in question) || !Array.isArray(question.blanks)) return null;
      if (typeof answerIndex !== 'number') return null;
      const blank = question.blanks[answerIndex];
      return blank ? resolveAcceptedAnswers(blank) : null;
    }
    case 'TABLE_COMPLETION': {
      if (!Array.isArray(block.cells) || typeof answerIndex !== 'number') return null;
      const cell = block.cells[answerIndex];
      return cell ? resolveAcceptedAnswers(cell) : null;
    }
    default:
      return null;
  }
}

export function getStudentAnswerDisplay(
  descriptor: StudentQuestionDescriptor,
  answerMap: Record<string, StudentAnswerValue | undefined>,
): string {
  const value = getQuestionAnswer(descriptor, answerMap);
  const { block } = descriptor;

  if (block.type === 'MULTI_MCQ') {
    const options = Array.isArray(block.options) ? block.options : [];
    const ids = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
    return ids.map((id) => lookupOptionText(options, id)).join(', ');
  }

  if (block.type === 'SINGLE_MCQ') {
    const options = getSingleMcqOptions(descriptor);
    return typeof value === 'string' ? lookupOptionText(options, value) : '';
  }

  if (block.type === 'MATCHING') {
    const headings = Array.isArray(block.headings) ? block.headings : [];
    return typeof value === 'string' ? lookupHeadingText(headings, value) : '';
  }

  return formatAnswerValue(value);
}

function getSentenceCompletionQuestion(
  descriptor: StudentQuestionDescriptor,
): SentenceCompletionQuestion | null {
  if (descriptor.block.type !== 'SENTENCE_COMPLETION') {
    return null;
  }

  const question = descriptor.question;
  if (!question || !('blanks' in question) || !Array.isArray(question.blanks)) {
    return null;
  }

  return question as SentenceCompletionQuestion;
}

export function resolveSentenceCompletionCorrectness(
  descriptors: readonly StudentQuestionDescriptor[],
  answerMap: Record<string, StudentAnswerValue | undefined>,
): Map<string, boolean | null> {
  const correctnessByDescriptor = new Map<string, boolean | null>();
  const sharedGroups = new Map<string, {
    question: SentenceCompletionQuestion;
    descriptors: StudentQuestionDescriptor[];
  }>();

  for (const descriptor of descriptors) {
    const question = getSentenceCompletionQuestion(descriptor);
    if (!question || question.acceptAnyAnswerKey !== true) {
      correctnessByDescriptor.set(descriptor.id, isStudentAnswerCorrect(descriptor, answerMap));
      continue;
    }

    const group = sharedGroups.get(question.id);
    if (group) {
      group.descriptors.push(descriptor);
    } else {
      sharedGroups.set(question.id, { question, descriptors: [descriptor] });
    }
  }

  for (const { question, descriptors: groupDescriptors } of sharedGroups.values()) {
    const sortedDescriptors = [...groupDescriptors].sort(
      (left, right) => (left.answerIndex ?? Number.MAX_SAFE_INTEGER) - (right.answerIndex ?? Number.MAX_SAFE_INTEGER),
    );
    const gradableDescriptors = sortedDescriptors.filter(
      (descriptor) =>
        typeof descriptor.answerIndex === 'number' &&
        descriptor.answerIndex >= 0 &&
        descriptor.answerIndex < question.blanks.length,
    );

    for (const descriptor of sortedDescriptors) {
      if (!gradableDescriptors.includes(descriptor)) {
        correctnessByDescriptor.set(descriptor.id, isStudentAnswerCorrect(descriptor, answerMap));
      }
    }

    if (gradableDescriptors.length === 0) {
      continue;
    }

    const matches = matchSharedSentenceAnswers(
      gradableDescriptors.map((descriptor) => getQuestionAnswer(descriptor, answerMap)),
      getSharedSentenceAnswerPool(question),
    );
    gradableDescriptors.forEach((descriptor, index) => {
      correctnessByDescriptor.set(descriptor.id, matches[index] ?? false);
    });
  }

  return correctnessByDescriptor;
}

function exactIdSetFromUnknown(value: unknown): Set<string> {
  if (!Array.isArray(value)) {
    return new Set<string>();
  }

  const items = value
    .filter((entry): entry is string => typeof entry === 'string')
    .filter((entry) => entry !== '');

  return new Set(items);
}

export function getMultiSelectAnswerScore(
  descriptor: StudentQuestionDescriptor,
  answerMap: Record<string, StudentAnswerValue | undefined>,
): { readonly awardedScore: number | null; readonly maxScore: number | null } {
  if (descriptor.block.type !== 'MULTI_MCQ') {
    return { awardedScore: null, maxScore: null };
  }

  const correctSet = exactIdSetFromUnknown(getCorrectAnswerValue(descriptor));
  if (correctSet.size === 0) {
    return { awardedScore: null, maxScore: null };
  }

  const studentSet = exactIdSetFromUnknown(getQuestionAnswer(descriptor, answerMap));
  const awardedScore = Array.from(studentSet).filter((id) => correctSet.has(id)).length;

  return {
    awardedScore,
    maxScore: correctSet.size,
  };
}

export function isStudentAnswerCorrect(
  descriptor: StudentQuestionDescriptor,
  answerMap: Record<string, StudentAnswerValue | undefined>,
): boolean | null {
  const correct = getCorrectAnswerValue(descriptor);
  const student = getQuestionAnswer(descriptor, answerMap);
  const acceptedAnswers = getAcceptedAnswersForDescriptor(descriptor);

  if (acceptedAnswers && acceptedAnswers.length > 0) {
    const studentText = normalizeComparable(formatAnswerValue(student));
    if (studentText === '') {
      return false;
    }
    return acceptedAnswers.some(
      (answer) => normalizeComparable(answer) === studentText,
    );
  }

  if (correct === null || correct === undefined) {
    return null;
  }

  if (descriptor.block.type === 'MULTI_MCQ') {
    const correctSet = exactIdSetFromUnknown(correct);
    const studentSet = exactIdSetFromUnknown(student);
    if (correctSet.size === 0) return null;
    if (correctSet.size !== studentSet.size) return false;
    for (const value of correctSet) {
      if (!studentSet.has(value)) return false;
    }
    return true;
  }

  const correctText = normalizeComparable(formatAnswerValue(correct));
  const studentText = normalizeComparable(formatAnswerValue(student));
  if (correctText === '' && studentText === '') return true;
  return correctText !== '' && correctText === studentText;
}
