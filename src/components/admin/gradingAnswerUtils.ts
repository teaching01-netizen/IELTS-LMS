import type {
  StudentQuestionDescriptor,
} from '../../services/examAdapterService';
import { getQuestionAnswer } from '../../services/examAdapterService';
import { normalizeAnswerForMatching, resolveAcceptedAnswers } from '../../utils/acceptedAnswers';
import { getCanonicalTableCells } from '../../utils/tableCompletion';

type UnknownRecord = Record<string, unknown>;

/**
 * Raw Fidelity Invariant (Submit -> Grading):
 * - null | undefined -> ''
 * - non-empty strings are preserved exactly (no trim/collapse/normalization)
 * - multi-slot arrays preserve order and empty intermediate slots
 *
 * Objective grading views/exports must never "helpfully" normalize student answers via:
 * filter(Boolean), join(', '), trim(), whitespace collapsing, dedupe/sort, or compacting.
 */
export function rawSlotValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return String(value);
}

export function renderRawMultiSlotAnswer(slots: unknown[]): string[] {
  return slots.map((slot) => rawSlotValue(slot));
}

export interface RawObjectiveAnswerProjection {
  scalar: string;
  slots: string[] | null;
  canonical: string;
}

export function projectRawObjectiveAnswer(value: unknown): RawObjectiveAnswerProjection {
  if (Array.isArray(value)) {
    const slots = renderRawMultiSlotAnswer(value);
    return {
      scalar: '',
      slots,
      // Canonical CSV-safe representation for multi-slot answers.
      canonical: JSON.stringify(slots),
    };
  }

  const scalar = rawSlotValue(value);
  return {
    scalar,
    slots: null,
    canonical: scalar,
  };
}

export function extractObjectiveAnswerMap(sectionAnswers: unknown): Record<string, unknown> {
  if (!sectionAnswers || typeof sectionAnswers !== 'object') {
    return {};
  }

  const payload = sectionAnswers as UnknownRecord;
  const candidate = payload['answers'];
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
    return candidate as Record<string, unknown>;
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

export function getQuestionPrompt(descriptor: StudentQuestionDescriptor): string {
  if (descriptor.isSubAnswerTreeLeaf) {
    const prompt = typeof descriptor.treePrompt === 'string' ? descriptor.treePrompt.trim() : '';
    return prompt || descriptor.numberLabel || '';
  }

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
    case 'SINGLE_MCQ':
      return block.stem || block.instruction || '';
    case 'DIAGRAM_LABELING':
      return typeof answerIndex === 'number' ? `Diagram label ${answerIndex + 1}` : block.instruction || '';
    case 'FLOW_CHART':
      return typeof answerIndex === 'number' ? `Flow step ${answerIndex + 1}` : block.instruction || '';
    case 'TABLE_COMPLETION': {
      if (typeof answerIndex !== 'number') return block.instruction || '';
      const canonicalCell = getCanonicalTableCells(block)[answerIndex];
      if (!canonicalCell) {
        return `Table cell ${answerIndex + 1}`;
      }
      return `Table cell row ${canonicalCell.row + 1}, col ${canonicalCell.col + 1}`;
    }
    case 'CLASSIFICATION':
      return typeof answerIndex === 'number' ? `Classification item ${answerIndex + 1}` : block.instruction || '';
    case 'MATCHING_FEATURES':
      return typeof answerIndex === 'number' ? `Feature ${answerIndex + 1}` : block.instruction || '';
  }
}

export function getCorrectAnswerValue(descriptor: StudentQuestionDescriptor): unknown {
  if (descriptor.isSubAnswerTreeLeaf) {
    return descriptor.treeAcceptedAnswers?.[0] ?? null;
  }

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
      const options = 'options' in block && Array.isArray(block.options) ? block.options : [];
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
      if (typeof answerIndex !== 'number') return null;
      return getCanonicalTableCells(block)[answerIndex]?.correctAnswer ?? null;
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
  if (acceptedAnswers && acceptedAnswers.length > 0) {
    return acceptedAnswers.join(' | ');
  }

  const correct = getCorrectAnswerValue(descriptor);
  const { block } = descriptor;

  if (block.type === 'MULTI_MCQ') {
    const options = Array.isArray(block.options) ? block.options : [];
    const ids = Array.isArray(correct) ? (correct as string[]) : [];
    return ids.map((id) => lookupOptionText(options, id)).join(', ');
  }

  if (block.type === 'SINGLE_MCQ') {
    const options = Array.isArray(block.options) ? block.options : [];
    return typeof correct === 'string' ? lookupOptionText(options, correct) : '';
  }

  if (block.type === 'MATCHING') {
    const headings = Array.isArray(block.headings) ? block.headings : [];
    return typeof correct === 'string' ? lookupHeadingText(headings, correct) : '';
  }

  return formatAnswerValue(correct);
}

function getAcceptedAnswersForDescriptor(descriptor: StudentQuestionDescriptor): string[] | null {
  if (descriptor.isSubAnswerTreeLeaf) {
    return descriptor.treeAcceptedAnswers ?? null;
  }

  const { block, question, answerIndex } = descriptor;

  switch (block.type) {
    case 'CLOZE':
    case 'SHORT_ANSWER':
      return question && 'correctAnswer' in question ? resolveAcceptedAnswers(question) : null;
    case 'SENTENCE_COMPLETION': {
      if (!question || !('blanks' in question) || !Array.isArray(question.blanks)) return null;
      if (typeof answerIndex !== 'number') return null;
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
      if (typeof answerIndex !== 'number') return null;
      const cell = getCanonicalTableCells(block)[answerIndex];
      return cell ? resolveAcceptedAnswers(cell) : null;
    }
    default:
      return null;
  }
}

export function getStudentAnswerDisplay(
  descriptor: StudentQuestionDescriptor,
  answerMap: Record<string, unknown>,
): string {
  const value =
    descriptor.block.type === 'MULTI_MCQ' && typeof descriptor.answerIndex === 'number'
      ? answerMap[descriptor.answerKey]
      : getQuestionAnswer(descriptor, answerMap);
  return projectRawObjectiveAnswer(value).canonical;
}

export function getStudentAnswerRawProjection(
  descriptor: StudentQuestionDescriptor,
  answerMap: Record<string, unknown>,
): RawObjectiveAnswerProjection {
  const value =
    descriptor.block.type === 'MULTI_MCQ' && typeof descriptor.answerIndex === 'number'
      ? answerMap[descriptor.answerKey]
      : getQuestionAnswer(descriptor, answerMap);
  return projectRawObjectiveAnswer(value);
}

function normalizedSetFromUnknown(value: unknown): Set<string> {
  if (!Array.isArray(value)) {
    return new Set<string>();
  }

  const items = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map(normalizeComparable)
    .filter((entry) => entry !== '');

  return new Set(items);
}

function countIntersection(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const value of left) {
    if (right.has(value)) {
      count += 1;
    }
  }
  return count;
}

export function isStudentAnswerCorrect(
  descriptor: StudentQuestionDescriptor,
  answerMap: Record<string, unknown>,
): boolean | null {
  const correct = getCorrectAnswerValue(descriptor);
  const student = getQuestionAnswer(descriptor, answerMap);
  const acceptedAnswers = getAcceptedAnswersForDescriptor(descriptor);

  if (correct === null || correct === undefined) {
    return null;
  }

  if (descriptor.block.type === 'MULTI_MCQ') {
    const correctSet = normalizedSetFromUnknown(correct);
    const studentSet = normalizedSetFromUnknown(
      typeof descriptor.answerIndex === 'number' ? answerMap[descriptor.answerKey] : student,
    );
    if (typeof descriptor.answerIndex === 'number') {
      const correctSelections = countIntersection(correctSet, studentSet);
      return correctSelections > descriptor.answerIndex;
    }
    if (correctSet.size === 0 && studentSet.size === 0) return true;
    if (correctSet.size !== studentSet.size) return false;
    for (const value of correctSet) {
      if (!studentSet.has(value)) return false;
    }
    return true;
  }

  if (acceptedAnswers && acceptedAnswers.length > 0) {
    const studentText = normalizeComparable(formatAnswerValue(student));
    if (studentText === '') {
      return false;
    }
    return acceptedAnswers.some(
      (answer) => normalizeComparable(answer) === studentText,
    );
  }

  const correctText = normalizeComparable(formatAnswerValue(correct));
  const studentText = normalizeComparable(formatAnswerValue(student));
  if (correctText === '' && studentText === '') return true;
  return correctText !== '' && correctText === studentText;
}
