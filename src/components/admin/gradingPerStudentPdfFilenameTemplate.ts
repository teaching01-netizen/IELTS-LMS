import type { PerStudentZipPdfExportSection } from './gradingPerStudentExport';

export const DEFAULT_PER_STUDENT_PDF_FILENAME_TEMPLATE =
  '{{studentName}}_{{submissionId}}_{{sections}}.pdf';

export const PER_STUDENT_PDF_FILENAME_TEMPLATE_FIELDS = [
  { key: 'studentName', label: 'Student name' },
  { key: 'studentId', label: 'Student ID' },
  { key: 'studentEmail', label: 'Student email' },
  { key: 'submissionId', label: 'Submission ID' },
  { key: 'examTitle', label: 'Exam title' },
  { key: 'cohortName', label: 'Cohort name' },
  { key: 'sessionId', label: 'Session ID' },
  { key: 'sections', label: 'Sections' },
  { key: 'date', label: 'Date' },
  { key: 'timestamp', label: 'Timestamp' },
] as const;

export type PerStudentPdfFilenameTemplateFieldKey =
  (typeof PER_STUDENT_PDF_FILENAME_TEMPLATE_FIELDS)[number]['key'];

export interface PerStudentPdfFilenameTemplateContext {
  studentName: string;
  studentId: string;
  studentEmail?: string | null | undefined;
  submissionId: string;
  examTitle?: string | null | undefined;
  cohortName?: string | null | undefined;
  sessionId?: string | null | undefined;
  sections: PerStudentZipPdfExportSection[];
  generatedAt: Date;
}

export interface RenderPerStudentPdfFilenameResult {
  filename: string;
  unknownPlaceholders: string[];
}

const INVALID_FILENAME_CHARS = /[\\/:"*?<>|]+/g;

function formatDateLocal(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTimestampLocalSafe(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  const seconds = String(value.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}-${minutes}-${seconds}`;
}

function formatSections(sections: PerStudentZipPdfExportSection[]): string {
  return [...sections].sort().join('-');
}

function sanitizePdfFilename(rawFilename: string): string {
  const trimmed = rawFilename.trim();
  const hasPdfExtension = trimmed.toLowerCase().endsWith('.pdf');
  const filenameWithExt = hasPdfExtension ? trimmed : `${trimmed}.pdf`;
  const base = filenameWithExt.slice(0, -4);

  const sanitizedBase = base
    .replace(INVALID_FILENAME_CHARS, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[ .]+$/g, '');

  const effectiveBase = sanitizedBase || 'student';

  const MAX_LENGTH = 180;
  const extension = '.pdf';
  const maxBaseLength = Math.max(1, MAX_LENGTH - extension.length);
  const truncatedBase = effectiveBase.length > maxBaseLength ? effectiveBase.slice(0, maxBaseLength) : effectiveBase;

  return `${truncatedBase}${extension}`;
}

function applyUniquenessSuffix(filename: string, suffixNumber: number): string {
  if (suffixNumber <= 1) return filename;
  const lower = filename.toLowerCase();
  if (!lower.endsWith('.pdf')) return filename;
  const base = filename.slice(0, -4);
  return `${base} (${suffixNumber}).pdf`;
}

export function renderPerStudentPdfFilenameTemplate(
  template: string,
  context: PerStudentPdfFilenameTemplateContext,
): RenderPerStudentPdfFilenameResult {
  const unknown = new Set<string>();

  const resolved = template.replace(/{{\s*([^}]+)\s*}}/g, (match, rawKey: string) => {
    const key = rawKey.trim();
    const valueByKey: Record<PerStudentPdfFilenameTemplateFieldKey, string> = {
      studentName: context.studentName,
      studentId: context.studentId,
      studentEmail: context.studentEmail ?? '',
      submissionId: context.submissionId,
      examTitle: context.examTitle ?? '',
      cohortName: context.cohortName ?? '',
      sessionId: context.sessionId ?? '',
      sections: formatSections(context.sections),
      date: formatDateLocal(context.generatedAt),
      timestamp: formatTimestampLocalSafe(context.generatedAt),
    };

    if (Object.prototype.hasOwnProperty.call(valueByKey, key)) {
      return valueByKey[key as PerStudentPdfFilenameTemplateFieldKey];
    }

    unknown.add(key);
    return match;
  });

  return {
    filename: sanitizePdfFilename(resolved),
    unknownPlaceholders: [...unknown],
  };
}

export function resolvePerStudentPdfFilenameCollisions(
  desiredFilenames: string[],
): { filenames: string[]; collisionsResolved: number } {
  const used = new Map<string, number>();
  let collisionsResolved = 0;

  const filenames = desiredFilenames.map((original) => {
    const sanitized = sanitizePdfFilename(original);
    const currentCount = used.get(sanitized) ?? 0;
    const nextCount = currentCount + 1;
    used.set(sanitized, nextCount);

    if (nextCount === 1) return sanitized;
    collisionsResolved += 1;

    let attempt = applyUniquenessSuffix(sanitized, nextCount);
    while (used.has(attempt)) {
      const bumped = (used.get(attempt) ?? nextCount) + 1;
      attempt = applyUniquenessSuffix(sanitized, bumped);
    }
    used.set(attempt, 1);
    return attempt;
  });

  return { filenames, collisionsResolved };
}

