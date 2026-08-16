import type { ExamState, SentenceCompletionQuestion } from '../../types';
import type {
  ObjectiveManualOverride,
  ObjectiveQuestionResult,
  SectionSubmission,
  StudentSubmission,
  WritingTaskSubmission,
} from '../../types/grading';
import {
  getQuestionNumberLabel,
  getStudentQuestionsForModule,
} from '../../features/exam-authoring/infrastructure/examAuthoringGateway';
import type { StudentQuestionDescriptor } from '../../features/exam-authoring/infrastructure/examAuthoringGateway';
import {
  extractObjectiveAnswerMap,
  getCorrectAnswerDisplay,
  getMultiSelectAnswerScore,
  getQuestionPrompt,
  getStudentAnswerDisplay,
  isStudentAnswerCorrect,
  resolveSentenceCompletionCorrectness,
} from './gradingAnswerUtils';
import type { StudentAnswerValue } from '../../types/answers';
import { htmlToPlainText, htmlToPlainTextPreserveLineBreaks } from '../../utils/htmlText';

export type GradingExportSection =
  | 'reading'
  | 'listening'
  | 'reading_manual'
  | 'listening_manual'
  | 'writing';

export interface CsvColumn {
  key: string;
  label: string;
}

export interface ExportSessionContext {
  sessionId: string;
  examTitle: string;
}

export function resolveObjectiveGradingVersionId(
  publishedVersionId: string | undefined,
  draftVersionId: string | null | undefined,
): string | undefined {
  return draftVersionId || publishedVersionId;
}

export interface ObjectiveTracebackItem {
  numberLabel: string;
  questionId: string;
  prompt: string;
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

function getExportCorrectAnswerDisplay(
  descriptor: StudentQuestionDescriptor,
  questionResult: ObjectiveQuestionResult | undefined,
): string {
  if (questionResult?.hasOverride && questionResult.correctAnswer.trim() !== '') {
    return questionResult.correctAnswer;
  }

  return getCorrectAnswerDisplay(descriptor);
}

function getGroupedScoringSlotKey(descriptor: StudentQuestionDescriptor): string | null {
  if (typeof descriptor.rootId !== 'string') {
    return null;
  }
  // Only collapse slots explicitly marked as grouped scoring (e.g. 2-for-1),
  // not other uses of rootId such as the sub-answer tree.
  return descriptor.rootId.includes('::group::') ? descriptor.rootId : null;
}

function resolveGroupedScoringRequiredCorrect(groupQuestions: StudentQuestionDescriptor[]): number {
  const candidates: number[] = [];

  for (const question of groupQuestions) {
    if (
      question.block.type === 'SENTENCE_COMPLETION'
      && question.question
      && 'blanks' in question.question
      && question.answerIndex !== undefined
    ) {
      const blank = (question.question as SentenceCompletionQuestion).blanks[question.answerIndex];
      if (blank?.requiredCorrect !== undefined) {
        candidates.push(blank.requiredCorrect);
      }
      continue;
    }

    if (question.block.type === 'TABLE_COMPLETION' && question.answerIndex !== undefined) {
      const block = question.block as unknown as { cells?: Array<{ requiredCorrect?: number }> };
      const cell = Array.isArray(block.cells) ? block.cells[question.answerIndex] : undefined;
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

function getGroupedSlotLabel(descriptor: StudentQuestionDescriptor, index: number): string {
  const fallback = `Answer ${index + 1}`;

  if (descriptor.block.type === 'SENTENCE_COMPLETION') {
    return typeof descriptor.answerIndex === 'number' ? `Blank ${descriptor.answerIndex + 1}` : fallback;
  }

  if (descriptor.block.type === 'TABLE_COMPLETION') {
    return typeof descriptor.answerIndex === 'number' ? `Cell ${descriptor.answerIndex + 1}` : fallback;
  }

  return fallback;
}

function buildTracebackItem(
  descriptor: StudentQuestionDescriptor,
  descriptors: StudentQuestionDescriptor[],
  answerMap: Record<string, StudentAnswerValue | undefined>,
  results: Map<string, ObjectiveQuestionResult>,
  correctnessByDescriptor: Map<string, boolean | null>,
): ObjectiveTracebackItem {
  const questionResult = results.get(descriptor.id);
  const computedCorrectness = correctnessByDescriptor.has(descriptor.id)
    ? correctnessByDescriptor.get(descriptor.id) ?? null
    : isStudentAnswerCorrect(descriptor, answerMap);
  const fallbackScore = descriptor.block.type === 'MULTI_MCQ'
    ? getMultiSelectAnswerScore(descriptor, answerMap)
    : {
      awardedScore: computedCorrectness === null ? null : computedCorrectness ? 1 : 0,
      maxScore: computedCorrectness === null ? null : 1,
    };
  const useMultiSelectFallback =
    descriptor.block.type === 'MULTI_MCQ' && questionResult?.hasOverride !== true;
  const persistedCorrectness = questionResult?.hasOverride === true
    ? questionResult.isCorrect
    : computedCorrectness;
  const persistedAwardedScore = questionResult?.hasOverride === true
    ? questionResult.awardedScore
    : fallbackScore.awardedScore;
  const correctness = questionResult?.manualOverride?.isCorrect ?? (
    useMultiSelectFallback ? computedCorrectness : persistedCorrectness
  );
  const awardedScore = questionResult?.manualOverride?.awardedScore ?? (
    useMultiSelectFallback ? fallbackScore.awardedScore : persistedAwardedScore
  );
  const maxScore = useMultiSelectFallback
    ? fallbackScore.maxScore
    : questionResult?.maxScore ?? fallbackScore.maxScore;

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
  };
}

function buildGroupedTracebackItem(
  groupKey: string,
  groupDescriptors: StudentQuestionDescriptor[],
  allDescriptors: StudentQuestionDescriptor[],
  answerMap: Record<string, StudentAnswerValue | undefined>,
  results: Map<string, ObjectiveQuestionResult>,
  correctnessByDescriptor: Map<string, boolean | null>,
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

  const slotCorrectness = sorted.map((descriptor) => {
    const questionResult = results.get(descriptor.id);
    const computed = correctnessByDescriptor.has(descriptor.id)
      ? correctnessByDescriptor.get(descriptor.id) ?? null
      : isStudentAnswerCorrect(descriptor, answerMap);
    return questionResult?.manualOverride?.isCorrect ?? (
      questionResult?.hasOverride === true ? questionResult.isCorrect : computed
    );
  });
  const slotManualOverrides = sorted.map(
    (descriptor) => results.get(descriptor.id)?.manualOverride ?? null,
  );

  const requiredCorrect = resolveGroupedScoringRequiredCorrect(sorted);
  const correctSlots = slotCorrectness.filter((value) => value === true).length;
  const hasUnscored = slotCorrectness.some((value) => value === null);

  const correctness = hasUnscored ? null : correctSlots >= requiredCorrect;
  const awardedScore = correctness === null ? null : correctness ? 1 : 0;
  const maxScore = correctness === null ? null : 1;

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
  moduleType: 'reading' | 'listening',
): ObjectiveTracebackGroup[] {
  if (!examState || !sectionSubmission) {
    return [];
  }

  const descriptors = getStudentQuestionsForModule(examState, moduleType);
  const answerMap = extractObjectiveAnswerMap(sectionSubmission.answers);
  const correctnessByDescriptor = resolveSentenceCompletionCorrectness(descriptors, answerMap);
  const results = buildQuestionResultMap(sectionSubmission.autoGradingResults?.questionResults);
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
          buildGroupedTracebackItem(slotKey, slotDescriptors, descriptors, answerMap, results, correctnessByDescriptor),
        );
      } else {
        const descriptor = slotDescriptors[0];
        if (!descriptor) continue;
        group.items.push(buildTracebackItem(descriptor, descriptors, answerMap, results, correctnessByDescriptor));
      }
    }
  }

  return Array.from(groups.values());
}

export interface ObjectiveExportRowInput {
  session: ExportSessionContext;
  submission: StudentSubmission;
  sectionSubmission: SectionSubmission;
  examState: ExamState | null;
  moduleType: 'reading' | 'listening';
}

export interface WideObjectiveExportInput {
  session: ExportSessionContext;
  submissions: StudentSubmission[];
  sectionSubmissions: Array<{
    submissionId: string;
    sectionSubmission: SectionSubmission | null | undefined;
  }>;
  examState: ExamState | null;
  moduleType: 'reading' | 'listening';
  mode?: ObjectiveWideExportMode;
}

export interface WideObjectiveExport {
  columns: CsvColumn[];
  rows: Array<Record<string, unknown>>;
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
      rows.push({
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
        questionNumber: item.numberLabel,
        questionId: item.rootId ?? item.questionId,
        prompt: item.prompt,
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
        submittedAt: sectionSubmission.submittedAt,
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
  moduleType: 'reading' | 'listening',
): Record<number, number> | null {
  if (!examState) return null;

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

function deriveIeltsBandScore(
  examState: ExamState | null,
  moduleType: 'reading' | 'listening',
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
    const answerMap = sectionSubmission ? extractObjectiveAnswerMap(sectionSubmission.answers) : {};
    const autoGradingResults = sectionSubmission?.autoGradingResults;
    const derivedTotals = deriveObjectiveTotalsFromTracebackGroups(groups);
    const derivedTotalScore = derivedTotals.totalScore ?? autoGradingResults?.totalScore ?? null;
    const derivedMaxScore = derivedTotals.maxScore ?? autoGradingResults?.maxScore ?? null;
    const derivedPercentage = derivedTotals.percentage ?? autoGradingResults?.percentage ?? null;
    const scoredResults = buildQuestionResultMap(autoGradingResults?.questionResults);
    const tracebackItemsById = new Map(
      groups.flatMap((group) => group.items).map((item) => [item.questionId, item] as const),
    );
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
      totalScore: mode === 'manual' ? '' : toOptionalNumber(derivedTotalScore),
      maxScore: toOptionalNumber(derivedMaxScore),
      percentage: toOptionalNumber(derivedPercentage),
      correctCount: countCorrectAnswers(groups),
      ieltsBandScore: deriveIeltsBandScore(examState, moduleType, derivedTotalScore),
    };

    for (const slot of exportSlots) {
      if (!slot.isGrouped) {
        const descriptor = slot.descriptors[0];
        if (!descriptor) continue;
        const scoredResult = scoredResults.get(descriptor.id);
        const fallbackItem = tracebackItemsById.get(descriptor.id);
        row[`answer:${descriptor.id}`] = getStudentAnswerDisplay(descriptor, answerMap);
        row[`rightAnswer:${descriptor.id}`] = getExportCorrectAnswerDisplay(
          descriptor,
          scoredResult,
        );
        if (mode === 'auto') {
          row[`score:${descriptor.id}`] = toOptionalNumber(
            descriptor.block.type === 'MULTI_MCQ' && scoredResult?.hasOverride !== true
              ? fallbackItem?.awardedScore
              : scoredResult?.awardedScore,
          );
        } else {
          row[`manualCorrect:${descriptor.id}`] = '';
        }
        continue;
      }

      for (const descriptor of slot.descriptors) {
        row[`answer:${descriptor.id}`] = getStudentAnswerDisplay(descriptor, answerMap);
        row[`rightAnswer:${descriptor.id}`] = getExportCorrectAnswerDisplay(
          descriptor,
          scoredResults.get(descriptor.id),
        );
        if (mode === 'manual') {
          row[`manualCorrect:${descriptor.id}`] = '';
        }
      }

      if (mode === 'auto') {
        const groupResults = slot.descriptors.map((descriptor) => scoredResults.get(descriptor.id));
        if (groupResults.some((result) => !result)) {
          row[`scoreGroup:${slot.slotKey}`] = '';
        } else {
          const requiredCorrect = resolveGroupedScoringRequiredCorrect(slot.descriptors);
          const correctSlots = groupResults.filter((result) => result?.isCorrect).length;
          row[`scoreGroup:${slot.slotKey}`] = correctSlots >= requiredCorrect ? 1 : 0;
        }
      } else {
        row[`manualCorrectGroup:${slot.slotKey}`] = '';
      }
    }

    return row;
  });

  return {
    columns: [
      ...(mode === 'auto'
        ? OBJECTIVE_WIDE_EXPORT_BASE_COLUMNS
        : OBJECTIVE_WIDE_MANUAL_EXPORT_BASE_COLUMNS),
      ...(mode === 'auto' ? [...answerColumns, ...rightAnswerColumns, ...scoreColumns] : manualQuestionColumns),
      ...(mode === 'auto' ? [{ key: 'ieltsBandScore', label: 'IELTS Band Score' }] : []),
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
  row[`${slot}:response`] = htmlToPlainTextPreserveLineBreaks(task.studentText);
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
