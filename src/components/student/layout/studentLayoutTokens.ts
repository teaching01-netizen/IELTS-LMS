export const STUDENT_LAYOUT_TOKENS = {
  headerHeight: {
    compact: 'var(--student-header-height-compact)',
    medium: 'var(--student-header-height-medium)',
    wide: 'var(--student-header-height-wide)',
  },
  bottomBarMinHeight: 'var(--student-bottom-bar-height)',
  touchTargetMin: 'var(--student-touch-target-min)',
  touchTargetPreferred: 'var(--student-touch-target-preferred)',
} as const;

export function getStudentLayoutModeClassName(
  layoutMode: keyof typeof STUDENT_LAYOUT_TOKENS.headerHeight,
): string {
  return `student-layout-${layoutMode}`;
}
