import type { ExamState } from '../../types';
import type {
  ObjectiveQuestionResult,
  SectionSubmission,
  StudentSubmission,
  WritingTaskSubmission,
} from '../../types/grading';
import {
  getQuestionNumberLabel,
  getStudentQuestionsForModule,
} from '../../services/examAdapterService';
import type { StudentQuestionDescriptor } from '../../services/examAdapterService';
import {
  extractObjectiveAnswerMap,
  getCorrectAnswerDisplay,
  getQuestionPrompt,
  getStudentAnswerDisplay,
  isStudentAnswerCorrect,
} from './gradingAnswerUtils';

export type GradingExportSection = 'reading' | 'listening' | 'writing';

export interface CsvColumn {
  key: string;
  label: string;
}

export interface ExportSessionContext {
  sessionId: string;
  examTitle: string;
}

export interface ObjectiveTracebackItem {
  numberLabel: string;
  questionId: string;
  prompt: string;
  studentAnswer: string;
  correctAnswer: string;
  correctness: boolean | null;
  awardedScore: number | null;
  maxScore: number | null;
  answerKey: string;
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
  { key: 'cohortName', label: 'Cohort Name' },
  { key: 'section', label: 'Section' },
  { key: 'submittedAt', label: 'Submitted At' },
  { key: 'totalScore', label: 'Total Score' },
  { key: 'maxScore', label: 'Max Score' },
  { key: 'percentage', label: 'Percentage' },
  { key: 'correctCount', label: 'Correct Count' },
];

export const WRITING_EXPORT_COLUMNS: CsvColumn[] = [
  { key: 'examTitle', label: 'Exam Title' },
  { key: 'sessionId', label: 'Session ID' },
  { key: 'scheduleId', label: 'Schedule ID' },
  { key: 'submissionId', label: 'Submission ID' },
  { key: 'studentName', label: 'Student Name' },
  { key: 'studentId', label: 'Student ID' },
  { key: 'studentEmail', label: 'Student Email' },
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

function buildQuestionResultMap(results: ObjectiveQuestionResult[] | undefined): Map<string, ObjectiveQuestionResult> {
  return new Map((results ?? []).map((result) => [result.questionId, result] as const));
}

function buildTracebackItem(
  descriptor: StudentQuestionDescriptor,
  descriptors: StudentQuestionDescriptor[],
  answerMap: Record<string, unknown>,
  results: Map<string, ObjectiveQuestionResult>,
): ObjectiveTracebackItem {
  const questionResult = results.get(descriptor.id);
  const computedCorrectness = isStudentAnswerCorrect(descriptor, answerMap);
  const correctness = questionResult?.isCorrect ?? computedCorrectness;
  const awardedScore =
    questionResult?.awardedScore ?? (computedCorrectness === null ? null : computedCorrectness ? 1 : 0);
  const maxScore = questionResult?.maxScore ?? (computedCorrectness === null ? null : 1);

  return {
    numberLabel: getQuestionNumberLabel(descriptors, descriptor.id),
    questionId: descriptor.id,
    prompt: getQuestionPrompt(descriptor),
    studentAnswer: getStudentAnswerDisplay(descriptor, answerMap),
    correctAnswer: getCorrectAnswerDisplay(descriptor),
    correctness,
    awardedScore,
    maxScore,
    answerKey: descriptor.answerKey,
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
  const results = buildQuestionResultMap(sectionSubmission.autoGradingResults?.questionResults);
  const groups = new Map<string, ObjectiveTracebackGroup>();

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
    const group = groups.get(groupId);
    if (!group) continue;
    group.items.push(buildTracebackItem(descriptor, descriptors, answerMap, results));
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
}

export interface WideObjectiveExport {
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
        cohortName: submission.cohortName,
        section: moduleType,
        groupLabel: group.groupLabel,
        questionNumber: item.numberLabel,
        questionId: item.questionId,
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
    (count, group) => count + group.items.filter((item) => item.correctness === true).length,
    0,
  );
}

export function buildWideObjectiveExport({
  session,
  submissions,
  sectionSubmissions,
  examState,
  moduleType,
}: WideObjectiveExportInput): WideObjectiveExport {
  const descriptors = examState ? getStudentQuestionsForModule(examState, moduleType) : [];
  const answerColumns = descriptors.map((descriptor) => {
    const label = getQuestionColumnLabel(descriptor, descriptors);
    return { key: `answer:${descriptor.id}`, label: `${label} Answer` };
  });
  const correctAnswerColumns = descriptors.map((descriptor) => {
    const label = getQuestionColumnLabel(descriptor, descriptors);
    return { key: `correct:${descriptor.id}`, label: `${label} Correct Answer` };
  });
  const scoreColumns = descriptors.map((descriptor) => {
    const label = getQuestionColumnLabel(descriptor, descriptors);
    return { key: `score:${descriptor.id}`, label: `${label} Score` };
  });
  const sectionBySubmissionId = new Map(
    sectionSubmissions.map((entry) => [entry.submissionId, entry.sectionSubmission] as const),
  );

  const rows = submissions.map((submission) => {
    const sectionSubmission = sectionBySubmissionId.get(submission.id) ?? null;
    const groups = buildQuestionTracebackGroups(examState, sectionSubmission, moduleType);
    const items = new Map(groups.flatMap((group) => group.items.map((item) => [item.questionId, item] as const)));
    const autoGradingResults = sectionSubmission?.autoGradingResults;
    const row: Record<string, unknown> = {
      examTitle: session.examTitle,
      sessionId: session.sessionId,
      scheduleId: submission.scheduleId,
      submissionId: submission.id,
      studentName: submission.studentName,
      studentId: submission.studentId,
      studentEmail: submission.studentEmail ?? '',
      cohortName: submission.cohortName,
      section: moduleType,
      submittedAt: sectionSubmission?.submittedAt ?? submission.submittedAt,
      totalScore: toOptionalNumber(autoGradingResults?.totalScore),
      maxScore: toOptionalNumber(autoGradingResults?.maxScore),
      percentage: toOptionalNumber(autoGradingResults?.percentage),
      correctCount: autoGradingResults?.questionResults
        ? autoGradingResults.questionResults.filter((result) => result.isCorrect).length
        : countCorrectAnswers(groups),
    };

    for (const descriptor of descriptors) {
      const item = items.get(descriptor.id);
      row[`answer:${descriptor.id}`] = item?.studentAnswer ?? '';
      row[`correct:${descriptor.id}`] = item?.correctAnswer ?? getCorrectAnswerDisplay(descriptor);
      row[`score:${descriptor.id}`] = toOptionalNumber(item?.awardedScore);
    }

    return row;
  });

  return {
    columns: [...OBJECTIVE_WIDE_EXPORT_BASE_COLUMNS, ...answerColumns, ...correctAnswerColumns, ...scoreColumns],
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
): string {
  const parts = [examTitle, cohortName, section, new Date().toISOString().slice(0, 10)]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .map(slugifyCsvFilePart);
  return `${parts.join('-') || 'grading-export'}.csv`;
}
