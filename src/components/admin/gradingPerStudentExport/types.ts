import type { CsvColumn } from '../gradingReviewUtils';
import type { WritingTaskSubmission } from '../../../types/grading';

export type PerStudentZipPdfExportSection = 'reading' | 'listening' | 'writing';

export type PerStudentZipPdfMode = 'combined' | 'separate';

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
  nickname?: string | null | undefined;
  ieltsCourse?: string | null | undefined;
  sectionData: Partial<Record<PerStudentZipPdfExportSection, PerStudentZipPdfSectionData>>;
}

export interface PerStudentZipPdfExportInput {
  filenameBase: string;
  generatedAt: Date;
  sections: PerStudentZipPdfExportSection[];
  students: PerStudentZipPdfStudentInput[];
  pdfFilenameTemplate?: string | undefined;
  pdfMode?: PerStudentZipPdfMode | undefined;
  session?:
    | { examTitle?: string | null | undefined; cohortName?: string | null | undefined; sessionId?: string | null | undefined }
    | undefined;
}

export interface PerStudentZipPdfExportManifestStudent {
  submissionId: string;
  studentId: string;
  studentName: string;
  nickname?: string | undefined;
  ieltsCourse?: string | undefined;
  outputs: string[];
  filename: string;
  status: 'ok' | 'failed';
  error?: string | undefined;
}

export interface PerStudentZipPdfExportManifest {
  mode: 'per_student_zip_pdf';
  generatedAt: string;
  filename: string;
  sections: PerStudentZipPdfExportSection[];
  pdfMode: PerStudentZipPdfMode;
  students: PerStudentZipPdfExportManifestStudent[];
}

export interface PerStudentZipPdfExportResult {
  filename: string;
  contentType: 'application/zip';
  bytes: Uint8Array;
  manifest: PerStudentZipPdfExportManifest;
}

