import { ACT_SCIENCE_SKILL_CATEGORIES } from '../../types';
import type { ActScienceSkillCategory, ExamState } from '../../types';
import type {
  ObjectiveManualOverride,
  ObjectiveQuestionResult,
  SectionSubmission,
  StudentSubmission,
  WritingTaskSubmission,
} from '../../types/grading';
import {
  getQuestionNumberLabel,
  getQuestionAnswer,
  getStudentQuestionsForModule,
} from '../../features/exam-authoring/api/examAuthoringGateway';
import type { StudentQuestionDescriptor } from '../../features/exam-authoring/api/examAuthoringGateway';
import {
  extractObjectiveAnswerMap,
  formatAnswerValue,
  getCorrectAnswerDisplay,
  getCorrectAnswerValue,
  getEffectiveAcceptedAnswersForGrading,
  getQuestionPrompt,
  getStudentAnswerDisplay,
} from './gradingAnswerUtils';
import type { AnswerDisplayOptions } from './gradingAnswerUtils';
import type { StudentAnswerValue } from '../../types/answers';
import { htmlToPlainText, htmlToPlainTextPreserveLineBreaks } from '../../utils/htmlText';
import {
  getGroupedScoringSlotKey,
  resolveGroupedScoringRequiredCorrect,
} from '../../utils/gradingGroups';
import { scoreObjectiveDescriptors, type ObjectiveScoringResult } from '../../features/grading/objectiveScoring';

export type GradingExportSection =
  | 'reading'
  | 'listening'
  | 'science'
  | 'reading_manual'
  | 'listening_manual'
  | 'writing';

export interface CsvColumn {
  key: string;
  label: string;
}

const ACT_SCIENCE_SKILL_CATEGORY_ABBREVIATIONS: Record<ActScienceSkillCategory, string> = {
  interpretation_of_data: 'IOD',
  scientific_investigation: 'SIN',
  evaluating_scientific_arguments_and_models_with_evidence: 'ESA',
};

export const ACT_SCIENCE_CATEGORY_QUESTION_COUNT_COLUMNS: CsvColumn[] =
  ACT_SCIENCE_SKILL_CATEGORIES.map((category) => ({
    key: `scienceCategoryQuestionCount:${category.value}`,
    label: `${category.label} (${ACT_SCIENCE_SKILL_CATEGORY_ABBREVIATIONS[category.value]})`,
  }));

export const ACT_SCIENCE_CATEGORY_CORRECT_COLUMNS: CsvColumn[] = ACT_SCIENCE_SKILL_CATEGORIES.map(
  (category) => ({
    key: `scienceCategory:${category.value}`,
    label: `${ACT_SCIENCE_SKILL_CATEGORY_ABBREVIATIONS[category.value]} correct`,
  }),
);

export const ACT_SCIENCE_CATEGORY_PERCENTAGE_COLUMNS: CsvColumn[] =
  ACT_SCIENCE_SKILL_CATEGORIES.map((category) => ({
    key: `scienceCategoryPercentage:${category.value}`,
    label: `${ACT_SCIENCE_SKILL_CATEGORY_ABBREVIATIONS[category.value]} Percentage`,
  }));

export interface ExportSessionContext {
  sessionId: string;
  examTitle: string;
}

/**
 * Grading must pin to the immutable published version (S2-C13). A draft is a
 * moving target: grading against it silently re-scores operators' work when
 * the author edits. Draft is used only via explicit opt-in override.
 */
export function resolveObjectiveGradingVersionId(
  publishedVersionId: string | undefined,
  draftVersionId?: string | null | undefined,
  options?: { allowDraftOverride?: boolean },
): string | undefined {
  if (options?.allowDraftOverride && draftVersionId) {
    return draftVersionId;
  }
  return publishedVersionId ?? draftVersionId ?? undefined;
}

export interface ObjectiveTracebackItem {
  numberLabel: string;
  questionId: string;
  prompt: string;
  questionType?: string;
  studentAnswer: string;
  correctAnswer: string;
  correctness: boolean | null;
  manualOverride?: ObjectiveManualOverride;
  awardedScore: number | null;
  maxScore: number | null;
  answerKey: string;
  /**
   * Grouped scoring support (e.g. two blanks required for one mark).
   * When present, this item represents a single "question slot" with multiple sub-answers.
   */
  rootId?: string;
  rootNumberLabel?: string;
  rootRuleLabel?: string;
  requiredCorrect?: number;
  answerKeys?: string[];
  slotLabels?: string[];
  slotQuestionIds?: string[];
  slotCorrectness?: Array<boolean | null>;
  slotManualOverrides?: Array<ObjectiveManualOverride | null>;
  studentAnswerSlots?: string[];
  correctAnswerSlots?: string[];
  /** Choose-N export: one entry per question number, in selection order. */
  selectionAnswers?: string[];
  selectionCorrectAnswers?: string[];
  selectionScores?: number[];
}

export interface ObjectiveTracebackGroup {
  groupId: string;
  groupLabel: string;
  items: ObjectiveTracebackItem[];
}

export const READING_EXPORT_COLUMNS: CsvColumn[] = [
  { key: 'examTitle', label: 'Exam Title' },
  { key: 'sessionId', label: 'Session ID' },
  { key: 'scheduleId', label: 'Schedule ID' },
  { key: 'submissionId', label: 'Submission ID' },
  { key: 'studentName', label: 'Student Name' },
  { key: 'studentId', label: 'Student ID' },
  { key: 'studentEmail', label: 'Student Email' },
  { key: 'nickname', label: 'Nickname' },
  { key: 'ieltsCourse', label: 'IELTS Course' },
  { key: 'cohortName', label: 'Cohort Name' },
  { key: 'section', label: 'Section' },
  { key: 'groupLabel', label: 'Passage / Part' },
  { key: 'questionNumber', label: 'Question Number' },
  { key: 'questionId', label: 'Question ID' },
  { key: 'prompt', label: 'Prompt' },
  { key: 'studentAnswer', label: 'Student Answer' },
  { key: 'correctAnswer', label: 'Correct Answer' },
  { key: 'isCorrect', label: 'Correctness' },
  { key: 'autoScore', label: 'Auto Score' },
  { key: 'maxScore', label: 'Max Score' },
  { key: 'submittedAt', label: 'Submitted At' },
];

export const LISTENING_EXPORT_COLUMNS: CsvColumn[] = READING_EXPORT_COLUMNS.map((column) => column);

export const OBJECTIVE_WIDE_EXPORT_BASE_COLUMNS: CsvColumn[] = [
  { key: 'examTitle', label: 'Exam Title' },
  { key: 'sessionId', label: 'Session ID' },
  { key: 'scheduleId', label: 'Schedule ID' },
  { key: 'submissionId', label: 'Submission ID' },
  { key: 'studentName', label: 'Student Name' },
  { key: 'studentId', label: 'Student ID' },
  { key: 'studentEmail', label: 'Student Email' },
  { key: 'nickname', label: 'Nickname' },
  { key: 'ieltsCourse', label: 'IELTS Course' },
  { key: 'cohortName', label: 'Cohort Name' },
  { key: 'section', label: 'Section' },
  { key: 'submittedAt', label: 'Submitted At' },
  { key: 'totalScore', label: 'Total Score' },
  { key: 'maxScore', label: 'Max Score' },
  { key: 'percentage', label: 'Percentage' },
  { key: 'correctCount', label: 'Correct Count' },
];

export const OBJECTIVE_WIDE_MANUAL_EXPORT_BASE_COLUMNS: CsvColumn[] = [
  { key: 'examTitle', label: 'Exam Title' },
  { key: 'studentName', label: 'Student Name' },
  { key: 'studentId', label: 'Student ID' },
  { key: 'studentEmail', label: 'Student Email' },
  { key: 'nickname', label: 'Nickname' },
  { key: 'ieltsCourse', label: 'IELTS Course' },
  { key: 'section', label: 'Section' },
  { key: 'totalScore', label: 'Total Score' },
];

export const WRITING_EXPORT_COLUMNS: CsvColumn[] = [
  { key: 'examTitle', label: 'Exam Title' },
  { key: 'sessionId', label: 'Session ID' },
  { key: 'scheduleId', label: 'Schedule ID' },
  { key: 'submissionId', label: 'Submission ID' },
  { key: 'studentName', label: 'Student Name' },
  { key: 'studentId', label: 'Student ID' },
  { key: 'studentEmail', label: 'Student Email' },
  { key: 'nickname', label: 'Nickname' },
  { key: 'ieltsCourse', label: 'IELTS Course' },
  { key: 'cohortName', label: 'Cohort Name' },
  { key: 'section', label: 'Section' },
  { key: 'taskId', label: 'Task ID' },
  { key: 'taskLabel', label: 'Task Label' },
  { key: 'prompt', label: 'Prompt' },
  { key: 'studentText', label: 'Student Text' },
  { key: 'wordCount', label: 'Word Count' },
  { key: 'taskResponseBand', label: 'Task Response Band' },
  { key: 'coherenceBand', label: 'Coherence Band' },
  { key: 'lexicalBand', label: 'Lexical Band' },
  { key: 'grammarBand', label: 'Grammar Band' },
  { key: 'overallBand', label: 'Overall Band' },
  { key: 'overallFeedback', label: 'Overall Feedback' },
  { key: 'studentVisibleNotes', label: 'Student Visible Notes' },
  { key: 'annotationCount', label: 'Annotation Count' },
  { key: 'studentVisibleAnnotationCount', label: 'Student Visible Annotation Count' },
  { key: 'gradingStatus', label: 'Grading Status' },
  { key: 'submittedAt', label: 'Submitted At' },
  { key: 'gradedBy', label: 'Graded By' },
  { key: 'gradedAt', label: 'Graded At' },
];

const WRITING_WIDE_EXPORT_BASE_COLUMNS: CsvColumn[] = [
  { key: 'examTitle', label: 'Exam Title' },
  { key: 'sessionId', label: 'Session ID' },
  { key: 'scheduleId', label: 'Schedule ID' },
  { key: 'submissionId', label: 'Submission ID' },
  { key: 'studentName', label: 'Student Name' },
  { key: 'studentId', label: 'Student ID' },
  { key: 'studentEmail', label: 'Student Email' },
  { key: 'nickname', label: 'Nickname' },
  { key: 'ieltsCourse', label: 'IELTS Course' },
  { key: 'cohortName', label: 'Cohort Name' },
  { key: 'section', label: 'Section' },
  { key: 'submittedAt', label: 'Submitted At' },
];

const WRITING_WIDE_TASK_FIELDS = [
  { key: 'wordCount', label: 'Word Count' },
  { key: 'response', label: 'Response' },
  { key: 'taskResponseBand', label: 'Task Response Band' },
  { key: 'coherenceBand', label: 'Coherence Band' },
  { key: 'lexicalBand', label: 'Lexical Band' },
  { key: 'grammarBand', label: 'Grammar Band' },
  { key: 'overallBand', label: 'Overall Band' },
  { key: 'overallFeedback', label: 'Overall Feedback' },
  { key: 'studentVisibleNotes', label: 'Student Visible Notes' },
  { key: 'annotationCount', label: 'Annotation Count' },
  { key: 'studentVisibleAnnotationCount', label: 'Student Visible Annotation Count' },
  { key: 'gradingStatus', label: 'Grading Status' },
  { key: 'gradedBy', label: 'Graded By' },
  { key: 'gradedAt', label: 'Graded At' },
] as const;

export const WRITING_WIDE_EXPORT_COLUMNS: CsvColumn[] = [
  ...WRITING_WIDE_EXPORT_BASE_COLUMNS,
  ...['task1', 'task2'].flatMap((taskKey, index) =>
    WRITING_WIDE_TASK_FIELDS.map((field) => ({
      key: `${taskKey}:${field.key}`,
      label: `Task ${index + 1} ${field.label}`,
    })),
  ),
];

function toPlainText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toOptionalNumber(value: number | null | undefined): number | '' {
  return value === null || value === undefined ? '' : value;
}

function calculateCategoryPercentage(correctCount: number, questionCount: number): number {
  if (questionCount <= 0) return 0;
  return Number(((correctCount / questionCount) * 100).toFixed(2));
}

export function escapeCsvValue(value: unknown): string {
  const text = toPlainText(value);
  if (text === '') return '';
  const shouldProtectForExcel =
    typeof value === 'string' && /^[\s]*[=+\-@]/.test(text);
  const escapedText = shouldProtectForExcel ? `'${text}` : text;
  if (/["\r\n,]/.test(escapedText)) {
    return `"${escapedText.replace(/"/g, '""')}"`;
  }
  return escapedText;
}

export function buildCsvContent(columns: CsvColumn[], rows: Array<Record<string, unknown>>): string {
  const header = columns.map((column) => escapeCsvValue(column.label)).join(',');
  const body = rows.map((row) => columns.map((column) => escapeCsvValue(row[column.key])).join(','));
  return [header, ...body].join('\r\n');
}

export function downloadCsvFile(filename: string, csvContent: string): void {
  if (typeof document === 'undefined') return;

  const blob = new Blob(['\ufeff', csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadBinaryFile(
  filename: string,
  bytes: Uint8Array | ArrayBuffer,
  contentType: string,
): void {
  if (typeof document === 'undefined') return;

  const blob = new Blob([bytes], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function buildQuestionResultMap(results: ObjectiveQuestionResult[] | undefined): Map<string, ObjectiveQuestionResult> {
  return new Map((results ?? []).map((result) => [result.questionId, result] as const));
}

function hasPersistedAnswer(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.trim() !== '';
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasPersistedAnswer(entry));
  }
  return value !== null && value !== undefined;
}

/**
 * Older/refactored grading payloads can retain the server-computed
 * questionResults while returning an empty section answer map. Keep the
 * canonical answer map authoritative, but recover missing slots from the
 * persisted result so exports and review never hide a saved response.
 */
function mergePersistedResultAnswers(
  descriptors: StudentQuestionDescriptor[],
  answerMap: Record<string, StudentAnswerValue | undefined>,
  results: Map<string, ObjectiveQuestionResult>,
): Record<string, StudentAnswerValue | undefined> {
  const merged: Record<string, StudentAnswerValue | undefined> = { ...answerMap };

  for (const descriptor of descriptors) {
    if (hasPersistedAnswer(getQuestionAnswer(descriptor, merged))) {
      continue;
    }

    const persistedAnswer = results.get(descriptor.id)?.studentAnswer;
    if (typeof persistedAnswer !== 'string' || persistedAnswer.trim() === '') {
      continue;
    }

    if (descriptor.answerIndex === undefined) {
      merged[descriptor.answerKey] = persistedAnswer;
      continue;
    }

    const existingAnswer = merged[descriptor.answerKey];
    const slots: string[] = Array.isArray(existingAnswer)
      ? [...(existingAnswer as string[])]
      : [];
    slots[descriptor.answerIndex] = persistedAnswer;
    merged[descriptor.answerKey] = slots;
  }

  return merged;
}

function getExportCorrectAnswerDisplay(
  descriptor: StudentQuestionDescriptor,
  questionResult: ObjectiveQuestionResult | undefined,
  options: AnswerDisplayOptions = {},
): string {
  const snapshotAnswer = getCorrectAnswerDisplay(descriptor, options);
  if (
    (questionResult?.hasOverride || snapshotAnswer.trim() === '') &&
    typeof questionResult?.correctAnswer === 'string' && questionResult.correctAnswer.trim() !== ''
  ) {
    return getCorrectAnswerDisplay(descriptor, {
      ...options,
      correctAnswerOverride: questionResult.correctAnswer,
    });
  }

  return snapshotAnswer;
}

function getQuestionSkillCategory(
  descriptor: StudentQuestionDescriptor,
): ActScienceSkillCategory | undefined {
  const question = descriptor.question;
  if (!question || !('skillCategory' in question)) {
    return undefined;
  }

  const skillCategory = question.skillCategory;
  return ACT_SCIENCE_SKILL_CATEGORIES.some((category) => category.value === skillCategory)
    ? skillCategory
    : undefined;
}

/**
 * Score-group key → required-correct threshold for export fallbacks that lack
 * descriptor context. Keys match the wide-export `scoreGroup:*` column keys.
 */
export function buildScoreGroupThresholdMap(
  descriptors: StudentQuestionDescriptor[],
): Record<string, number> {
  const groups = new Map<string, StudentQuestionDescriptor[]>();
  for (const descriptor of descriptors) {
    const groupKey = getGroupedScoringSlotKey(descriptor);
    if (!groupKey) continue;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), descriptor]);
  }
  const map: Record<string, number> = {};
  for (const [groupKey, members] of groups) {
    map[`scoreGroup:${groupKey}`] = resolveGroupedScoringRequiredCorrect(members);
  }
  return map;
}

function getGroupedSlotLabel(descriptor: StudentQuestionDescriptor, index: number): string {
  const fallback = `Answer ${index + 1}`;

  if (descriptor.block.type === 'SENTENCE_COMPLETION' || descriptor.block.type === 'NOTE_COMPLETION') {
    return typeof descriptor.answerIndex === 'number' ? `Blank ${descriptor.answerIndex + 1}` : fallback;
  }

  if (descriptor.block.type === 'TABLE_COMPLETION') {
    return typeof descriptor.answerIndex === 'number' ? `Cell ${descriptor.answerIndex + 1}` : fallback;
  }

  return fallback;
}

/**
 * True when the loaded exam snapshot carries a readable key the website
 * re-check can score. Submissions graded from a sealed answer definition whose
 * snapshot key the loaded version no longer holds must keep their saved
 * verdict: the key-less re-check would otherwise report a decisive
 * "Incorrect" and flip a saved Correct answer.
 */
export function descriptorHasRecheckableKey(descriptor: StudentQuestionDescriptor): boolean {
  if (getEffectiveAcceptedAnswersForGrading(descriptor).some((answer) => answer.trim() !== '')) {
    return true;
  }
  const correct = getCorrectAnswerValue(descriptor);
  if (correct === null || correct === undefined) return false;
  if (formatAnswerValue(correct).trim() !== '') return true;
  return Array.isArray(correct) && correct.length > 0;
}

export interface DisplayedObjectiveValues {
  readonly correctness: boolean | null;
  readonly awardedScore: number | null;
  readonly maxScore: number | null;
  /** True when the saved result disagrees with a decisive re-check. */
  readonly outOfDate: boolean;
}

/**
 * The saved result is the official score, but a stored `Correct` that the
 * current exact-case IELTS rule says is Incorrect (or vice versa) must never be
 * displayed as the answer's verdict: grading screens and exports show the
 * re-checked verdict so the rules staff and PDFs report are the ones that
 * actually decide an answer. `outOfDate` still drives the "regrade" warning,
 * and the saved score stays official until the session is regraded.
 *
 * Only a boolean verdict change is corrected. Numeric-only differences are left
 * on the saved result: partial-credit policy for choose-N is still an open
 * product decision, so the display must not silently adopt one side's totals.
 * A re-check only counts when it reaches a boolean verdict; a null (unanswered
 * or key-less) re-check never overrides a saved result either, and schedule or
 * per-student overrides are handled by callers before this helper.
 */
export function resolveDisplayedObjectiveValues(
  savedCorrectness: boolean | null | undefined,
  savedAwardedScore: number | null | undefined,
  savedMaxScore: number | null | undefined,
  recheck: {
    readonly correctness: boolean | null;
    readonly awardedScore: number | null;
    readonly maxScore: number | null;
  } | null | undefined,
): DisplayedObjectiveValues {
  const saved: DisplayedObjectiveValues = {
    correctness: savedCorrectness ?? null,
    awardedScore: numberOrNull(savedAwardedScore),
    maxScore: numberOrNull(savedMaxScore),
    outOfDate: false,
  };
  if (!recheck || typeof recheck.correctness !== 'boolean') {
    return saved;
  }
  if (typeof saved.correctness !== 'boolean' || saved.correctness === recheck.correctness) {
    return saved;
  }

  return {
    correctness: recheck.correctness,
    awardedScore: recheck.awardedScore ?? saved.awardedScore,
    maxScore: recheck.maxScore ?? saved.maxScore,
    outOfDate: true,
  };
}

function buildTracebackItem(
  descriptor: StudentQuestionDescriptor,
  descriptors: StudentQuestionDescriptor[],
  answerMap: Record<string, StudentAnswerValue | undefined>,
  results: Map<string, ObjectiveQuestionResult>,
  websiteScoring: ObjectiveScoringResult,
  applyRecheck: boolean,
): ObjectiveTracebackItem {
  const questionResult = results.get(descriptor.id);
  const websiteScore = websiteScoring.byId.get(descriptor.id);
  const savedCorrectness = questionResult?.manualOverride?.isCorrect
    ?? questionResult?.isCorrect
    ?? null;
  const savedAwardedScore = questionResult?.manualOverride?.awardedScore
    ?? questionResult?.awardedScore
    ?? null;
  const savedMaxScore = questionResult?.maxScore ?? null;
  // Saved overrides win outright. Otherwise the displayed verdict follows the
  // current exact-case re-check whenever the saved row is out of date; with no
  // usable saved result the re-check is the only source.
  const displayed = applyRecheck
    && descriptorHasRecheckableKey(descriptor)
    && questionResult !== undefined
    && !questionResult.manualOverride
    && questionResult.hasOverride !== true
    ? resolveDisplayedObjectiveValues(savedCorrectness, savedAwardedScore, savedMaxScore, websiteScore ?? null)
    : {
        correctness: savedCorrectness ?? websiteScore?.correctness ?? null,
        awardedScore: savedAwardedScore ?? websiteScore?.awardedScore ?? null,
        maxScore: savedMaxScore ?? websiteScore?.maxScore ?? null,
        outOfDate: false,
      };
  const correctness = displayed.correctness;
  const awardedScore = displayed.awardedScore;
  const maxScore = displayed.maxScore;
  const selection = descriptor.block.type === 'MULTI_MCQ'
    ? buildMultiSelectExportSelection(descriptor, answerMap, awardedScore)
    : null;

  return {
    numberLabel: getQuestionNumberLabel(descriptors, descriptor.id),
    questionId: descriptor.id,
    prompt: getQuestionPrompt(descriptor),
    studentAnswer: getStudentAnswerDisplay(descriptor, answerMap),
    correctAnswer: getExportCorrectAnswerDisplay(descriptor, questionResult),
    correctness,
    ...(questionResult?.manualOverride ? { manualOverride: questionResult.manualOverride } : {}),
    awardedScore,
    maxScore,
    answerKey: descriptor.answerKey,
    ...(descriptor.rootId === undefined ? {} : { rootId: descriptor.rootId }),
    ...(typeof descriptor.rootNumber === 'number'
      ? { rootNumberLabel: String(descriptor.rootNumber) }
      : {}),
    ...(selection ?? {}),
  };
}

function buildMultiSelectExportSelection(
  descriptor: StudentQuestionDescriptor,
  answerMap: Record<string, StudentAnswerValue | undefined>,
  awardedScore: number | null,
): Pick<ObjectiveTracebackItem, 'selectionAnswers' | 'selectionCorrectAnswers' | 'selectionScores'> | null {
  if (descriptor.block.type !== 'MULTI_MCQ') return null;
  const options = Array.isArray(descriptor.block.options) ? descriptor.block.options : [];
  const correctOptions = options.filter((option) => option.isCorrect);
  const optionCount = Math.max(1, correctOptions.length);
  const given = getQuestionAnswer(descriptor, answerMap);
  const selectedIds = Array.isArray(given)
    ? given.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const correctIds = new Set(correctOptions.map((option) => option.id));
  const optionText = (id: string) => options.find((option) => option.id === id)?.text ?? id;
  const selectionAnswers = Array.from({ length: optionCount }, (_, index) =>
    selectedIds[index] ? optionText(selectedIds[index]!) : '',
  );
  const selectionScores: number[] = Array.from({ length: optionCount }, (_, index) =>
    selectedIds[index] && correctIds.has(selectedIds[index]!) ? 1 : 0,
  );
  // The saved partial score is authoritative; the per-selection list only
  // distributes Yes/No across the builder's question numbers. Truly-correct
  // picks keep Yes first so a correct selection is never deprived of credit
  // in favor of an earlier incorrect one.
  if (awardedScore !== null && awardedScore !== selectionScores.reduce((sum, value) => sum + value, 0)) {
    let remaining = Math.max(0, Math.min(awardedScore, selectionScores.length));
    const order = selectionScores
      .map((score, index) => ({ score, index: index as number }))
      .sort((left, right) => right.score - left.score || left.index - right.index);
    selectionScores.fill(0);
    for (const { index } of order) {
      if (remaining <= 0) break;
      selectionScores[index] = 1;
      remaining -= 1;
    }
  }
  return {
    selectionAnswers,
    selectionCorrectAnswers: correctOptions.map((option) => option.text),
    selectionScores,
  };
}

function buildGroupedTracebackItem(
  groupKey: string,
  groupDescriptors: StudentQuestionDescriptor[],
  allDescriptors: StudentQuestionDescriptor[],
  answerMap: Record<string, StudentAnswerValue | undefined>,
  results: Map<string, ObjectiveQuestionResult>,
  websiteScoring: ObjectiveScoringResult,
  applyRecheck: boolean,
): ObjectiveTracebackItem {
  const sorted = [...groupDescriptors].sort((left, right) => (left.answerIndex ?? 0) - (right.answerIndex ?? 0));
  const representative = sorted[0];
  if (!representative) {
    return {
      numberLabel: '',
      questionId: groupKey,
      prompt: '',
      studentAnswer: '',
      correctAnswer: '',
      correctness: null,
      awardedScore: null,
      maxScore: null,
      answerKey: '',
      rootId: groupKey,
    };
  }

  const groupHasRecheckableKey = sorted.every((descriptor) => descriptorHasRecheckableKey(descriptor));
  const slotDisplayed = sorted.map((descriptor) => {
    const questionResult = results.get(descriptor.id);
    const websiteScore = websiteScoring.byId.get(descriptor.id);
    const savedCorrectness = questionResult?.manualOverride?.isCorrect
      ?? questionResult?.isCorrect
      ?? null;
    const savedAwardedScore = questionResult?.manualOverride?.awardedScore
      ?? questionResult?.awardedScore
      ?? null;
    const savedMaxScore = questionResult?.maxScore ?? null;
    if (
      applyRecheck
      && groupHasRecheckableKey
      && questionResult !== undefined
      && !questionResult.manualOverride
      && questionResult.hasOverride !== true
    ) {
      return resolveDisplayedObjectiveValues(savedCorrectness, savedAwardedScore, savedMaxScore, websiteScore ?? null);
    }
    return {
      correctness: savedCorrectness ?? websiteScore?.correctness ?? null,
      awardedScore: savedAwardedScore ?? websiteScore?.awardedScore ?? null,
      maxScore: savedMaxScore ?? websiteScore?.maxScore ?? null,
      outOfDate: false,
    };
  });
  const slotCorrectness = slotDisplayed.map((value) => value.correctness);
  const slotManualOverrides = sorted.map(
    (descriptor) => results.get(descriptor.id)?.manualOverride ?? null,
  );

  const requiredCorrect = resolveGroupedScoringRequiredCorrect(sorted);
  const correctSlots = slotCorrectness.filter((value) => value === true).length;
  const hasUnscored = slotCorrectness.some((value) => value === null);

  // The server's saved result is authoritative for the group mark. The
  // representative slot is the only saved result carrying a positive maxScore
  // (the server awards the group mark once, on the first slot). Old/unscored
  // submissions without saved results fall back to the computed threshold.
  const savedResults = sorted
    .map((descriptor) => results.get(descriptor.id))
    .filter((questionResult): questionResult is ObjectiveQuestionResult => Boolean(questionResult));
  const savedGroupResult =
    savedResults.find((questionResult) => (questionResult.maxScore ?? 0) > 0)
    ?? savedResults[0]
    ?? null;

  const computedCorrectness = hasUnscored ? null : correctSlots >= requiredCorrect;
  const anySlotOutOfDate = slotDisplayed.some((value) => value.outOfDate);
  const hasSavedOverride = sorted.some((descriptor) => {
    const questionResult = results.get(descriptor.id);
    return Boolean(questionResult?.manualOverride) || questionResult?.hasOverride === true;
  });
  const isTreeGroup = sorted.some((descriptor) => descriptor.isSubAnswerTreeLeaf);
  const recheckGroupMark = anySlotOutOfDate
    ? websiteScoring.byId.get(representative.id)
    : undefined;

  let correctness: boolean | null;
  let awardedScore: number | null;
  let maxScore: number | null;
  if (applyRecheck && groupHasRecheckableKey && anySlotOutOfDate && !hasSavedOverride) {
    // The group mark follows the re-check too: a stale lenient group mark must
    // not survive once one of its slots is re-graded as incorrect. Tree roots
    // own their group verdict in the re-check, so prefer that when present.
    correctness = isTreeGroup && typeof recheckGroupMark?.correctness === 'boolean'
      ? recheckGroupMark.correctness
      : computedCorrectness;
    maxScore = recheckGroupMark?.maxScore ?? savedGroupResult?.maxScore ?? (correctness === null ? null : 1);
    awardedScore = correctness === null ? null : correctness ? maxScore : 0;
  } else {
    correctness = savedGroupResult?.manualOverride?.isCorrect
      ?? savedGroupResult?.isCorrect
      ?? computedCorrectness;
    awardedScore = savedGroupResult?.manualOverride?.awardedScore
      ?? savedGroupResult?.awardedScore
      ?? (correctness === null ? null : correctness ? 1 : 0);
    maxScore = savedGroupResult?.maxScore ?? (correctness === null ? null : 1);
  }

  const slotLabels = sorted.map((descriptor, index) => getGroupedSlotLabel(descriptor, index));
  const studentAnswerSlots = sorted.map((descriptor) => getStudentAnswerDisplay(descriptor, answerMap));
  const correctAnswerSlots = sorted.map((descriptor) => (
    getExportCorrectAnswerDisplay(descriptor, results.get(descriptor.id))
  ));
  const answerKeys = sorted.map((descriptor) => descriptor.answerKey).filter(Boolean);

  const prompt =
    representative.block.type === 'SENTENCE_COMPLETION' && representative.question && 'sentence' in representative.question
      ? representative.question.sentence ?? ''
      : representative.block.instruction || getQuestionPrompt(representative);

  return {
    numberLabel: getQuestionNumberLabel(allDescriptors, representative.id),
    questionId: representative.id,
    prompt,
    studentAnswer: studentAnswerSlots.join(' | '),
    correctAnswer: correctAnswerSlots.join(' | '),
    correctness,
    awardedScore,
    maxScore,
    answerKey: representative.answerKey,
    rootId: groupKey,
    ...(typeof representative.rootNumber === 'number'
      ? { rootNumberLabel: String(representative.rootNumber) }
      : {}),
    requiredCorrect,
    answerKeys,
    slotLabels,
    slotQuestionIds: sorted.map((descriptor) => descriptor.id),
    slotCorrectness,
    slotManualOverrides,
    studentAnswerSlots,
    correctAnswerSlots,
  };
}

export function buildQuestionTracebackGroups(
  examState: ExamState | null,
  sectionSubmission: SectionSubmission | null,
  moduleType: 'reading' | 'listening' | 'science',
): ObjectiveTracebackGroup[] {
  if (!examState || !sectionSubmission) {
    return [];
  }

  const descriptors = getStudentQuestionsForModule(examState, moduleType);
  const results = buildQuestionResultMap(sectionSubmission.autoGradingResults?.questionResults);
  const answerMap = mergePersistedResultAnswers(
    descriptors,
    extractObjectiveAnswerMap(sectionSubmission.answers),
    results,
  );
  const websiteScoring = scoreObjectiveDescriptors(descriptors, answerMap);
  // IELTS reading/listening require exact-case answers; when a saved row was
  // graded before that rule was enforced (or by a stale grader), the displayed
  // verdict follows the shared re-check. ACT science keeps its saved verdicts.
  const applyRecheck = moduleType !== 'science';
  const groups = new Map<string, ObjectiveTracebackGroup>();
  const groupedSlotsByGroup = new Map<string, Map<string, StudentQuestionDescriptor[]>>();

  for (const descriptor of descriptors) {
    const groupId = descriptor.groupId || 'group';
    const groupLabel = descriptor.groupLabel || 'Group';
    if (!groups.has(groupId)) {
      groups.set(groupId, {
        groupId,
        groupLabel,
        items: [],
      });
    }
    const slotKey = getGroupedScoringSlotKey(descriptor) ?? descriptor.id;
    if (!groupedSlotsByGroup.has(groupId)) {
      groupedSlotsByGroup.set(groupId, new Map());
    }
    const slots = groupedSlotsByGroup.get(groupId);
    if (!slots) continue;
    if (!slots.has(slotKey)) {
      slots.set(slotKey, []);
    }
    slots.get(slotKey)?.push(descriptor);
  }

  for (const [groupId, group] of groups.entries()) {
    const slots = groupedSlotsByGroup.get(groupId);
    if (!slots) continue;
    for (const [slotKey, slotDescriptors] of slots.entries()) {
      const groupKey = getGroupedScoringSlotKey(slotDescriptors[0] ?? ({} as StudentQuestionDescriptor));
      if (groupKey) {
        group.items.push(
          buildGroupedTracebackItem(slotKey, slotDescriptors, descriptors, answerMap, results, websiteScoring, applyRecheck),
        );
      } else {
        const descriptor = slotDescriptors[0];
        if (!descriptor) continue;
        group.items.push(buildTracebackItem(descriptor, descriptors, answerMap, results, websiteScoring, applyRecheck));
      }
    }
  }

  return Array.from(groups.values());
}

export interface ObjectiveSectionDisplaySummary {
  readonly totalScore: number | null;
  readonly maxScore: number | null;
  readonly percentage: number | null;
  readonly correctCount: number;
  /** True when at least one saved result disagrees with the current rule. */
  readonly savedOutOfDate: boolean;
}

/**
 * The one summary a grading or export surface should show for one objective
 * section when it must agree with the displayed per-question verdicts. It is
 * derived from the corrected traceback items (exact-case re-check where the
 * saved row is out of date), so a section total can never claim a mark the
 * visible rows do not award.
 */
export function buildObjectiveSectionDisplaySummary(
  examState: ExamState | null,
  sectionSubmission: SectionSubmission | null,
  moduleType: 'reading' | 'listening' | 'science',
): ObjectiveSectionDisplaySummary | null {
  if (!examState || !sectionSubmission) return null;
  const groups = buildQuestionTracebackGroups(examState, sectionSubmission, moduleType);
  if (groups.length === 0) return null;
  const totals = deriveObjectiveTotalsFromTracebackGroups(groups);
  return {
    ...totals,
    correctCount: countCorrectAnswers(groups),
    savedOutOfDate: findSavedScoreMismatches(examState, sectionSubmission, moduleType).length > 0,
  };
}

export interface ObjectiveExportRowInput {
  session: ExportSessionContext;
  submission: StudentSubmission;
  sectionSubmission: SectionSubmission;
  examState: ExamState | null;
  moduleType: 'reading' | 'listening' | 'science';
}

export interface WideObjectiveExportInput {
  session: ExportSessionContext;
  submissions: StudentSubmission[];
  sectionSubmissions: Array<{
    submissionId: string;
    sectionSubmission: SectionSubmission | null | undefined;
  }>;
  examState: ExamState | null;
  moduleType: 'reading' | 'listening' | 'science';
  mode?: ObjectiveWideExportMode;
}

export interface WideObjectiveExport {
  columns: CsvColumn[];
  rows: Array<Record<string, unknown>>;
}

export function mergeWideObjectiveExports(
  exportsByVersion: WideObjectiveExport[],
  submissions: StudentSubmission[],
): WideObjectiveExport {
  if (exportsByVersion.length === 1) return exportsByVersion[0]!;

  const columns = new Map<string, CsvColumn>();
  const rowsBySubmissionId = new Map<unknown, Record<string, unknown>>();
  // CSV headers name question positions. A different version can have a
  // different question ID at the same position, or move an existing ID.
  const exportsByWidth = [...exportsByVersion].sort((left, right) => right.columns.length - left.columns.length);
  for (const exportData of exportsByWidth) {
    const labelCounts = new Map<string, number>();
    const columnMapping = exportData.columns.map(({ key, label }) => {
      const occurrence = (labelCounts.get(label) ?? 0) + 1;
      labelCounts.set(label, occurrence);
      const mergedKey = JSON.stringify([label, occurrence]);
      columns.set(mergedKey, { key: mergedKey, label });
      return { key, mergedKey };
    });
    for (const row of exportData.rows) {
      rowsBySubmissionId.set(row['submissionId'], Object.fromEntries(
        columnMapping.map(({ key, mergedKey }) => [mergedKey, row[key]]),
      ));
    }
  }

  return {
    columns: [...columns.values()],
    rows: submissions.map((submission) => rowsBySubmissionId.get(submission.id)!),
  };
}

export type ObjectiveWideExportMode = 'auto' | 'manual';

export interface WideWritingExportInput {
  session: ExportSessionContext;
  submissions: StudentSubmission[];
  writingSubmissions: Array<{
    submissionId: string;
    writing: WritingTaskSubmission[];
  }>;
}

export interface WideWritingExport {
  columns: CsvColumn[];
  rows: Array<Record<string, unknown>>;
}

export function buildObjectiveExportRows({
  session,
  submission,
  sectionSubmission,
  examState,
  moduleType,
}: ObjectiveExportRowInput): Array<Record<string, unknown>> {
  const groups = buildQuestionTracebackGroups(examState, sectionSubmission, moduleType);
  const rows: Array<Record<string, unknown>> = [];

  for (const group of groups) {
    for (const item of group.items) {
      const baseRow = {
        examTitle: session.examTitle,
        sessionId: session.sessionId,
        scheduleId: submission.scheduleId,
        submissionId: submission.id,
        studentName: submission.studentName,
        studentId: submission.studentId,
        studentEmail: submission.studentEmail ?? '',
        nickname: submission.nickname ?? '',
        ieltsCourse: submission.ieltsCourse ?? '',
        cohortName: submission.cohortName,
        section: moduleType,
        groupLabel: group.groupLabel,
        questionId: item.rootId ?? item.questionId,
        prompt: item.prompt,
        submittedAt: sectionSubmission.submittedAt,
      };
      if (item.selectionScores && item.selectionScores.length > 0) {
        const start = Number.parseInt(item.numberLabel, 10);
        item.selectionScores.forEach((score, index) => {
          rows.push({
            ...baseRow,
            questionNumber: Number.isFinite(start) ? String(start + index) : item.numberLabel,
            studentAnswer: item.selectionAnswers?.[index] ?? '',
            correctAnswer: (item.selectionCorrectAnswers ?? []).join(' | '),
            isCorrect: score > 0 ? 'Correct' : 'Incorrect',
            autoScore: score,
            maxScore: 1,
          });
        });
        continue;
      }
      rows.push({
        ...baseRow,
        questionNumber: item.numberLabel,
        studentAnswer: item.studentAnswer,
        correctAnswer: item.correctAnswer,
        isCorrect:
          item.correctness === null
            ? 'Not Scored'
            : item.correctness
              ? 'Correct'
              : 'Incorrect',
        autoScore: toOptionalNumber(item.awardedScore),
        maxScore: toOptionalNumber(item.maxScore),
      });
    }
  }

  return rows;
}

function getQuestionColumnLabel(descriptor: StudentQuestionDescriptor, descriptors: StudentQuestionDescriptor[]): string {
  const numberLabel = getQuestionNumberLabel(descriptors, descriptor.id);
  return `Q${numberLabel}`;
}

function countCorrectAnswers(groups: ObjectiveTracebackGroup[]): number {
  return groups.reduce(
    (count, group) => count + group.items.reduce(
      (groupCount, item) => groupCount + (item.awardedScore ?? 0),
      0,
    ),
    0,
  );
}

function deriveObjectiveTotalsFromTracebackGroups(groups: ObjectiveTracebackGroup[]): {
  totalScore: number | null;
  maxScore: number | null;
  percentage: number | null;
} {
  const items = groups.flatMap((group) => group.items);
  if (items.length === 0) {
    return { totalScore: null, maxScore: null, percentage: null };
  }

  let totalScore = 0;
  let maxScore = 0;
  for (const item of items) {
    if (item.awardedScore === null || item.awardedScore === undefined) {
      return { totalScore: null, maxScore: null, percentage: null };
    }
    if (item.maxScore === null || item.maxScore === undefined) {
      return { totalScore: null, maxScore: null, percentage: null };
    }
    totalScore += item.awardedScore;
    maxScore += item.maxScore;
  }

  const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
  return { totalScore, maxScore, percentage };
}

function calculateBandScore(rawScore: number, table: Record<number, number>): number {
  const sortedThresholds = Object.keys(table)
    .map(Number)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left);
  for (const threshold of sortedThresholds) {
    if (rawScore >= threshold) {
      return table[threshold] ?? 0;
    }
  }
  return 0;
}

function getObjectiveBandTable(
  examState: ExamState | null,
  moduleType: 'reading' | 'listening' | 'science',
): Record<number, number> | null {
  if (!examState) return null;
  if (moduleType === 'science') return null;

  if (moduleType === 'listening') {
    return examState.config.standards.bandScoreTables.listening
      ?? examState.config.sections.listening.bandScoreTable
      ?? null;
  }

  if (examState.type === 'General Training') {
    return examState.config.standards.bandScoreTables.readingGeneralTraining
      ?? examState.config.sections.reading.bandScoreTable
      ?? null;
  }

  return examState.config.standards.bandScoreTables.readingAcademic
    ?? examState.config.sections.reading.bandScoreTable
    ?? null;
}

export function deriveIeltsBandScore(
  examState: ExamState | null,
  moduleType: 'reading' | 'listening' | 'science',
  totalScore: number | null | undefined,
): number | '' {
  if (typeof totalScore !== 'number' || !Number.isFinite(totalScore)) {
    return '';
  }
  const table = getObjectiveBandTable(examState, moduleType);
  if (!table) {
    return '';
  }

  return calculateBandScore(totalScore, table);
}

export function buildWideObjectiveExport({
  session,
  submissions,
  sectionSubmissions,
  examState,
  moduleType,
  mode = 'auto',
}: WideObjectiveExportInput): WideObjectiveExport {
  const descriptors = examState ? getStudentQuestionsForModule(examState, moduleType) : [];
  const answerDisplayOptions: AnswerDisplayOptions | undefined =
    moduleType === 'science' ? { includeChoiceLabels: true } : undefined;

  type ExportSlot = {
    slotKey: string;
    isGrouped: boolean;
    representativeId: string;
    baseLabel: string;
    descriptors: StudentQuestionDescriptor[];
  };

  const slotMap = new Map<string, StudentQuestionDescriptor[]>();
  for (const descriptor of descriptors) {
    const slotKey = getGroupedScoringSlotKey(descriptor) ?? descriptor.id;
    if (!slotMap.has(slotKey)) {
      slotMap.set(slotKey, []);
    }
    slotMap.get(slotKey)?.push(descriptor);
  }

  const exportSlots: ExportSlot[] = Array.from(slotMap.entries()).map(([slotKey, slotDescriptors]) => {
    const sorted = [...slotDescriptors].sort((left, right) => (left.answerIndex ?? 0) - (right.answerIndex ?? 0));
    const representative = sorted[0];
    const representativeId = representative?.id ?? slotKey;
    const numberLabel = representative ? getQuestionNumberLabel(descriptors, representativeId) : '';
    return {
      slotKey,
      isGrouped: slotKey.includes('::group::'),
      representativeId,
      baseLabel: `Q${numberLabel}`,
      descriptors: sorted,
    };
  });

  const answerColumns: CsvColumn[] = [];
  const rightAnswerColumns: CsvColumn[] = [];
  const scoreColumns: CsvColumn[] = [];
  const manualQuestionColumns: CsvColumn[] = [];

  for (const slot of exportSlots) {
    if (!slot.isGrouped) {
      answerColumns.push({ key: `answer:${slot.representativeId}`, label: `${slot.baseLabel} Answer` });
      if (mode === 'auto') {
        rightAnswerColumns.push({
          key: `rightAnswer:${slot.representativeId}`,
          label: `${slot.baseLabel} Right Answer`,
        });
        scoreColumns.push({ key: `score:${slot.representativeId}`, label: `${slot.baseLabel} Score` });
      } else {
        manualQuestionColumns.push(
          { key: `answer:${slot.representativeId}`, label: `${slot.baseLabel} Answer` },
          { key: `rightAnswer:${slot.representativeId}`, label: `${slot.baseLabel} Right Answer/Answer Key` },
          { key: `manualCorrect:${slot.representativeId}`, label: `Correct ${slot.baseLabel}` },
        );
      }
      continue;
    }

    slot.descriptors.forEach((descriptor, index) => {
      const suffix = `(${index + 1})`;
      answerColumns.push({ key: `answer:${descriptor.id}`, label: `${slot.baseLabel} Answer ${suffix}` });
      if (mode === 'auto') {
        rightAnswerColumns.push({
          key: `rightAnswer:${descriptor.id}`,
          label: `${slot.baseLabel} Right Answer ${suffix}`,
        });
      } else {
        manualQuestionColumns.push(
          { key: `answer:${descriptor.id}`, label: `${slot.baseLabel} Answer ${suffix}` },
          { key: `rightAnswer:${descriptor.id}`, label: `${slot.baseLabel} Right Answer/Answer Key ${suffix}` },
        );
      }
    });

    if (mode === 'auto') {
      scoreColumns.push({ key: `scoreGroup:${slot.slotKey}`, label: `${slot.baseLabel} Score` });
    } else {
      manualQuestionColumns.push({ key: `manualCorrectGroup:${slot.slotKey}`, label: `Correct ${slot.baseLabel}` });
    }
  }

  const sectionBySubmissionId = new Map(
    sectionSubmissions.map((entry) => [entry.submissionId, entry.sectionSubmission] as const),
  );

  const rows = submissions.map((submission) => {
    const sectionSubmission = sectionBySubmissionId.get(submission.id) ?? null;
    const groups = buildQuestionTracebackGroups(examState, sectionSubmission, moduleType);
    const autoGradingResults = sectionSubmission?.autoGradingResults;
    const scoredResults = buildQuestionResultMap(autoGradingResults?.questionResults);
    const answerMap = sectionSubmission
      ? mergePersistedResultAnswers(
          descriptors,
          extractObjectiveAnswerMap(sectionSubmission.answers),
          scoredResults,
        )
      : {};
    const derivedTotals = deriveObjectiveTotalsFromTracebackGroups(groups);
    // Totals come from the same saved per-question results the rows display, so
    // a row cannot disagree with the summary. The saved section totals are only
    // a fallback when a saved result cannot be projected into traceback groups
    // (older or partial submissions).
    const totalScore = derivedTotals.totalScore ?? autoGradingResults?.totalScore ?? null;
    const maxScore = derivedTotals.maxScore ?? autoGradingResults?.maxScore ?? null;
    const percentage = derivedTotals.percentage ?? autoGradingResults?.percentage ?? null;
    const tracebackItemsById = new Map(
      groups.flatMap((group) => group.items).map((item) => [item.questionId, item] as const),
    );
    const scienceCategoryCorrectCounts: Partial<Record<ActScienceSkillCategory, number>> = {};
    const scienceCategoryQuestionCounts: Partial<Record<ActScienceSkillCategory, number>> = {};
    if (moduleType === 'science') {
      for (const descriptor of descriptors) {
        const skillCategory = getQuestionSkillCategory(descriptor);
        if (!skillCategory) continue;
        scienceCategoryQuestionCounts[skillCategory] =
          (scienceCategoryQuestionCounts[skillCategory] ?? 0) + 1;
        const tracebackItem = tracebackItemsById.get(descriptor.id);
        if (tracebackItem?.correctness !== true) continue;
        scienceCategoryCorrectCounts[skillCategory] =
          (scienceCategoryCorrectCounts[skillCategory] ?? 0) + 1;
      }
    }
    const row: Record<string, unknown> = {
      examTitle: session.examTitle,
      sessionId: session.sessionId,
      scheduleId: submission.scheduleId,
      submissionId: submission.id,
      studentName: submission.studentName,
      studentId: submission.studentId,
      studentEmail: submission.studentEmail ?? '',
      nickname: submission.nickname ?? '',
      ieltsCourse: submission.ieltsCourse ?? '',
      cohortName: submission.cohortName,
      section: moduleType,
      submittedAt: sectionSubmission?.submittedAt ?? submission.submittedAt,
      totalScore: mode === 'manual' ? '' : toOptionalNumber(totalScore),
      maxScore: toOptionalNumber(maxScore),
      percentage: toOptionalNumber(percentage),
      correctCount: countCorrectAnswers(groups),
      ieltsBandScore: deriveIeltsBandScore(examState, moduleType, totalScore),
      ...(moduleType === 'science'
        ? Object.fromEntries(
            ACT_SCIENCE_SKILL_CATEGORIES.map((category) => [
              `scienceCategoryQuestionCount:${category.value}`,
              scienceCategoryQuestionCounts[category.value] ?? 0,
            ]),
          )
        : {}),
      ...(moduleType === 'science'
        ? Object.fromEntries(
            ACT_SCIENCE_SKILL_CATEGORIES.map((category) => [
              `scienceCategory:${category.value}`,
              scienceCategoryCorrectCounts[category.value] ?? 0,
            ]),
          )
        : {}),
      ...(moduleType === 'science'
        ? Object.fromEntries(
            ACT_SCIENCE_SKILL_CATEGORIES.map((category) => [
              `scienceCategoryPercentage:${category.value}`,
              calculateCategoryPercentage(
                scienceCategoryCorrectCounts[category.value] ?? 0,
                scienceCategoryQuestionCounts[category.value] ?? 0,
              ),
            ]),
          )
        : {}),
    };

    for (const slot of exportSlots) {
      if (!slot.isGrouped) {
        const descriptor = slot.descriptors[0];
        if (!descriptor) continue;
        const scoredResult = scoredResults.get(descriptor.id);
        const fallbackItem = tracebackItemsById.get(descriptor.id);
        row[`answer:${descriptor.id}`] = getStudentAnswerDisplay(
          descriptor,
          answerMap,
          answerDisplayOptions,
        );
        row[`rightAnswer:${descriptor.id}`] = getExportCorrectAnswerDisplay(
          descriptor,
          scoredResult,
          answerDisplayOptions,
        );
        if (mode === 'auto') {
          // The traceback item already resolves saved-vs-recheck, so the
          // exported score can never disagree with the review screen or the PDF
          // row verdicts.
          row[`score:${descriptor.id}`] = toOptionalNumber(
            fallbackItem?.awardedScore ?? scoredResult?.awardedScore,
          );
          if (fallbackItem?.selectionScores) {
            row[`selectionScores:${descriptor.id}`] = fallbackItem.selectionScores;
            row[`selectionAnswers:${descriptor.id}`] = fallbackItem.selectionAnswers ?? [];
            row[`selectionCorrectAnswers:${descriptor.id}`] = fallbackItem.selectionCorrectAnswers ?? [];
          }
        } else {
          row[`manualCorrect:${descriptor.id}`] = '';
        }
        continue;
      }

      for (const descriptor of slot.descriptors) {
        row[`answer:${descriptor.id}`] = getStudentAnswerDisplay(
          descriptor,
          answerMap,
          answerDisplayOptions,
        );
        row[`rightAnswer:${descriptor.id}`] = getExportCorrectAnswerDisplay(
          descriptor,
          scoredResults.get(descriptor.id),
          answerDisplayOptions,
        );
        if (mode === 'manual') {
          row[`manualCorrect:${descriptor.id}`] = '';
        }
      }

      if (mode === 'auto') {
        // The representative traceback item owns the corrected group mark, so
        // exported rows, the export total and the PDF summary all agree. Blank
        // the cell when a member has neither a saved result nor a re-checked
        // item, matching the previous "incomplete group" behaviour.
        const representativeItem = tracebackItemsById.get(slot.representativeId);
        const allMembersKnown = slot.descriptors.every(
          (descriptor) => scoredResults.has(descriptor.id) || tracebackItemsById.has(descriptor.id),
        );
        row[`scoreGroup:${slot.slotKey}`] = !allMembersKnown
          || representativeItem?.awardedScore === null
          || representativeItem?.awardedScore === undefined
          ? ''
          : representativeItem.awardedScore;
      } else {
        row[`manualCorrectGroup:${slot.slotKey}`] = '';
      }
    }

    return row;
  });

  const baseColumns =
    mode === 'auto' ? OBJECTIVE_WIDE_EXPORT_BASE_COLUMNS : OBJECTIVE_WIDE_MANUAL_EXPORT_BASE_COLUMNS;
  const moduleBaseColumns =
    moduleType === 'science'
      ? baseColumns.map((column) =>
          column.key === 'ieltsCourse' ? { ...column, label: 'Course' } : column,
        )
      : baseColumns;
  const summaryColumns =
    mode === 'auto' && moduleType === 'science'
      ? [...ACT_SCIENCE_CATEGORY_QUESTION_COUNT_COLUMNS, ...ACT_SCIENCE_CATEGORY_CORRECT_COLUMNS]
      : [];
  const percentageColumns =
    mode === 'auto' && moduleType === 'science' ? ACT_SCIENCE_CATEGORY_PERCENTAGE_COLUMNS : [];
  const exportBaseColumns = moduleBaseColumns.flatMap((column) =>
    column.key === 'totalScore'
      ? [column, ...summaryColumns]
      : column.key === 'percentage'
        ? [column, ...percentageColumns]
        : [column],
  );

  return {
    columns: [
      ...exportBaseColumns,
      ...(mode === 'auto' ? [...answerColumns, ...rightAnswerColumns, ...scoreColumns] : manualQuestionColumns),
      ...(mode === 'auto' && moduleType !== 'science'
        ? [{ key: 'ieltsBandScore', label: 'IELTS Band Score' }]
        : []),
    ],
    rows,
  };
}

export function buildWritingExportRows(
  session: ExportSessionContext,
  submission: StudentSubmission,
  writingSubmissions: WritingTaskSubmission[],
): Array<Record<string, unknown>> {
  return writingSubmissions.map((task) => {
    const visibleAnnotations = task.annotations.filter((annotation) => annotation.visibility === 'student_visible');
    const rubric = task.rubricAssessment;

    return {
      examTitle: session.examTitle,
      sessionId: session.sessionId,
      scheduleId: submission.scheduleId,
      submissionId: submission.id,
      studentName: submission.studentName,
      studentId: submission.studentId,
      studentEmail: submission.studentEmail ?? '',
      cohortName: submission.cohortName,
      section: 'writing',
      taskId: task.taskId,
      taskLabel: task.taskLabel,
      prompt: task.prompt,
      studentText: task.studentText,
      wordCount: task.wordCount,
      taskResponseBand: rubric?.taskResponseBand ?? '',
      coherenceBand: rubric?.coherenceBand ?? '',
      lexicalBand: rubric?.lexicalBand ?? '',
      grammarBand: rubric?.grammarBand ?? '',
      overallBand: rubric?.overallBand ?? '',
      overallFeedback: task.overallFeedback ?? '',
      studentVisibleNotes: task.studentVisibleNotes ?? '',
      annotationCount: task.annotations.length,
      studentVisibleAnnotationCount: visibleAnnotations.length,
      gradingStatus: task.gradingStatus,
      submittedAt: task.submittedAt,
      gradedBy: task.gradedBy ?? '',
      gradedAt: task.gradedAt ?? '',
    };
  });
}

function getWritingTaskSlot(task: WritingTaskSubmission): 'task1' | 'task2' | null {
  const normalizedId = task.taskId.trim().toLowerCase();
  const normalizedLabel = task.taskLabel.trim().toLowerCase();

  if (normalizedId === 'task1' || normalizedId === 'task-1' || normalizedLabel === 'task 1') {
    return 'task1';
  }

  if (normalizedId === 'task2' || normalizedId === 'task-2' || normalizedLabel === 'task 2') {
    return 'task2';
  }

  return null;
}

function assignWritingTaskColumns(row: Record<string, unknown>, slot: 'task1' | 'task2', task?: WritingTaskSubmission) {
  if (!task) {
    for (const field of WRITING_WIDE_TASK_FIELDS) {
      row[`${slot}:${field.key}`] = '';
    }
    return;
  }

  const visibleAnnotations = task.annotations.filter((annotation) => annotation.visibility === 'student_visible');
  const rubric = task.rubricAssessment;

  row[`${slot}:wordCount`] = task.wordCount;
  row[`${slot}:response`] = htmlToPlainTextPreserveLineBreaks(task.studentText, task.responseFormat);
  row[`${slot}:taskResponseBand`] = rubric?.taskResponseBand ?? '';
  row[`${slot}:coherenceBand`] = rubric?.coherenceBand ?? '';
  row[`${slot}:lexicalBand`] = rubric?.lexicalBand ?? '';
  row[`${slot}:grammarBand`] = rubric?.grammarBand ?? '';
  row[`${slot}:overallBand`] = rubric?.overallBand ?? '';
  row[`${slot}:overallFeedback`] = task.overallFeedback ?? '';
  row[`${slot}:studentVisibleNotes`] = task.studentVisibleNotes ?? '';
  row[`${slot}:annotationCount`] = task.annotations.length;
  row[`${slot}:studentVisibleAnnotationCount`] = visibleAnnotations.length;
  row[`${slot}:gradingStatus`] = task.gradingStatus;
  row[`${slot}:gradedBy`] = task.gradedBy ?? '';
  row[`${slot}:gradedAt`] = task.gradedAt ?? '';
}

export function buildWideWritingExport({
  session,
  submissions,
  writingSubmissions,
}: WideWritingExportInput): WideWritingExport {
  const writingBySubmissionId = new Map(
    writingSubmissions.map((entry) => [entry.submissionId, entry.writing] as const),
  );

  const rows = submissions.map((submission) => {
    const tasks = writingBySubmissionId.get(submission.id) ?? [];
    const tasksBySlot = new Map<'task1' | 'task2', WritingTaskSubmission>();

    for (const task of tasks) {
      const slot = getWritingTaskSlot(task);
      if (slot && !tasksBySlot.has(slot)) {
        tasksBySlot.set(slot, task);
      }
    }

    const submittedAt =
      tasks.find((task) => task.submittedAt)?.submittedAt ?? submission.submittedAt;
    const row: Record<string, unknown> = {
      examTitle: session.examTitle,
      sessionId: session.sessionId,
      scheduleId: submission.scheduleId,
      submissionId: submission.id,
      studentName: submission.studentName,
      studentId: submission.studentId,
      studentEmail: submission.studentEmail ?? '',
      nickname: submission.nickname ?? '',
      ieltsCourse: submission.ieltsCourse ?? '',
      cohortName: submission.cohortName,
      section: 'writing',
      submittedAt,
    };

    assignWritingTaskColumns(row, 'task1', tasksBySlot.get('task1'));
    assignWritingTaskColumns(row, 'task2', tasksBySlot.get('task2'));

    return row;
  });

  return {
    columns: WRITING_WIDE_EXPORT_COLUMNS,
    rows,
  };
}

export function slugifyCsvFilePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildCsvFilename(
  examTitle: string,
  section: GradingExportSection,
  cohortName?: string | undefined,
  variant?: string | undefined,
): string {
  const parts = [examTitle, cohortName, section, variant, new Date().toISOString().slice(0, 10)]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .map(slugifyCsvFilePart);
  return `${parts.join('-') || 'grading-export'}.csv`;
}

export interface SavedScoreMismatch {
  questionId: string;
  savedCorrectness: boolean | null;
  savedAwardedScore: number | null;
  savedMaxScore: number | null;
  websiteCorrectness: boolean | null;
  websiteAwardedScore: number | null;
  websiteMaxScore: number | null;
  reasons: Array<'correctness' | 'awardedScore' | 'maxScore'>;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Website re-check of one saved section. This is the one recomputation the
 * review page and the overview warning must share: it owns grouped, pooled and
 * tree verdicts, so a surface can never re-derive a different answer.
 *
 * The saved result remains official; callers use this only to warn when the
 * snapshot the website re-checks disagrees with what was saved.
 */
export function scoreSectionForRecheck(
  examState: ExamState | null,
  sectionSubmission: SectionSubmission | null,
  moduleType: 'reading' | 'listening' | 'science',
): ObjectiveScoringResult | null {
  if (!examState || !sectionSubmission) return null;
  const descriptors = getStudentQuestionsForModule(examState, moduleType);
  const results = buildQuestionResultMap(sectionSubmission.autoGradingResults?.questionResults);
  if (results.size === 0) return null;
  const answerMap = mergePersistedResultAnswers(
    descriptors,
    extractObjectiveAnswerMap(sectionSubmission.answers),
    results,
  );
  return scoreObjectiveDescriptors(descriptors, answerMap);
}

/**
 * Compares the server's saved question results with the website's re-check.
 * The saved result stays official; this list only drives the "saved score is
 * out of date" warning and the client_server_mismatch log.
 */
export function findSavedScoreMismatches(
  examState: ExamState | null,
  sectionSubmission: SectionSubmission | null,
  moduleType: 'reading' | 'listening' | 'science',
): SavedScoreMismatch[] {
  if (!examState || !sectionSubmission) return [];
  const descriptors = getStudentQuestionsForModule(examState, moduleType);
  const results = buildQuestionResultMap(sectionSubmission.autoGradingResults?.questionResults);
  if (results.size === 0) return [];
  const websiteScoring = scoreSectionForRecheck(examState, sectionSubmission, moduleType);
  if (!websiteScoring) return [];
  const mismatches: SavedScoreMismatch[] = [];

  for (const descriptor of descriptors) {
    const saved = results.get(descriptor.id);
    if (!saved) continue;
    // A schedule answer-key override deliberately differs from the snapshot
    // the website re-checks; it is not an out-of-date saved score.
    if (saved.hasOverride === true) continue;
    // A per-student manual override is a deliberate human decision; the
    // website re-check cannot second-guess it, so it is not staleness either.
    if (saved.manualOverride) continue;
    const website = websiteScoring.byId.get(descriptor.id);
    const savedCorrectness = saved.isCorrect ?? null;
    const savedAwardedScore = numberOrNull(saved.awardedScore);
    const savedMaxScore = numberOrNull(saved.maxScore);
    const websiteCorrectness = website?.correctness ?? null;
    const websiteAwardedScore = website?.awardedScore ?? null;
    const websiteMaxScore = website?.maxScore ?? null;
    const reasons: SavedScoreMismatch['reasons'] = [];
    if (savedCorrectness !== websiteCorrectness) reasons.push('correctness');
    if (savedAwardedScore !== websiteAwardedScore) reasons.push('awardedScore');
    if (savedMaxScore !== websiteMaxScore) reasons.push('maxScore');
    if (reasons.length === 0) continue;
    mismatches.push({
      questionId: descriptor.id,
      savedCorrectness,
      savedAwardedScore,
      savedMaxScore,
      websiteCorrectness,
      websiteAwardedScore,
      websiteMaxScore,
      reasons,
    });
  }

  return mismatches;
}
