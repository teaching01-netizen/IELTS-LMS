import type { StudentSubmission } from '../../../types/grading';
import type {
  ExportFilterState,
  ExportReleaseStatus,
  ExportStudentIdentity,
  ExportStudentRecord,
} from './exportTypes';

const RELEASE_STATUS_BY_GRADING_STATUS: Record<StudentSubmission['gradingStatus'], ExportReleaseStatus> = {
  not_submitted: 'draft',
  submitted: 'draft',
  in_progress: 'draft',
  grading_complete: 'ready_to_release',
  ready_to_release: 'ready_to_release',
  released: 'released',
  reopened: 'draft',
};

export const normalize = (value: string | null | undefined): string => value?.trim().toLowerCase() ?? '';

export function hasRequiredIdentityData(identity: ExportStudentIdentity): boolean {
  return identity.fullName.trim().length > 0 && Boolean(identity.wcode?.trim());
}

export function hasOptionalIdentityData(identity: ExportStudentIdentity): boolean {
  return Boolean(
    identity.nickname?.trim() &&
      identity.level?.trim() &&
      identity.courseName?.trim() &&
      identity.cohortName?.trim(),
  );
}

function matchesSelectedValue(selected: readonly string[], value: string | null): boolean {
  if (selected.length === 0) return true;
  const normalizedValue = normalize(value);
  return normalizedValue.length > 0 && selected.some((candidate) => normalize(candidate) === normalizedValue);
}

function searchText(record: ExportStudentRecord): string {
  const { identity } = record;
  return [
    identity.fullName,
    identity.nickname,
    identity.wcode,
    identity.studentId,
    identity.email,
    identity.courseName,
    identity.level,
    identity.cohortName,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();
}

export function filterExportStudents(
  students: readonly ExportStudentRecord[],
  filters: ExportFilterState,
): readonly ExportStudentRecord[] {
  const query = normalize(filters.search);
  return students.filter((record) => {
    const { identity, submission } = record;
    const submittedDate = submission.submittedAt.slice(0, 10);
    if (query && !searchText(record).includes(query)) return false;
    if (!matchesSelectedValue(filters.courses, identity.courseName)) return false;
    if (!matchesSelectedValue(filters.levels, identity.level)) return false;
    if (!matchesSelectedValue(filters.cohorts, identity.cohortName)) return false;
    if (filters.gradingStatuses.length > 0 && !filters.gradingStatuses.includes(submission.gradingStatus)) return false;
    if (
      filters.releaseStatuses.length > 0 &&
      !filters.releaseStatuses.includes(RELEASE_STATUS_BY_GRADING_STATUS[submission.gradingStatus])
    ) return false;
    if (
      filters.assignedTeacherIds.length > 0 &&
      (!submission.assignedTeacherId || !filters.assignedTeacherIds.includes(submission.assignedTeacherId))
    ) return false;
    if (filters.flagged !== null && submission.isFlagged !== filters.flagged) return false;
    if (filters.submittedFrom && submittedDate < filters.submittedFrom) return false;
    if (filters.submittedTo && submittedDate > filters.submittedTo) return false;
    if (filters.missingData === 'complete_only') return hasRequiredIdentityData(identity) && hasOptionalIdentityData(identity);
    if (filters.missingData === 'missing_required') return !hasRequiredIdentityData(identity);
    if (filters.missingData === 'missing_optional') return hasRequiredIdentityData(identity) && !hasOptionalIdentityData(identity);
    return true;
  });
}
