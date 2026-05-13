import { jsPDF } from 'jspdf';
import { strToU8, zipSync } from 'fflate';

import type { CsvColumn } from './gradingReviewUtils';

export type PerStudentZipPdfExportSection = 'reading' | 'writing';

export interface PerStudentZipPdfSectionData {
  columns: CsvColumn[];
  /**
   * When null, the PDF must still be generated and display "No submission"
   * for this section.
   */
  row: Record<string, unknown> | null;
}

export interface PerStudentZipPdfStudentInput {
  submissionId: string;
  studentName: string;
  studentId: string;
  sectionData: Partial<Record<PerStudentZipPdfExportSection, PerStudentZipPdfSectionData>>;
}

export interface PerStudentZipPdfExportInput {
  filenameBase: string;
  generatedAt: Date;
  sections: PerStudentZipPdfExportSection[];
  students: PerStudentZipPdfStudentInput[];
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

  for (const section of sections) {
    const data = student.sectionData[section];
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

export async function createPerStudentZipPdfExport(
  input: PerStudentZipPdfExportInput,
): Promise<PerStudentZipPdfExportResult> {
  const sections = [...input.sections];
  const sectionSuffix = formatSectionList(sections);
  const base = sanitizeFilenameSegment(input.filenameBase) || 'grading-export';
  const zipFilename = `${base}-${input.generatedAt.toISOString().slice(0, 10)}.zip`;

  const files: Record<string, Uint8Array> = {};
  const manifestStudents: PerStudentZipPdfExportManifestStudent[] = [];

  for (const student of input.students) {
    const studentName = sanitizeFilenameSegment(student.studentName) || 'student';
    const submissionId = sanitizeFilenameSegment(student.submissionId) || 'submission';
    const pdfFilename = `${studentName}_${submissionId}_${sectionSuffix}.pdf`;

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

