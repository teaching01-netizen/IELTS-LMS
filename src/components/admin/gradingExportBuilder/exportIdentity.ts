import type { StudentSubmission } from '../../../types/grading';
import {
  DEFAULT_PER_STUDENT_PDF_FILENAME_TEMPLATE,
} from '../gradingPerStudentPdfFilenameTemplate';
import type { ExportProfile, ExportStudentRecord } from './exportTypes';

export function createDefaultExportProfile(): ExportProfile {
  const now = new Date(0).toISOString();
  return {
    id: 'warwick-standard',
    name: 'Warwick standard export',
    outputType: 'pdf_zip',
    sections: ['reading', 'listening', 'writing'],
    filters: {
      search: '',
      courses: [],
      levels: [],
      cohorts: [],
      gradingStatuses: [],
      releaseStatuses: [],
      assignedTeacherIds: [],
      flagged: null,
      missingData: 'any',
      submittedFrom: '',
      submittedTo: '',
    },
    grouping: [{ field: 'course' }],
    customGroups: [],
    filenameTemplate: DEFAULT_PER_STUDENT_PDF_FILENAME_TEMPLATE,
    pdfMode: 'combined',
    collisionStrategy: 'suffix',
    version: 1,
    createdBy: 'system',
    createdAt: now,
    updatedAt: now,
  };
}

export function createExportStudentRecord(
  submission: StudentSubmission,
  examTitle: string,
): ExportStudentRecord {
  const rawStudentId = submission.studentId?.trim() || '';
  const studentId = rawStudentId || submission.submissionId;
  const courseName = submission.ieltsCourse?.trim() || null;
  const level = submission.level?.trim() || courseName;
  return {
    submission,
    identity: {
      studentId,
      submissionId: submission.id,
      wcode: rawStudentId || null,
      nickname: submission.nickname?.trim() || null,
      fullName: submission.studentName.trim(),
      // Keep level explicit; course is only the current-payload fallback.
      level,
      courseId: null,
      courseName,
      cohortId: null,
      cohortName: submission.cohortName?.trim() || null,
      email: submission.studentEmail?.trim() || null,
      examTitle,
    },
  };
}
