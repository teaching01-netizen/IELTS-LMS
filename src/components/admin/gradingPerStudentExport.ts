import { jsPDF } from 'jspdf';
import { strToU8, zipSync } from 'fflate';

import type { CsvColumn } from './gradingReviewUtils';
import type { WritingTaskSubmission } from '../../types/grading';
import { htmlToPlainTextPreserveLineBreaks } from '../../utils/htmlText';
import {
  DEFAULT_PER_STUDENT_PDF_FILENAME_TEMPLATE,
  renderPerStudentPdfFilenameTemplate,
  resolvePerStudentPdfFilenameCollisions,
} from './gradingPerStudentPdfFilenameTemplate';

export type PerStudentZipPdfExportSection = 'reading' | 'writing';

export interface PerStudentZipPdfSectionData {
  columns: CsvColumn[];
  /**
   * When null, the PDF must still be generated and display "No submission"
   * for this section.
   */
  row: Record<string, unknown> | null;
  writingTasks?: WritingTaskSubmission[] | undefined;
}

export interface PerStudentZipPdfStudentInput {
  submissionId: string;
  studentName: string;
  studentId: string;
  studentEmail?: string | null | undefined;
  sectionData: Partial<Record<PerStudentZipPdfExportSection, PerStudentZipPdfSectionData>>;
}

export interface PerStudentZipPdfExportInput {
  filenameBase: string;
  generatedAt: Date;
  sections: PerStudentZipPdfExportSection[];
  students: PerStudentZipPdfStudentInput[];
  pdfFilenameTemplate?: string | undefined;
  session?: { examTitle?: string | null | undefined; cohortName?: string | null | undefined; sessionId?: string | null | undefined } | undefined;
}

export interface PerStudentZipPdfExportManifestStudent {
  submissionId: string;
  studentId: string;
  studentName: string;
  filename: string;
  status: 'ok' | 'failed';
  error?: string | undefined;
}

export interface PerStudentZipPdfExportManifest {
  mode: 'per_student_zip_pdf';
  generatedAt: string;
  filename: string;
  sections: PerStudentZipPdfExportSection[];
  students: PerStudentZipPdfExportManifestStudent[];
}

export interface PerStudentZipPdfExportResult {
  filename: string;
  contentType: 'application/zip';
  bytes: Uint8Array;
  manifest: PerStudentZipPdfExportManifest;
}

function sanitizeFilenameSegment(value: string): string {
  return value
    .trim()
    .replace(/[\\/:"*?<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .slice(0, 120);
}

function formatSectionList(sections: PerStudentZipPdfExportSection[]): string {
  return [...sections].sort().join('-');
}

function toDisplayValue(value: unknown): string {
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

function writeWrappedText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottomMargin = 12;
  const topMargin = 14;

  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  let cursorY = y;

  for (const line of lines) {
    if (cursorY > pageHeight - bottomMargin) {
      doc.addPage();
      cursorY = topMargin;
    }
    doc.text(line, x, cursorY);
    cursorY += lineHeight;
  }

  return cursorY;
}

function buildStudentPdfBytes(
  student: PerStudentZipPdfStudentInput,
  sections: PerStudentZipPdfExportSection[],
  generatedAt: Date,
): Uint8Array {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const left = 14;
  const maxWidth = 180;
  let y = 14;

  doc.setFontSize(14);
  doc.text('Grading Export', left, y);
  y += 7;

  doc.setFontSize(10);
  y = writeWrappedText(
    doc,
    `Generated: ${generatedAt.toISOString()}`,
    left,
    y,
    maxWidth,
    5,
  );
  y += 2;
  y = writeWrappedText(doc, `Student: ${student.studentName}`, left, y, maxWidth, 5);
  y = writeWrappedText(doc, `Student ID: ${student.studentId}`, left, y, maxWidth, 5);
  y = writeWrappedText(doc, `Submission ID: ${student.submissionId}`, left, y, maxWidth, 5);
  y += 4;

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    const data = student.sectionData[section];
    if (section === 'writing' && data?.writingTasks) {
      // Match the default "Print all writing" export feel by starting writing on a new page
      // when the PDF already contains other sections.
      if (sectionIndex > 0) {
        doc.addPage();
        y = 14;
      }
      y = renderWritingLikeDefaultPrint(
        doc,
        {
          studentName: student.studentName,
          studentId: student.studentId,
          submissionId: student.submissionId,
        },
        data.writingTasks,
        y,
      );
      continue;
    }

    doc.setFontSize(12);
    doc.text(section.toUpperCase(), left, y);
    y += 6;
    doc.setFontSize(9);

    if (!data || data.row === null) {
      y = writeWrappedText(doc, 'No submission', left, y, maxWidth, 4.5);
      y += 3;
      continue;
    }

    const row = data.row;
    for (const column of data.columns) {
      const raw = row[column.key];
      const value = toDisplayValue(raw);
      const label = column.label.trim();
      const line = `${label}: ${value}`;
      y = writeWrappedText(doc, line, left, y, maxWidth, 4.5);
    }

    y += 4;
  }

  const arrayBuffer = doc.output('arraybuffer') as ArrayBuffer;
  return new Uint8Array(arrayBuffer);
}

function formatSubmittedAt(value?: string): string {
  if (!value) return 'No submission';
  try {
    return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return value;
  }
}

function getWritingTaskSlot(task: Pick<WritingTaskSubmission, 'taskId' | 'taskLabel'>): 'task1' | 'task2' | null {
  const normalizedId = task.taskId.trim().toLowerCase();
  const normalizedLabel = task.taskLabel.trim().toLowerCase();

  if (normalizedId === 'task1' || normalizedId === 'task-1' || normalizedLabel === 'task 1') return 'task1';
  if (normalizedId === 'task2' || normalizedId === 'task-2' || normalizedLabel === 'task 2') return 'task2';
  return null;
}

function getTaskLabelForSlot(slot: 'task1' | 'task2') {
  return slot === 'task1' ? 'Task 1' : 'Task 2';
}

function getAssessmentRows(task: WritingTaskSubmission | null) {
  return [
    {
      criterion: 'Task Response / Achievement',
      band: task?.rubricAssessment?.taskResponseBand,
      notes: task?.rubricAssessment?.taskResponseNotes,
    },
    {
      criterion: 'Coherence and Cohesion',
      band: task?.rubricAssessment?.coherenceBand,
      notes: task?.rubricAssessment?.coherenceNotes,
    },
    {
      criterion: 'Lexical Resource',
      band: task?.rubricAssessment?.lexicalBand,
      notes: task?.rubricAssessment?.lexicalNotes,
    },
    {
      criterion: 'Grammatical Range and Accuracy',
      band: task?.rubricAssessment?.grammarBand,
      notes: task?.rubricAssessment?.grammarNotes,
    },
    {
      criterion: 'Overall Band',
      band: task?.rubricAssessment?.overallBand,
      notes: task?.overallFeedback || task?.studentVisibleNotes || task?.rubricAssessment?.internalNotes,
    },
  ];
}

function renderWritingLikeDefaultPrint(
  doc: jsPDF,
  student: { studentName: string; studentId: string; submissionId: string },
  writingTasks: WritingTaskSubmission[],
  startY: number,
): number {
  const left = 14;
  const maxWidth = 180;
  const lineHeight = 4.6;
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottomMargin = 12;
  const topMargin = 14;

  const tasksBySlot = new Map<'task1' | 'task2', WritingTaskSubmission>();
  for (const task of writingTasks) {
    const slot = getWritingTaskSlot(task);
    if (slot && !tasksBySlot.has(slot)) {
      tasksBySlot.set(slot, task);
    }
  }

  let y = startY;

  const slots = ['task1', 'task2'] as const;
  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    const slot = slots[slotIndex];
    const task = tasksBySlot.get(slot) ?? null;

    // Start each task on a fresh page if we are too low.
    if (y > pageHeight - 60) {
      doc.addPage();
      y = topMargin;
    }

    // Header
    doc.setFontSize(16);
    doc.text(student.studentName, left, y);
    y += 7;

    doc.setFontSize(10);
    y = writeWrappedText(doc, `Student ID: ${student.studentId}`, left, y, maxWidth, 5);
    y = writeWrappedText(doc, `Task: ${getTaskLabelForSlot(slot)}`, left, y, maxWidth, 5);
    y = writeWrappedText(doc, `Submitted: ${formatSubmittedAt(task?.submittedAt)}`, left, y, maxWidth, 5);
    y += 4;

    doc.setFontSize(12);
    doc.text(getTaskLabelForSlot(slot), left, y);
    y += 6;
    doc.setFontSize(10);
    y = writeWrappedText(doc, `Word count: ${task?.wordCount ?? 0}`, left, y, maxWidth, 5);
    y += 3;

    // Prompt
    doc.setFontSize(11);
    doc.text('Prompt', left, y);
    y += 5;
    doc.setFontSize(9);
    const promptText = task ? htmlToPlainTextPreserveLineBreaks(task.prompt) : 'Prompt unavailable.';
    y = writeWrappedText(doc, promptText || 'Prompt unavailable.', left, y, maxWidth, lineHeight);
    y += 3;

    // Response
    doc.setFontSize(11);
    doc.text('Student Response', left, y);
    y += 5;
    doc.setFontSize(9);
    const responseText = task ? htmlToPlainTextPreserveLineBreaks(task.studentText) : '';
    y = writeWrappedText(doc, responseText || 'No submission', left, y, maxWidth, lineHeight);
    y += 4;

    // Assessment table
    doc.setFontSize(11);
    doc.text('Assessment Form', left, y);
    y += 5;
    doc.setFontSize(9);

    const colCriterion = 60;
    const colBand = 18;
    const colComments = maxWidth - colCriterion - colBand;
    const drawTableHeader = (headerY: number) => {
      doc.setFontSize(9);
      doc.text('Criterion', left + 1, headerY);
      doc.text('Band', left + colCriterion + 1, headerY);
      doc.text('Comments', left + colCriterion + colBand + 1, headerY);
    };

    drawTableHeader(y);
    y += 4.5;

    for (const row of getAssessmentRows(task)) {
      const criterion = row.criterion;
      const band = row.band === null || row.band === undefined ? '' : String(row.band);
      const comments = row.notes || '';

      const criterionLines = doc.splitTextToSize(criterion, colCriterion - 2) as string[];
      const commentsLines = doc.splitTextToSize(comments, colComments - 2) as string[];
      const bandLines = doc.splitTextToSize(band, colBand - 2) as string[];
      const rowLines = Math.max(criterionLines.length, commentsLines.length, bandLines.length, 1);
      const rowHeight = rowLines * lineHeight + 1.5;

      if (y + rowHeight > pageHeight - bottomMargin) {
        doc.addPage();
        y = topMargin;
        doc.setFontSize(11);
        doc.text('Assessment Form (cont.)', left, y);
        y += 5;
        doc.setFontSize(9);
        drawTableHeader(y);
        y += 4.5;
      }

      for (let i = 0; i < rowLines; i += 1) {
        const lineY = y + i * lineHeight;
        if (criterionLines[i]) doc.text(String(criterionLines[i]), left + 1, lineY);
        if (bandLines[i]) doc.text(String(bandLines[i]), left + colCriterion + 1, lineY);
        if (commentsLines[i]) doc.text(String(commentsLines[i]), left + colCriterion + colBand + 1, lineY);
      }

      y += rowHeight;
    }

    // Next task starts on a new page, to match the print-per-task feel.
    if (slotIndex < slots.length - 1) {
      doc.addPage();
      y = topMargin;
    }
  }

  return y;
}

export async function createPerStudentZipPdfExport(
  input: PerStudentZipPdfExportInput,
): Promise<PerStudentZipPdfExportResult> {
  const sections = (['reading', 'writing'] as const).filter((section) =>
    input.sections.includes(section),
  );
  const sectionSuffix = formatSectionList(sections);
  const base = sanitizeFilenameSegment(input.filenameBase) || 'grading-export';
  const zipFilename = `${base}-${input.generatedAt.toISOString().slice(0, 10)}.zip`;

  const files: Record<string, Uint8Array> = {};
  const manifestStudents: PerStudentZipPdfExportManifestStudent[] = [];

  const template = (input.pdfFilenameTemplate || '').trim() || DEFAULT_PER_STUDENT_PDF_FILENAME_TEMPLATE;
  const desiredPdfFilenames = input.students.map((student) =>
    renderPerStudentPdfFilenameTemplate(template, {
      studentName: student.studentName,
      studentId: student.studentId,
      studentEmail: student.studentEmail,
      submissionId: student.submissionId,
      examTitle: input.session?.examTitle,
      cohortName: input.session?.cohortName,
      sessionId: input.session?.sessionId,
      sections,
      generatedAt: input.generatedAt,
    }).filename,
  );
  const { filenames: pdfFilenames } = resolvePerStudentPdfFilenameCollisions(desiredPdfFilenames);

  for (let i = 0; i < input.students.length; i += 1) {
    const student = input.students[i];
    const pdfFilename = pdfFilenames[i] ?? `student_${i + 1}_${sectionSuffix}.pdf`;

    try {
      const pdfBytes = buildStudentPdfBytes(student, sections, input.generatedAt);
      files[pdfFilename] = pdfBytes;
      manifestStudents.push({
        submissionId: student.submissionId,
        studentId: student.studentId,
        studentName: student.studentName,
        filename: pdfFilename,
        status: 'ok',
      });
    } catch (error) {
      manifestStudents.push({
        submissionId: student.submissionId,
        studentId: student.studentId,
        studentName: student.studentName,
        filename: pdfFilename,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  const manifest: PerStudentZipPdfExportManifest = {
    mode: 'per_student_zip_pdf',
    generatedAt: input.generatedAt.toISOString(),
    filename: zipFilename,
    sections,
    students: manifestStudents,
  };

  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));

  // PDFs are already compressed; avoid wasting CPU on recompressing.
  const bytes = zipSync(files, { level: 0 });

  return {
    filename: zipFilename,
    contentType: 'application/zip',
    bytes,
    manifest,
  };
}
