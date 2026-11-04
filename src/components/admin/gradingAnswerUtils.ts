import type {
  StudentQuestionDescriptor,
} from '../../features/exam-authoring/api/examAuthoringGateway';
import { getQuestionAnswer } from '../../features/exam-authoring/api/examAuthoringGateway';
import type { StudentAnswerValue } from '../../types/answers';
import type { NoteCompletionQuestion, QuestionType, SentenceCompletionQuestion } from '../../types';
import { answersMatchCaseExact, answersMatchForEntry, isCaseSensitiveEntry, normalizeAnswerForMatching, resolveAcceptedAnswers, sanitizeAcceptedAnswers } from '../../utils/acceptedAnswers';
import { flattenSubAnswerTree } from '../../utils/subAnswerTree';
import { createSharedSentencePoolMatcher, getSharedSentenceAnswerPool } from '../../utils/sentenceCompletionAnswerPool';

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

function formatChoiceLetter(index: number): string {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function lookupOptionDisplay(
  options: Array<{ id: string; text: string; label?: string | undefined }> | undefined,
  id: string,
  includeChoiceLabels: boolean,
): string {
  const option = options?.find((candidate) => candidate.id === id);
  const optionIndex = option ? (options?.indexOf(option) ?? -1) : -1;
  const text = option?.text ?? id;
  return includeChoiceLabels && optionIndex >= 0
    ? `${option?.label?.trim() || formatChoiceLetter(optionIndex)}. ${text}`
    : text;
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
    // Unknown answerKey (stale content): no options, so grading resolves to
    // invalid instead of silently scoring against another question's key.
    return [];
  }

  const blockOptions = (descriptor.block as { options?: Array<{ id: string; text: string; isCorrect?: boolean }> }).options;
  return Array.isArray(blockOptions) ? blockOptions : [];
}

export interface AnswerDisplayOptions {
  includeChoiceLabels?: boolean;
  correctAnswerOverride?: string;
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

export function getCorrectAnswerDisplay(
  descriptor: StudentQuestionDescriptor,
  options: AnswerDisplayOptions = {},
): string {
  const includeChoiceLabels = options.includeChoiceLabels === true;
  const correctAnswerOverride = options.correctAnswerOverride?.trim();
  const acceptedAnswers = getAcceptedAnswersForDescriptor(descriptor);
  const { block, question } = descriptor;

  if (correctAnswerOverride) {
    if (block.type === 'MULTI_MCQ') {
      const optionList = Array.isArray(block.options) ? block.options : [];
      return correctAnswerOverride
        .split('|')
        .map((id) => lookupOptionDisplay(optionList, id.trim(), includeChoiceLabels))
        .join(', ');
    }

    if (block.type === 'SINGLE_MCQ') {
      const optionList = getSingleMcqOptions(descriptor);
      const firstAnswer = correctAnswerOverride.split('|')[0]?.trim() ?? '';
      return lookupOptionDisplay(optionList, firstAnswer, includeChoiceLabels);
    }

    return correctAnswerOverride;
  }

  if (acceptedAnswers.length > 0) {
    return acceptedAnswers.join(' | ');
  }

  // MATCHING and TFNG display the effective grading keys (admin README):
  // MATCHING reads acceptedAnswers, then correctHeading, then a legacy
  // correctAnswer, and renders heading ids as heading text; TFNG reads
  // correctAnswer, then acceptedAnswers.
  if (block.type === 'MATCHING') {
    const headings = Array.isArray(block.headings) ? block.headings : [];
    return getEffectiveAcceptedAnswersForGrading(descriptor)
      .map((headingId) => lookupHeadingText(headings, headingId))
      .join(' | ');
  }

  if (block.type === 'TFNG') {
    return getEffectiveAcceptedAnswersForGrading(descriptor).join(' | ');
  }

  if (
    block.type === 'SENTENCE_COMPLETION' &&
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
    return ids.map((id) => lookupOptionDisplay(options, id, includeChoiceLabels)).join(', ');
  }

  if (block.type === 'SINGLE_MCQ') {
    const options = getSingleMcqOptions(descriptor);
    return typeof correct === 'string'
      ? lookupOptionDisplay(options, correct, includeChoiceLabels)
      : '';
  }

  return formatAnswerValue(correct);
}

/**
 * Displayed accepted-answer list for a descriptor. This delegates to the one
 * grading resolver instead of re-dispatching on block type, so the review/PDF
 * surfaces cannot drift from the keys the scorer reads. Choice blocks and the
 * two special single-winner displays (MATCHING/TFNG) render from the
 * correct-answer branch below; sub-answer-tree leaves keep their historical
 * display path.
 */
function getAcceptedAnswersForDescriptor(descriptor: StudentQuestionDescriptor): string[] {
  const { block } = descriptor;
  if (
    descriptor.isSubAnswerTreeLeaf
    || block.type === 'MULTI_MCQ'
    || block.type === 'SINGLE_MCQ'
    || block.type === 'MATCHING'
    || block.type === 'TFNG'
  ) {
    return [];
  }
  return getEffectiveAcceptedAnswersForGrading(descriptor);
}

export function getStudentAnswerDisplay(
  descriptor: StudentQuestionDescriptor,
  answerMap: Record<string, StudentAnswerValue | undefined>,
  options: AnswerDisplayOptions = {},
): string {
  const value = getQuestionAnswer(descriptor, answerMap);
  const { block } = descriptor;
  const includeChoiceLabels = options.includeChoiceLabels === true;

  if (block.type === 'MULTI_MCQ') {
    const options = Array.isArray(block.options) ? block.options : [];
    const ids = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
    return ids.map((id) => lookupOptionDisplay(options, id, includeChoiceLabels)).join(', ');
  }

  if (block.type === 'SINGLE_MCQ') {
    const options = getSingleMcqOptions(descriptor);
    return typeof value === 'string'
      ? lookupOptionDisplay(options, value, includeChoiceLabels)
      : '';
  }

  if (block.type === 'MATCHING') {
    const headings = Array.isArray(block.headings) ? block.headings : [];
    return typeof value === 'string' ? lookupHeadingText(headings, value) : '';
  }

  return formatAnswerValue(value);
}

type CompletionPoolQuestion = SentenceCompletionQuestion | NoteCompletionQuestion;

function getCompletionQuestion(
  descriptor: StudentQuestionDescriptor,
): CompletionPoolQuestion | null {
  if (
    descriptor.block.type !== 'SENTENCE_COMPLETION'
    && descriptor.block.type !== 'NOTE_COMPLETION'
  ) {
    return null;
  }

  const question = descriptor.question;
  if (!question || !('blanks' in question) || !Array.isArray(question.blanks)) {
    return null;
  }

  return question as CompletionPoolQuestion;
}

export function resolveSentenceCompletionCorrectness(
  descriptors: readonly StudentQuestionDescriptor[],
  answerMap: Record<string, StudentAnswerValue | undefined>,
): Map<string, boolean | null> {
  const correctnessByDescriptor = new Map<string, boolean | null>();
  const sharedGroups = new Map<string, {
    question: CompletionPoolQuestion;
    descriptors: StudentQuestionDescriptor[];
  }>();

  for (const descriptor of descriptors) {
    const question = getCompletionQuestion(descriptor);
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

    // Per-blank strictness: each blank consumes from the shared pool under its
    // own rule (mirrors scoreObjectiveDescriptors.applyPoolGroup).
    const matcher = createSharedSentencePoolMatcher(getSharedSentenceAnswerPool(question));
    gradableDescriptors.forEach((descriptor) => {
      const raw = getQuestionAnswer(descriptor, answerMap);
      const studentText = typeof raw === 'string' ? raw : formatAnswerValue(raw);
      if (studentText.trim() === '') {
        correctnessByDescriptor.set(descriptor.id, false);
        return;
      }
      correctnessByDescriptor.set(
        descriptor.id,
        matcher.match(studentText, isCaseSensitiveDescriptor(descriptor)),
      );
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

/** Exact option-ID set for SINGLE_MCQ (raw identity: no cleaning, no folding). */
function exactIdSetFromSingle(value: unknown): Set<string> {
  if (typeof value === 'string') {
    return value === '' ? new Set<string>() : new Set<string>([value]);
  }
  return exactIdSetFromUnknown(value);
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
  if (studentSet.size > correctSet.size) {
    return { awardedScore: 0, maxScore: correctSet.size };
  }
  const awardedScore = Array.from(studentSet).filter((id) => correctSet.has(id)).length;

  return {
    awardedScore,
    maxScore: correctSet.size,
  };
}

function resolveKeyFields(entry: unknown, fields: readonly string[]): string[] {
  if (!entry || typeof entry !== 'object') {
    return [];
  }
  const record = entry as Record<string, unknown>;
  for (const field of fields) {
    const raw = record[field];
    if (Array.isArray(raw)) {
      const list = sanitizeAcceptedAnswers(raw.filter((value): value is string => typeof value === 'string'));
      if (list.length > 0) return list;
    } else if (typeof raw === 'string') {
      const list = sanitizeAcceptedAnswers([raw]);
      if (list.length > 0) return list;
    }
  }
  return [];
}

interface AdditiveAcceptedAnswerSlot {
  readonly listField: 'items' | 'features' | 'labels' | 'steps';
  readonly answerField: 'correctCategory' | 'correctMatch' | 'correctAnswer';
}

/**
 * Types whose effective grading keys are additive: the slot's primary key
 * comes first, then every written alternative. Classification / matching
 * features never read a legacy `correctAnswer`; diagram labels and flow steps
 * use `correctAnswer` as their primary field, so an alternates list can no
 * longer shadow the authoritative key (review T9).
 */
const ADDITIVE_ACCEPTED_ANSWER_SLOTS: Partial<Record<QuestionType, AdditiveAcceptedAnswerSlot>> = {
  CLASSIFICATION: { listField: 'items', answerField: 'correctCategory' },
  MATCHING_FEATURES: { listField: 'features', answerField: 'correctMatch' },
  DIAGRAM_LABELING: { listField: 'labels', answerField: 'correctAnswer' },
  FLOW_CHART: { listField: 'steps', answerField: 'correctAnswer' },
};

function getAdditiveAcceptedAnswerEntry(
  descriptor: StudentQuestionDescriptor,
  slot: AdditiveAcceptedAnswerSlot,
): unknown {
  if (typeof descriptor.answerIndex !== 'number') {
    return undefined;
  }
  const items = (descriptor.block as unknown as Record<string, unknown>)[slot.listField];
  return Array.isArray(items) ? items[descriptor.answerIndex] : undefined;
}

function resolveAdditiveSlotAnswers(entry: unknown, slot: AdditiveAcceptedAnswerSlot): string[] {
  if (!entry || typeof entry !== 'object') {
    return [];
  }

  const record = entry as Record<string, unknown>;
  const primary = record[slot.answerField];
  const alternatives = record['acceptedAnswers'];

  return sanitizeAcceptedAnswers([
    typeof primary === 'string' ? primary : '',
    ...(Array.isArray(alternatives)
      ? alternatives.filter((value): value is string => typeof value === 'string')
      : []),
  ]);
}

export const OBJECTIVE_KEY_SOURCE_DEFAULT = ['acceptedAnswers', 'correctAnswer'] as const;

/**
 * Single-winner read order per type. Types whose editors write more than one
 * graded key field are NOT listed here; they live in ADDITIVE_KEY_SOURCE_FIELDS
 * below so the manifest never certifies a field that grading ignores.
 */
export const OBJECTIVE_KEY_SOURCE_FIELDS: Record<string, readonly string[]> = {
  TFNG: ['correctAnswer', 'acceptedAnswers'],
  CLOZE: ['acceptedAnswers', 'correctAnswer'],
  MATCHING: ['acceptedAnswers', 'correctHeading', 'correctAnswer'],
  MAP: ['correctAnswer', 'acceptedAnswers'],
  SHORT_ANSWER: ['acceptedAnswers', 'correctAnswer'],
  SENTENCE_COMPLETION: ['acceptedAnswers', 'correctAnswer'],
  NOTE_COMPLETION: ['acceptedAnswers', 'correctAnswer'],
  TABLE_COMPLETION: ['acceptedAnswers', 'correctAnswer'],
  SUB_ANSWER_TREE: ['acceptedAnswers', 'correctAnswer'],
  SINGLE_MCQ: ['acceptedAnswers', 'correctAnswer'],
};

/** Additive read order: every listed field contributes keys, in order. */
export const ADDITIVE_KEY_SOURCE_FIELDS: Record<string, readonly string[]> = {
  CLASSIFICATION: ['correctCategory', 'acceptedAnswers'],
  MATCHING_FEATURES: ['correctMatch', 'acceptedAnswers'],
  DIAGRAM_LABELING: ['correctAnswer', 'acceptedAnswers'],
  FLOW_CHART: ['correctAnswer', 'acceptedAnswers'],
};

export function getKeySourceFieldsForType(questionType: string): readonly string[] {
  return OBJECTIVE_KEY_SOURCE_FIELDS[questionType] ?? OBJECTIVE_KEY_SOURCE_DEFAULT;
}

/**
 * The website side of the key-source table. This is the only function grading
 * should use to decide which accepted answers apply to a descriptor.
 */
export function getEffectiveAcceptedAnswersForGrading(
  descriptor: StudentQuestionDescriptor,
): string[] {
  const { block, question, answerIndex } = descriptor;

  if (block.type === 'MULTI_MCQ') {
    const options = Array.isArray(block.options) ? block.options : [];
    return options.filter((option) => option.isCorrect).map((option) => option.id);
  }

  if (descriptor.isSubAnswerTreeLeaf) {
    const tree = (block as { answerTree?: Parameters<typeof flattenSubAnswerTree>[1] }).answerTree;
    const leaf = flattenSubAnswerTree(block.id, tree, 1).leaves.find((entry) => entry.id === descriptor.id);
    return leaf ? sanitizeAcceptedAnswers(leaf.acceptedAnswers) : [];
  }

  const additiveSlot = ADDITIVE_ACCEPTED_ANSWER_SLOTS[block.type];
  if (additiveSlot) {
    return resolveAdditiveSlotAnswers(
      getAdditiveAcceptedAnswerEntry(descriptor, additiveSlot),
      additiveSlot,
    );
  }

  const fields = getKeySourceFieldsForType(block.type);

  if (block.type === 'SENTENCE_COMPLETION') {
    if (!question || !('blanks' in question) || !Array.isArray(question.blanks)) return [];
    const sentenceQuestion = question as SentenceCompletionQuestion;
    if (sentenceQuestion.acceptAnyAnswerKey === true) {
      return getSharedSentenceAnswerPool(sentenceQuestion);
    }
    if (typeof answerIndex !== 'number') return [];
    return resolveKeyFields(question.blanks[answerIndex], fields);
  }

  if (block.type === 'NOTE_COMPLETION') {
    if (!question || !('blanks' in question) || !Array.isArray(question.blanks)) return [];
    const noteQuestion = question as NoteCompletionQuestion;
    if (noteQuestion.acceptAnyAnswerKey === true) {
      return getSharedSentenceAnswerPool(noteQuestion);
    }
    if (typeof answerIndex !== 'number') return [];
    return resolveKeyFields(question.blanks[answerIndex], fields);
  }

  if (block.type === 'TABLE_COMPLETION') {
    if (!Array.isArray(block.cells) || typeof answerIndex !== 'number') return [];
    return resolveKeyFields(block.cells[answerIndex], fields);
  }

  return resolveKeyFields(question, fields);
}

type SlotEntryReader = (descriptor: StudentQuestionDescriptor) => unknown;

function readBlanksEntry(descriptor: StudentQuestionDescriptor): unknown {
  const { question, answerIndex } = descriptor;
  if (!question || !('blanks' in question) || !Array.isArray(question.blanks)) return undefined;
  return readListEntry(question.blanks, answerIndex);
}

function readBlockEntry(descriptor: StudentQuestionDescriptor, field: string): unknown {
  const list = (descriptor.block as unknown as Record<string, unknown>)[field];
  return readListEntry(list, descriptor.answerIndex);
}

function readListEntry(list: unknown, answerIndex: number | undefined): unknown {
  if (!Array.isArray(list) || typeof answerIndex !== 'number') return undefined;
  return list[answerIndex];
}

/** Per-type slot that owns the case-sensitivity flag (default: the question). */
const CASE_SENSITIVE_SLOT_READERS: Partial<Record<QuestionType, SlotEntryReader>> = {
  NOTE_COMPLETION: readBlanksEntry,
  SENTENCE_COMPLETION: readBlanksEntry,
  TABLE_COMPLETION: (descriptor) => readBlockEntry(descriptor, 'cells'),
  DIAGRAM_LABELING: (descriptor) => readBlockEntry(descriptor, 'labels'),
  FLOW_CHART: (descriptor) => readBlockEntry(descriptor, 'steps'),
  CLASSIFICATION: (descriptor) => readBlockEntry(descriptor, 'items'),
  MATCHING_FEATURES: (descriptor) => readBlockEntry(descriptor, 'features'),
};

/** Default policy: exact case required. Opt-out only with explicit `caseSensitive: false`. */
export function isCaseSensitiveDescriptor(descriptor: StudentQuestionDescriptor): boolean {
  const { block, question } = descriptor;
  if (descriptor.isSubAnswerTreeLeaf) {
    const tree = (block as { answerTree?: unknown }).answerTree;
    if (Array.isArray(tree)) {
      const leaves = flattenSubAnswerTree(block.id, tree as never, 1).leaves;
      const leaf = leaves.find((entry) => entry.id === descriptor.id);
      const node = findTreeNodeById(tree, leaf?.nodeId);
      // Missing node defaults to strict.
      if (node === null) return true;
      return isCaseSensitiveEntry(node);
    }
    return true;
  }
  const readSlot = CASE_SENSITIVE_SLOT_READERS[block.type];
  const entry = readSlot ? readSlot(descriptor) : question;
  // Missing slot/question content defaults to strict.
  return entry === undefined ? true : isCaseSensitiveEntry(entry);
}

/** Descriptor id → strict flag for export fallbacks that lack descriptor context. */
export function buildCaseSensitiveMap(
  descriptors: readonly StudentQuestionDescriptor[],
): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const descriptor of descriptors) {
    map[descriptor.id] = isCaseSensitiveDescriptor(descriptor);
  }
  return map;
}

function findTreeNodeById(nodes: unknown, nodeId: string | undefined): unknown {
  if (!nodeId || !Array.isArray(nodes)) return null;
  const stack: unknown[] = [...nodes];
  while (stack.length > 0) {
    const current = stack.pop() as Record<string, unknown> | null;
    if (!current || typeof current !== 'object') continue;
    if (current['id'] === nodeId) return current;
    const children = current['children'];
    if (Array.isArray(children)) stack.push(...children);
  }
  return null;
}

export function isStudentAnswerCorrect(
  descriptor: StudentQuestionDescriptor,
  answerMap: Record<string, StudentAnswerValue | undefined>,
): boolean | null {
  const correct = getCorrectAnswerValue(descriptor);
  const student = getQuestionAnswer(descriptor, answerMap);
  const caseSensitive = isCaseSensitiveDescriptor(descriptor);
  const acceptedAnswers = descriptor.block.type === 'MULTI_MCQ'
    ? null
    : getEffectiveAcceptedAnswersForGrading(descriptor);

  if (acceptedAnswers && acceptedAnswers.length > 0) {
    const studentText = formatAnswerValue(student);
    return acceptedAnswers.some((answer) => answersMatchForEntry(studentText, answer, caseSensitive));
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

  if (descriptor.block.type === 'SINGLE_MCQ') {
    // Option IDs are identity, not text: compare exactly (no cleaning/folding).
    const correctSet = exactIdSetFromSingle(correct);
    const studentSet = exactIdSetFromSingle(student);
    if (correctSet.size === 0) return null;
    if (correctSet.size !== 1 || studentSet.size !== 1) return false;
    for (const value of correctSet) {
      if (!studentSet.has(value)) return false;
    }
    return true;
  }

  const studentRaw = formatAnswerValue(student);
  const correctRaw = formatAnswerValue(correct);
  if (caseSensitive) {
    return answersMatchCaseExact(studentRaw, correctRaw)
      ? true
      : (normalizeAnswerForMatching(correctRaw) === '' ? null : false);
  }
  const correctText = normalizeAnswerForMatching(correctRaw);
  const studentText = normalizeAnswerForMatching(studentRaw);
  if (correctText === '') return null;
  return correctText === studentText;
}
