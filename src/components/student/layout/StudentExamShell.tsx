import type { CSSProperties, ReactNode } from 'react';
import type { StudentLayoutMode } from './studentLayoutMode';
import { getStudentLayoutModeClassName } from './studentLayoutTokens';

interface StudentExamShellProps {
  readonly children: ReactNode;
  readonly layoutMode: StudentLayoutMode;
  readonly highContrast?: boolean | undefined;
  readonly touchMode?: boolean | undefined;
  readonly style?: CSSProperties | undefined;
}

export function StudentExamShell({
  children,
  layoutMode,
  highContrast = false,
  touchMode = false,
  style,
}: StudentExamShellProps) {
  return (
    <div
      className={`student-exam-shell w-full min-h-0 bg-gray-50 font-sans text-gray-900 transition-all ${
        highContrast ? 'high-contrast' : ''
      } ${getStudentLayoutModeClassName(layoutMode)}`}
      data-student-layout-mode={layoutMode}
      data-student-touch-mode={touchMode ? 'true' : 'false'}
      data-testid="student-exam-shell"
      style={style}
    >
      {children}
    </div>
  );
}
