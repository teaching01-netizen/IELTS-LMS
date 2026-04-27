export type StudentFontSize = 'small' | 'normal' | 'large';

export interface StudentTypographyScale {
  rootFontSize: string;
  lineHeight: number;
  fontScale: number;
  controlFontSize: string;
  chipFontSize: string;
  metaFontSize: string;
  previewFontSize: string;
  passageFontSize: string;
  passageTitleFontSize: string;
  passageH1FontSize: string;
  passageH2FontSize: string;
  passageH3FontSize: string;
  passageLineHeight: number;
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
    passageFontSize: 'clamp(0.96rem, 0.94rem + 0.08vw, 1.04rem)',
    passageTitleFontSize: 'clamp(1.16rem, 1.1rem + 0.18vw, 1.32rem)',
    passageH1FontSize: 'clamp(1.34rem, 1.27rem + 0.2vw, 1.5rem)',
    passageH2FontSize: 'clamp(1.18rem, 1.12rem + 0.18vw, 1.34rem)',
    passageH3FontSize: 'clamp(1.05rem, 1rem + 0.14vw, 1.18rem)',
    passageLineHeight: 1.72,
  },
  normal: {
    rootFontSize: 'clamp(16.5px, 1.03rem + 0.18vw, 18.25px)',
    lineHeight: 1.72,
    fontScale: 1,
    controlFontSize: 'clamp(0.98rem, 0.95rem + 0.08vw, 1.05rem)',
    chipFontSize: 'clamp(0.88rem, 0.85rem + 0.08vw, 0.96rem)',
    metaFontSize: 'clamp(0.84rem, 0.82rem + 0.05vw, 0.9rem)',
    previewFontSize: 'clamp(1.03rem, 1rem + 0.08vw, 1.1rem)',
    passageFontSize: 'clamp(1.05rem, 1.01rem + 0.1vw, 1.16rem)',
    passageTitleFontSize: 'clamp(1.28rem, 1.2rem + 0.22vw, 1.48rem)',
    passageH1FontSize: 'clamp(1.48rem, 1.4rem + 0.24vw, 1.68rem)',
    passageH2FontSize: 'clamp(1.3rem, 1.22rem + 0.2vw, 1.48rem)',
    passageH3FontSize: 'clamp(1.14rem, 1.08rem + 0.16vw, 1.3rem)',
    passageLineHeight: 1.8,
  },
  large: {
    rootFontSize: 'clamp(18.5px, 1.14rem + 0.22vw, 21px)',
    lineHeight: 1.82,
    fontScale: 1.16,
    controlFontSize: 'clamp(1.04rem, 1rem + 0.08vw, 1.14rem)',
    chipFontSize: 'clamp(0.96rem, 0.93rem + 0.08vw, 1.04rem)',
    metaFontSize: 'clamp(0.9rem, 0.88rem + 0.05vw, 0.98rem)',
    previewFontSize: 'clamp(1.12rem, 1.08rem + 0.08vw, 1.2rem)',
    passageFontSize: 'clamp(1.18rem, 1.12rem + 0.14vw, 1.34rem)',
    passageTitleFontSize: 'clamp(1.44rem, 1.34rem + 0.28vw, 1.72rem)',
    passageH1FontSize: 'clamp(1.68rem, 1.56rem + 0.32vw, 1.96rem)',
    passageH2FontSize: 'clamp(1.46rem, 1.36rem + 0.26vw, 1.72rem)',
    passageH3FontSize: 'clamp(1.28rem, 1.2rem + 0.22vw, 1.48rem)',
    passageLineHeight: 1.9,
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
