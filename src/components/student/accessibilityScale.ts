export type StudentFontSize = 'small' | 'normal' | 'large';

export interface StudentTypographyScale {
  rootFontSize: string;
  lineHeight: number;
  fontScale: number;
  controlFontSize: string;
  chipFontSize: string;
  metaFontSize: string;
  previewFontSize: string;
}

const STUDENT_TYPOGRAPHY_SCALE: Record<StudentFontSize, StudentTypographyScale> = {
  small: {
    rootFontSize: 'clamp(15px, 0.94rem + 0.12vw, 16px)',
    lineHeight: 1.62,
    fontScale: 0.94,
    controlFontSize: 'clamp(0.88rem, 0.85rem + 0.08vw, 0.94rem)',
    chipFontSize: 'clamp(0.8rem, 0.77rem + 0.08vw, 0.86rem)',
    metaFontSize: 'clamp(0.74rem, 0.72rem + 0.05vw, 0.8rem)',
    previewFontSize: 'clamp(0.96rem, 0.94rem + 0.08vw, 1rem)',
  },
  normal: {
    rootFontSize: 'clamp(16px, 1rem + 0.14vw, 17.5px)',
    lineHeight: 1.68,
    fontScale: 1,
    controlFontSize: 'clamp(0.94rem, 0.91rem + 0.08vw, 1rem)',
    chipFontSize: 'clamp(0.86rem, 0.83rem + 0.08vw, 0.92rem)',
    metaFontSize: 'clamp(0.8rem, 0.78rem + 0.05vw, 0.86rem)',
    previewFontSize: 'clamp(1rem, 0.98rem + 0.08vw, 1.05rem)',
  },
  large: {
    rootFontSize: 'clamp(17.5px, 1.08rem + 0.16vw, 19.5px)',
    lineHeight: 1.74,
    fontScale: 1.12,
    controlFontSize: 'clamp(1rem, 0.97rem + 0.08vw, 1.08rem)',
    chipFontSize: 'clamp(0.92rem, 0.89rem + 0.08vw, 1rem)',
    metaFontSize: 'clamp(0.86rem, 0.84rem + 0.05vw, 0.92rem)',
    previewFontSize: 'clamp(1.06rem, 1.02rem + 0.08vw, 1.12rem)',
  },
};

const STUDENT_FONT_SIZE_LABELS: Record<StudentFontSize, string> = {
  small: 'Small',
  normal: 'Medium',
  large: 'Large',
};

export function getStudentTypographyScale(fontSize: StudentFontSize): StudentTypographyScale {
  return STUDENT_TYPOGRAPHY_SCALE[fontSize];
}

export function getStudentFontSizeLabel(fontSize: StudentFontSize): string {
  return STUDENT_FONT_SIZE_LABELS[fontSize];
}
