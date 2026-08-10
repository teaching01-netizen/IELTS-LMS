import type { GradingSession, StudentSubmission } from '../../../types/grading';
import type { PerStudentZipPdfExportSection, PerStudentZipPdfMode } from '../gradingPerStudentExport';

export type ExportGroupingField = 'course' | 'level' | 'cohort' | 'customGroup' | 'none';
export type ExportConditionField = 'course' | 'level' | 'cohort';
export type ExportReleaseStatus = 'draft' | 'ready_to_release' | 'released';

export interface ExportStudentIdentity {
  readonly studentId: string;
  readonly submissionId: string;
  readonly wcode: string | null;
  readonly nickname: string | null;
  readonly fullName: string;
  readonly level: string | null;
  readonly courseId: string | null;
  readonly courseName: string | null;
  readonly cohortId: string | null;
  readonly cohortName: string | null;
  readonly email: string | null;
  readonly examTitle: string | null;
}

export interface ExportStudentRecord {
  readonly submission: StudentSubmission;
  readonly identity: ExportStudentIdentity;
}

export interface ExportFilterState {
  readonly search: string;
  readonly courses: readonly string[];
  readonly levels: readonly string[];
  readonly cohorts: readonly string[];
  readonly gradingStatuses: readonly StudentSubmission['gradingStatus'][];
  readonly releaseStatuses: readonly ExportReleaseStatus[];
  readonly assignedTeacherIds: readonly string[];
  readonly flagged: boolean | null;
  readonly missingData: 'any' | 'complete_only' | 'missing_required' | 'missing_optional';
  readonly submittedFrom: string;
  readonly submittedTo: string;
}

export interface ExportGrouping {
  readonly field: ExportGroupingField;
}

export interface ExportCustomGroupCondition {
  readonly field: ExportConditionField;
  readonly operator: 'in';
  readonly values: readonly string[];
}

export interface ExportCustomGroup {
  readonly id: string;
  readonly name: string;
  readonly conditions: readonly ExportCustomGroupCondition[];
}

export interface ExportProfile {
  readonly id: string;
  readonly name: string;
  readonly outputType: 'pdf_zip' | 'csv' | 'xlsx';
  readonly sections: readonly PerStudentZipPdfExportSection[];
  readonly filters: ExportFilterState;
  readonly grouping: readonly ExportGrouping[];
  readonly customGroups: readonly ExportCustomGroup[];
  readonly filenameTemplate: string;
  readonly pdfMode: PerStudentZipPdfMode;
  readonly collisionStrategy: 'suffix';
  readonly version: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExportPlanOutput {
  readonly folderPath: readonly string[];
  readonly filename: string;
  readonly path: string;
  readonly section?: PerStudentZipPdfExportSection;
}

export interface PlannedStudentExport {
  readonly submissionId: string;
  readonly studentId: string;
  readonly identity: ExportStudentIdentity;
  readonly outputs: readonly ExportPlanOutput[];
}

export type ExportWarningCode =
  | 'missing_required_field'
  | 'missing_optional_field'
  | 'unknown_placeholder'
  | 'no_matches';

export interface ExportWarning {
  readonly code: ExportWarningCode;
  readonly message: string;
  readonly submissionIds: readonly string[];
}

export interface ExportConflict {
  readonly originalPath: string;
  readonly resolvedPath: string;
  readonly submissionIds: readonly string[];
}

export interface ExportPlan {
  readonly profileSnapshot: ExportProfile;
  readonly generatedAt: string;
  readonly matchedCount: number;
  readonly selectedCount: number;
  readonly folderCount: number;
  readonly pdfCount: number;
  readonly students: readonly PlannedStudentExport[];
  readonly folders: readonly string[];
  readonly warnings: readonly ExportWarning[];
  readonly conflicts: readonly ExportConflict[];
}

export interface BuildExportPlanInput {
  readonly session: Pick<GradingSession, 'id' | 'examTitle'> | { readonly sessionId: string; readonly examTitle: string };
  readonly students: readonly ExportStudentRecord[];
  readonly selectedSubmissionIds: readonly string[];
  readonly profile: ExportProfile;
  readonly generatedAt: Date;
}
