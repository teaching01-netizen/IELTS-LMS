import type { PerStudentZipPdfExportSection } from '../gradingPerStudentExport';
import {
  renderPerStudentPdfFilenameTemplate,
  resolvePerStudentPdfFilenameCollisions,
} from '../gradingPerStudentPdfFilenameTemplate';
import { sanitizeFilenameSegment } from '../gradingPerStudentExport/filename';
import {
  filterExportStudents,
  hasOptionalIdentityData,
  hasRequiredIdentityData,
  normalize,
} from './exportFilters';
import type {
  BuildExportPlanInput,
  ExportConditionField,
  ExportConflict,
  ExportCustomGroup,
  ExportGrouping,
  ExportPlan,
  ExportProfile,
  ExportStudentRecord,
  PlannedStudentExport,
} from './exportTypes';

function sessionIdOf(session: BuildExportPlanInput['session']): string {
  return 'id' in session ? session.id : session.sessionId;
}

function conditionValue(record: ExportStudentRecord, field: ExportConditionField): string | null {
  if (field === 'course') return record.identity.courseName;
  if (field === 'level') return record.identity.level;
  return record.identity.cohortName;
}

function resolveCustomGroup(record: ExportStudentRecord, groups: readonly ExportCustomGroup[]): string {
  const matched = groups.find((group) => group.conditions.every((condition) => {
    const value = normalize(conditionValue(record, condition.field));
    return condition.operator === 'in' && condition.values.some((candidate) => normalize(candidate) === value);
  }));
  return matched?.name.trim() || 'Other';
}

function groupingSegment(record: ExportStudentRecord, grouping: ExportGrouping, customGroups: readonly ExportCustomGroup[]): string | null {
  if (grouping.field === 'none') return null;
  if (grouping.field === 'course') return record.identity.courseName || 'No course';
  if (grouping.field === 'level') return record.identity.level || 'No level';
  if (grouping.field === 'cohort') return record.identity.cohortName || 'No cohort';
  return resolveCustomGroup(record, customGroups);
}

function buildFolderPath(record: ExportStudentRecord, profile: ExportProfile): readonly string[] {
  return profile.grouping
    .map((grouping) => groupingSegment(record, grouping, profile.customGroups))
    .filter((segment): segment is string => Boolean(segment))
    .map((segment) => sanitizeFilenameSegment(segment) || 'Unlabelled');
}

function buildFilenameContext(
  record: ExportStudentRecord,
  input: BuildExportPlanInput,
  customGroup: string | null,
  section?: PerStudentZipPdfExportSection,
) {
  const { identity } = record;
  return {
    studentName: identity.fullName,
    fullName: identity.fullName,
    studentId: identity.studentId,
    wcode: identity.wcode ?? 'No Wcode',
    level: identity.level ?? 'No level',
    studentEmail: identity.email,
    nickname: identity.nickname ?? 'No nickname',
    ieltsCourse: identity.courseName,
    course: identity.courseName,
    cohort: identity.cohortName,
    cohortName: identity.cohortName,
    customGroup,
    submissionId: identity.submissionId,
    examTitle: input.session.examTitle,
    sessionId: sessionIdOf(input.session),
    sections: input.profile.sections,
    section,
    generatedAt: input.generatedAt,
  };
}

function joinOutputPath(folderPath: readonly string[], filename: string): string {
  return [...folderPath, filename].join('/');
}

function resolveFolderScopedFilenames(
  records: readonly ExportStudentRecord[],
  desiredFilenames: readonly string[],
  folderPaths: readonly (readonly string[])[],
): { filenames: string[]; conflicts: ExportConflict[] } {
  const indexesByFolder = new Map<string, number[]>();
  folderPaths.forEach((folderPath, index) => {
    const key = folderPath.join('/');
    indexesByFolder.set(key, [...(indexesByFolder.get(key) ?? []), index]);
  });
  const resolved = [...desiredFilenames];
  const conflicts: ExportConflict[] = [];
  indexesByFolder.forEach((indexes) => {
    const desired = indexes.map((index) => desiredFilenames[index] ?? 'student.pdf');
    const scoped = resolvePerStudentPdfFilenameCollisions(desired);
    indexes.forEach((index, scopedIndex) => {
      const originalFilename = desired[scopedIndex] ?? 'student.pdf';
      const resolvedFilename = scoped.filenames[scopedIndex] ?? originalFilename;
      resolved[index] = resolvedFilename;
      if (originalFilename !== resolvedFilename) {
        const duplicateIds = indexes
          .filter((candidateIndex) => desiredFilenames[candidateIndex] === originalFilename)
          .map((candidateIndex) => records[candidateIndex]?.identity.submissionId)
          .filter((value): value is string => Boolean(value));
        conflicts.push({
          originalPath: joinOutputPath(folderPaths[index] ?? [], originalFilename),
          resolvedPath: joinOutputPath(folderPaths[index] ?? [], resolvedFilename),
          submissionIds: duplicateIds,
        });
      }
    });
  });
  return { filenames: resolved, conflicts };
}

function buildWarnings(input: BuildExportPlanInput, selectedStudents: readonly ExportStudentRecord[], matchingCount: number) {
  const warnings = [] as ExportPlan['warnings'][number][];
  if (matchingCount === 0) warnings.push({ code: 'no_matches', message: 'No students match these filters.', submissionIds: [] });
  const missingRequired = selectedStudents.filter((record) => !hasRequiredIdentityData(record.identity));
  if (missingRequired.length > 0) {
    warnings.push({
      code: 'missing_required_field',
      message: `${missingRequired.length} selected student(s) are missing a Wcode or full name.`,
      submissionIds: missingRequired.map((record) => record.identity.submissionId),
    });
  }
  const missingOptional = selectedStudents.filter((record) => hasRequiredIdentityData(record.identity) && !hasOptionalIdentityData(record.identity));
  if (missingOptional.length > 0) {
    warnings.push({
      code: 'missing_optional_field',
      message: `${missingOptional.length} selected student(s) are missing nickname, level, course, or cohort data.`,
      submissionIds: missingOptional.map((record) => record.identity.submissionId),
    });
  }
  return warnings;
}

export function buildExportPlan(input: BuildExportPlanInput): ExportPlan {
  const matchingStudents = filterExportStudents(input.students, input.profile.filters);
  const selectedIds = new Set(input.selectedSubmissionIds);
  const selectedStudents = matchingStudents.filter((record) => selectedIds.has(record.identity.submissionId));
  const warnings = buildWarnings(input, selectedStudents, matchingStudents.length);
  const customGroupBySubmissionId = new Map(selectedStudents.map((record) => [
    record.identity.submissionId,
    resolveCustomGroup(record, input.profile.customGroups),
  ] as const));
  const baseFolderPaths = selectedStudents.map((record) => buildFolderPath(record, input.profile));
  const folderPaths = selectedStudents.map((record, index) => {
    const base = baseFolderPaths[index] ?? [];
    const studentFolder = sanitizeFilenameSegment(`${record.identity.fullName}_${record.identity.submissionId}`) || `student_${index + 1}`;
    return input.profile.pdfMode === 'separate' ? [...base, studentFolder] : base;
  });
  const combinedResults = selectedStudents.map((record) => renderPerStudentPdfFilenameTemplate(
    input.profile.filenameTemplate,
    buildFilenameContext(record, input, customGroupBySubmissionId.get(record.identity.submissionId) ?? null),
  ));
  const unknownPlaceholders = new Set(combinedResults.flatMap((result) => result.unknownPlaceholders));
  const conflicts: ExportConflict[] = [];
  const plannedStudents: PlannedStudentExport[] = [];
  if (input.profile.pdfMode === 'combined') {
    const desiredNames = combinedResults.map((result) => result.filename);
    const resolved = resolveFolderScopedFilenames(selectedStudents, desiredNames, folderPaths);
    conflicts.push(...resolved.conflicts);
    selectedStudents.forEach((record, index) => {
      const folderPath = folderPaths[index] ?? [];
      const filename = resolved.filenames[index] ?? desiredNames[index] ?? `student_${index + 1}.pdf`;
      plannedStudents.push({
        submissionId: record.identity.submissionId,
        studentId: record.identity.studentId,
        identity: record.identity,
        outputs: [{ folderPath, filename, path: joinOutputPath(folderPath, filename) }],
      });
    });
  } else if (input.profile.pdfMode === 'separate') {
    selectedStudents.forEach((record, studentIndex) => {
      const folderPath = folderPaths[studentIndex] ?? [];
      const desiredSections = input.profile.sections.map((section) => renderPerStudentPdfFilenameTemplate(
        input.profile.filenameTemplate,
        buildFilenameContext(record, input, customGroupBySubmissionId.get(record.identity.submissionId) ?? null, section),
      ));
      const resolved = resolvePerStudentPdfFilenameCollisions(desiredSections.map((result) => result.filename));
      input.profile.sections.forEach((section, sectionIndex) => {
        const originalFilename = desiredSections[sectionIndex]?.filename ?? `${section}.pdf`;
        const filename = resolved.filenames[sectionIndex] ?? originalFilename;
        if (filename !== originalFilename) conflicts.push({
          originalPath: joinOutputPath(folderPath, originalFilename),
          resolvedPath: joinOutputPath(folderPath, filename),
          submissionIds: [record.identity.submissionId],
        });
      });
      plannedStudents.push({
        submissionId: record.identity.submissionId,
        studentId: record.identity.studentId,
        identity: record.identity,
        outputs: input.profile.sections.map((section, sectionIndex) => {
          const filename = resolved.filenames[sectionIndex] ?? `${section}.pdf`;
          return { folderPath, filename, path: joinOutputPath(folderPath, filename), section };
        }),
      });
    });
  } else {
    // bySection: one folder per selected section (module), with that section's
    // PDF for every selected student inside. No per-student or grouping sub-folders.
    const sectionFolderPaths = input.profile.sections.map((section) => [sanitizeFilenameSegment(section) || section]);
    const desiredResultsBySection = input.profile.sections.map((section) =>
      selectedStudents.map((record) => renderPerStudentPdfFilenameTemplate(
        input.profile.filenameTemplate,
        buildFilenameContext(record, input, customGroupBySubmissionId.get(record.identity.submissionId) ?? null, section),
      )),
    );
    desiredResultsBySection.flatMap((results) => results).forEach((result) => {
      result.unknownPlaceholders.forEach((placeholder) => unknownPlaceholders.add(placeholder));
    });
    const resolvedNamesBySection = desiredResultsBySection.map((results) =>
      resolvePerStudentPdfFilenameCollisions(results.map((result) => result.filename)).filenames,
    );
    desiredResultsBySection.forEach((results, sectionIndex) => {
      const folderPath = sectionFolderPaths[sectionIndex] ?? [];
      const resolvedNames = resolvedNamesBySection[sectionIndex] ?? [];
      results.forEach((result, studentIndex) => {
        const originalFilename = result.filename;
        const filename = resolvedNames[studentIndex] ?? originalFilename;
        if (filename !== originalFilename) conflicts.push({
          originalPath: joinOutputPath(folderPath, originalFilename),
          resolvedPath: joinOutputPath(folderPath, filename),
          submissionIds: [selectedStudents[studentIndex]?.identity.submissionId ?? ''],
        });
      });
    });
    selectedStudents.forEach((record, studentIndex) => {
      plannedStudents.push({
        submissionId: record.identity.submissionId,
        studentId: record.identity.studentId,
        identity: record.identity,
        outputs: input.profile.sections.map((section, sectionIndex) => {
          const folderPath = sectionFolderPaths[sectionIndex] ?? [section];
          const filename = resolvedNamesBySection[sectionIndex]?.[studentIndex] ?? `${section}.pdf`;
          return { folderPath, filename, path: joinOutputPath(folderPath, filename), section };
        }),
      });
    });
  }
  if (unknownPlaceholders.size > 0) {
    warnings.push({
      code: 'unknown_placeholder',
      message: `Unknown filename placeholder(s): ${[...unknownPlaceholders].join(', ')}.`,
      submissionIds: selectedStudents.map((record) => record.identity.submissionId),
    });
  }
  const folders = [...new Set(plannedStudents.flatMap((student) => student.outputs
    .map((output) => output.folderPath.join('/')).filter((path) => path.length > 0)))];
  return {
    profileSnapshot: input.profile,
    generatedAt: input.generatedAt.toISOString(),
    matchedCount: matchingStudents.length,
    selectedCount: selectedStudents.length,
    folderCount: folders.length,
    pdfCount: plannedStudents.reduce((count, student) => count + student.outputs.length, 0),
    students: plannedStudents,
    folders,
    warnings,
    conflicts,
  };
}
