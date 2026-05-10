export type StudentFontSize = 'small' | 'normal' | 'large';
export type StudentPassageReadabilityLevel = 0 | 1 | 2;

export const STUDENT_PASSAGE_READABILITY_MIN: StudentPassageReadabilityLevel = 0;
export const STUDENT_PASSAGE_READABILITY_MAX: StudentPassageReadabilityLevel = 2;
export const DEFAULT_STUDENT_PASSAGE_READABILITY_LEVEL: StudentPassageReadabilityLevel = 1;

const STUDENT_PASSAGE_READABILITY_LABELS: Record<StudentPassageReadabilityLevel, string> = {
  0: 'Compact',
  1: 'Comfort',
  2: 'Extra Large',
};

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
  passageLineHeight: string;
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
    passageFontSize: 'clamp(0.98rem, 0.96rem + 0.08vw, 1.06rem)',
    passageTitleFontSize: 'clamp(1.35rem, 1.28rem + 0.2vw, 1.55rem)',
    passageH1FontSize: 'clamp(1.22rem, 1.16rem + 0.18vw, 1.42rem)',
    passageH2FontSize: 'clamp(1.1rem, 1.05rem + 0.14vw, 1.26rem)',
    passageH3FontSize: 'clamp(1rem, 0.96rem + 0.12vw, 1.14rem)',
    passageLineHeight: '1.62',
  },
  normal: {
    rootFontSize: 'clamp(16.5px, 1.03rem + 0.18vw, 18.25px)',
    lineHeight: 1.72,
    fontScale: 1,
    controlFontSize: 'clamp(0.98rem, 0.95rem + 0.08vw, 1.05rem)',
    chipFontSize: 'clamp(0.88rem, 0.85rem + 0.08vw, 0.96rem)',
    metaFontSize: 'clamp(0.84rem, 0.82rem + 0.05vw, 0.9rem)',
    previewFontSize: 'clamp(1.03rem, 1rem + 0.08vw, 1.1rem)',
    passageFontSize: 'clamp(1.08rem, 1.04rem + 0.12vw, 1.22rem)',
    passageTitleFontSize: 'clamp(1.5rem, 1.42rem + 0.22vw, 1.74rem)',
    passageH1FontSize: 'clamp(1.34rem, 1.27rem + 0.2vw, 1.58rem)',
    passageH2FontSize: 'clamp(1.2rem, 1.15rem + 0.16vw, 1.38rem)',
    passageH3FontSize: 'clamp(1.08rem, 1.03rem + 0.13vw, 1.24rem)',
    passageLineHeight: '1.72',
  },
  large: {
    rootFontSize: 'clamp(18.5px, 1.14rem + 0.22vw, 21px)',
    lineHeight: 1.82,
    fontScale: 1.16,
    controlFontSize: 'clamp(1.04rem, 1rem + 0.08vw, 1.14rem)',
    chipFontSize: 'clamp(0.96rem, 0.93rem + 0.08vw, 1.04rem)',
    metaFontSize: 'clamp(0.9rem, 0.88rem + 0.05vw, 0.98rem)',
    previewFontSize: 'clamp(1.12rem, 1.08rem + 0.08vw, 1.2rem)',
    passageFontSize: 'clamp(1.2rem, 1.14rem + 0.14vw, 1.36rem)',
    passageTitleFontSize: 'clamp(1.72rem, 1.62rem + 0.26vw, 2rem)',
    passageH1FontSize: 'clamp(1.52rem, 1.43rem + 0.23vw, 1.8rem)',
    passageH2FontSize: 'clamp(1.36rem, 1.29rem + 0.19vw, 1.58rem)',
    passageH3FontSize: 'clamp(1.22rem, 1.16rem + 0.15vw, 1.4rem)',
    passageLineHeight: '1.82',
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

export function clampStudentPassageReadabilityLevel(value: number): StudentPassageReadabilityLevel {
  if (value <= STUDENT_PASSAGE_READABILITY_MIN) {
    return STUDENT_PASSAGE_READABILITY_MIN;
  }
  if (value >= STUDENT_PASSAGE_READABILITY_MAX) {
    return STUDENT_PASSAGE_READABILITY_MAX;
  }
  return Math.round(value) as StudentPassageReadabilityLevel;
}

export function canIncreaseStudentPassageReadability(
  level: StudentPassageReadabilityLevel,
): boolean {
  return level < STUDENT_PASSAGE_READABILITY_MAX;
}

export function canDecreaseStudentPassageReadability(
  level: StudentPassageReadabilityLevel,
): boolean {
  return level > STUDENT_PASSAGE_READABILITY_MIN;
}

export function getStudentPassageReadabilityLabel(
  level: StudentPassageReadabilityLevel,
): string {
  return STUDENT_PASSAGE_READABILITY_LABELS[level] ?? STUDENT_PASSAGE_READABILITY_LABELS[1];
}
