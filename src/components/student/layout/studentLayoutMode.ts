// S1-C1: compact is the phone-width shell, while tablet widths use the
// two-pane medium layout expected by the viewport acceptance matrix. The
// tablet resizer is touch-positioned on coarse-pointer devices and the
// desktop resizer remains available at the lg breakpoint for fine pointers.
export const STUDENT_LAYOUT_BREAKPOINTS = {
  compactMaxWidth: 768,
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
