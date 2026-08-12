export const STUDENT_LAYOUT_BREAKPOINTS = {
  compactMaxWidth: 700,
  wideMinWidth: 1200,
} as const;

export type StudentLayoutMode = 'compact' | 'medium' | 'wide';

export function getStudentLayoutMode(width: number): StudentLayoutMode {
  if (!Number.isFinite(width) || width < STUDENT_LAYOUT_BREAKPOINTS.compactMaxWidth) {
    return 'compact';
  }

  if (width < STUDENT_LAYOUT_BREAKPOINTS.wideMinWidth) {
    return 'medium';
  }

  return 'wide';
}
