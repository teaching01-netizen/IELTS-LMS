export const STUDENT_LAYOUT_TOKENS = {
  headerHeight: {
    compact: '3.5rem',
    medium: '4rem',
    wide: '4rem',
  },
  bottomBarMinHeight: '3.5rem',
  touchTargetMin: '2.75rem',
  touchTargetPreferred: '3rem',
} as const;

export function getStudentLayoutModeClassName(
  layoutMode: keyof typeof STUDENT_LAYOUT_TOKENS.headerHeight,
): string {
  return `student-layout-${layoutMode}`;
}
