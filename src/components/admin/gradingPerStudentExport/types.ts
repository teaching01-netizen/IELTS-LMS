import type { CsvColumn } from '../gradingReviewUtils';
import type { WritingTaskSubmission } from '../../../types/grading';

export type PerStudentZipPdfExportSection = 'reading' | 'listening' | 'writing';

export type PerStudentZipPdfMode = 'combined' | 'separate' | 'bySection';

export interface PerStudentZipPdfPlannedOutput {
  folderPath: readonly string[];
  filename: string;
  path: string;
  section?: PerStudentZipPdfExportSection | undefined;
}

export interface PerStudentZipPdfPlanSnapshot {
  profile: {
    id: string;
    name: string;
    version: number;
  };
  grouping: readonly string[];
  filenameTemplate: string;
  matchedCount: number;
  selectedCount: number;
  folderCount: number;
  pdfCount: number;
  warnings: readonly {
    code: string;
    message: string;
    submissionIds: readonly string[];
  }[];
  conflicts: readonly {
    originalPath: string;
    resolvedPath: string;
    submissionIds: readonly string[];
  }[];
}

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
  wcode?: string | null | undefined;
  level?: string | null | undefined;
  sectionData: Partial<Record<PerStudentZipPdfExportSection, PerStudentZipPdfSectionData>>;
  plannedOutputs?: readonly PerStudentZipPdfPlannedOutput[] | undefined;
}

export interface PerStudentZipPdfExportInput {
  filenameBase: string;
  generatedAt: Date;
  sections: PerStudentZipPdfExportSection[];
  students: PerStudentZipPdfStudentInput[];
  pdfFilenameTemplate?: string | undefined;
  pdfMode?: PerStudentZipPdfMode | undefined;
  plan?: PerStudentZipPdfPlanSnapshot | undefined;
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
  wcode?: string | undefined;
  level?: string | undefined;
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
  plan?: PerStudentZipPdfPlanSnapshot | undefined;
  files?: readonly string[] | undefined;
}

export interface PerStudentZipPdfExportResult {
  filename: string;
  contentType: 'application/zip';
  bytes: Uint8Array;
  manifest: PerStudentZipPdfExportManifest;
}
