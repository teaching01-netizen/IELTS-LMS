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
    rootFontSize: 'clamp(15.25px, 0.95rem + 0.14vw, 16.75px)',
    lineHeight: 1.64,
    fontScale: 0.92,
    controlFontSize: 'clamp(0.9rem, 0.87rem + 0.08vw, 0.98rem)',
    chipFontSize: 'clamp(0.82rem, 0.79rem + 0.08vw, 0.9rem)',
    metaFontSize: 'clamp(0.76rem, 0.74rem + 0.05vw, 0.82rem)',
    previewFontSize: 'clamp(0.98rem, 0.96rem + 0.08vw, 1.04rem)',
  },
  normal: {
    rootFontSize: 'clamp(16.5px, 1.03rem + 0.18vw, 18.25px)',
    lineHeight: 1.72,
    fontScale: 1,
    controlFontSize: 'clamp(0.98rem, 0.95rem + 0.08vw, 1.05rem)',
    chipFontSize: 'clamp(0.88rem, 0.85rem + 0.08vw, 0.96rem)',
    metaFontSize: 'clamp(0.84rem, 0.82rem + 0.05vw, 0.9rem)',
    previewFontSize: 'clamp(1.03rem, 1rem + 0.08vw, 1.1rem)',
  },
  large: {
    rootFontSize: 'clamp(18.5px, 1.14rem + 0.22vw, 21px)',
    lineHeight: 1.82,
    fontScale: 1.16,
    controlFontSize: 'clamp(1.04rem, 1rem + 0.08vw, 1.14rem)',
    chipFontSize: 'clamp(0.96rem, 0.93rem + 0.08vw, 1.04rem)',
    metaFontSize: 'clamp(0.9rem, 0.88rem + 0.05vw, 0.98rem)',
    previewFontSize: 'clamp(1.12rem, 1.08rem + 0.08vw, 1.2rem)',
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
