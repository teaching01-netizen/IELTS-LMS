import type { CSSProperties, ReactNode } from 'react';
import type { StudentLayoutMode } from './studentLayoutMode';
import { getStudentLayoutModeClassName } from './studentLayoutTokens';

interface StudentExamShellProps {
  readonly children: ReactNode;
  readonly layoutMode: StudentLayoutMode;
  readonly highContrast?: boolean | undefined;
  readonly touchMode?: boolean | undefined;
  readonly style?: CSSProperties | undefined;
  /** True while the software keyboard is inferred to be open. */
  readonly keyboardOpen?: boolean | undefined;
  /** Stable exam height in px; null lets the CSS `100dvh` fallback apply. */
  readonly examHeight?: number | null | undefined;
}

export function StudentExamShell({
  children,
  layoutMode,
  highContrast = false,
  touchMode = false,
  style,
  keyboardOpen = false,
  examHeight = null,
}: StudentExamShellProps) {
  const shellStyle: CSSProperties | undefined =
    style === undefined && (examHeight === null || !Number.isFinite(examHeight))
      ? undefined
      : {
          ...(style ?? {}),
          ...(examHeight !== null && Number.isFinite(examHeight)
            ? ({ ['--student-exam-height' as string]: `${examHeight}px` } as CSSProperties)
            : null),
        };

  return (
    <div
      className={`student-exam-shell w-full min-h-0 bg-exam-canvas font-sans text-foreground transition-all ${
        highContrast ? 'high-contrast' : ''
      } ${getStudentLayoutModeClassName(layoutMode)}`}
      data-student-layout-mode={layoutMode}
      data-student-touch-mode={touchMode ? 'true' : 'false'}
      data-student-keyboard-open={keyboardOpen ? 'true' : 'false'}
      data-testid="student-exam-shell"
      style={shellStyle}
    >
      {children}
    </div>
  );
}
