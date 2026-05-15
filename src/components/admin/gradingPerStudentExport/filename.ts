import type { PerStudentZipPdfExportSection } from './types';

export function sanitizeFilenameSegment(value: string): string {
  return value
    .trim()
    .replace(/[\\/:"*?<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\.+$/g, '')
    .slice(0, 120);
}

function applyUniquenessSuffix(name: string, suffixNumber: number): string {
  if (suffixNumber <= 1) return name;
  return `${name} (${suffixNumber})`;
}

export function resolveUniqueZipPathSegments(desired: string[]): string[] {
  const used = new Map<string, number>();
  return desired.map((raw) => {
    const sanitized = sanitizeFilenameSegment(raw) || 'student';
    const currentCount = used.get(sanitized) ?? 0;
    const nextCount = currentCount + 1;
    used.set(sanitized, nextCount);
    if (nextCount === 1) return sanitized;

    let attempt = applyUniquenessSuffix(sanitized, nextCount);
    while (used.has(attempt)) {
      const bumped = (used.get(attempt) ?? nextCount) + 1;
      attempt = applyUniquenessSuffix(sanitized, bumped);
    }
    used.set(attempt, 1);
    return attempt;
  });
}

export function formatSectionList(sections: PerStudentZipPdfExportSection[]): string {
  return [...sections].sort().join('-');
}

