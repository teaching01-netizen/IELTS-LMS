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

export interface StudentPassageReadabilityGeometry {
  /** Multiplier applied to the base passage line height. */
  lineHeightFactor: number;
  /** Maximum line measure (column width) for long-form reading surfaces. */
  measure: string;
}

/**
 * Reading-comfort geometry is orthogonal to text size: text size controls
 * font scale, comfort controls line height and column width. Long-form
 * surfaces (reading passages, listening transcripts, writing stimuli)
 * consume these through --student-passage-line-height and
 * --student-passage-measure.
 */
const STUDENT_PASSAGE_READABILITY_GEOMETRY: Record<
  StudentPassageReadabilityLevel,
  StudentPassageReadabilityGeometry
> = {
  0: { lineHeightFactor: 0.95, measure: '74ch' },
  1: { lineHeightFactor: 1, measure: '68ch' },
  2: { lineHeightFactor: 1.08, measure: '60ch' },
};

export function getStudentPassageReadabilityGeometry(
  level: StudentPassageReadabilityLevel,
): StudentPassageReadabilityGeometry {
  return STUDENT_PASSAGE_READABILITY_GEOMETRY[clampStudentPassageReadabilityLevel(level)];
}

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
  questionFontSize: string;
  questionLineHeight: string;
  /** Answer label / editable answer role (16px normal target). */
  answerFontSize: string;
  answerLineHeight: string;
  /** Writing editor role (18px/1.68 normal target, same family as passage). */
  writingEditorFontSize: string;
  writingEditorLineHeight: string;
  /** Writing prompt role (18px/1.68 normal target). */
  writingPromptFontSize: string;
  writingPromptLineHeight: string;
}

/**
 * Discrete rem-based role table (P1.1). Values never depend on viewport
 * width: resizing the window changes wrapping and available space, not the
 * chosen content font size. Rem values assume the normal 16px browser root;
 * browser text zoom and the existing Small/Medium/Large preference remain
 * the supported enlargement mechanisms. Normal-level targets come from
 * plans/ielts-act-ux-production/design-contract.md:
 * passage 18/1.68, title 26/1.22, question stem 17/1.52, answer 16/1.45,
 * writing editor/prompt 18/1.68, toolbar control 15/1.25, meta 12–13/1.35.
 */
const STUDENT_TYPOGRAPHY_SCALE: Record<StudentFontSize, StudentTypographyScale> = {
  small: {
    rootFontSize: '1rem',
    lineHeight: 1.64,
    fontScale: 0.92,
    controlFontSize: '0.875rem',
    chipFontSize: '0.8125rem',
    metaFontSize: '0.75rem',
    previewFontSize: '0.9375rem',
    passageFontSize: '1.0625rem',
    passageTitleFontSize: '1.5rem',
    passageH1FontSize: '1.125rem',
    passageH2FontSize: '1.0625rem',
    passageH3FontSize: '1rem',
    passageLineHeight: '1.64',
    questionFontSize: '1rem',
    questionLineHeight: '1.5',
    answerFontSize: '0.9375rem',
    answerLineHeight: '1.45',
    writingEditorFontSize: '1.0625rem',
    writingEditorLineHeight: '1.64',
    writingPromptFontSize: '1.0625rem',
    writingPromptLineHeight: '1.64',
  },
  normal: {
    rootFontSize: '1rem',
    lineHeight: 1.68,
    fontScale: 1,
    controlFontSize: '0.9375rem',
    chipFontSize: '0.875rem',
    metaFontSize: '0.78125rem',
    previewFontSize: '1rem',
    passageFontSize: '1.125rem',
    passageTitleFontSize: '1.625rem',
    passageH1FontSize: '1.1875rem',
    passageH2FontSize: '1.125rem',
    passageH3FontSize: '1.0625rem',
    passageLineHeight: '1.68',
    questionFontSize: '1.0625rem',
    questionLineHeight: '1.52',
    answerFontSize: '1rem',
    answerLineHeight: '1.45',
    writingEditorFontSize: '1.125rem',
    writingEditorLineHeight: '1.68',
    writingPromptFontSize: '1.125rem',
    writingPromptLineHeight: '1.68',
  },
  large: {
    rootFontSize: '1rem',
    lineHeight: 1.68,
    fontScale: 1.16,
    controlFontSize: '1.0625rem',
    chipFontSize: '1rem',
    metaFontSize: '0.875rem',
    previewFontSize: '1.0625rem',
    passageFontSize: '1.3125rem',
    passageTitleFontSize: '1.8125rem',
    passageH1FontSize: '1.3125rem',
    passageH2FontSize: '1.1875rem',
    passageH3FontSize: '1.125rem',
    passageLineHeight: '1.68',
    questionFontSize: '1.1875rem',
    questionLineHeight: '1.54',
    answerFontSize: '1.0625rem',
    answerLineHeight: '1.45',
    writingEditorFontSize: '1.3125rem',
    writingEditorLineHeight: '1.68',
    writingPromptFontSize: '1.3125rem',
    writingPromptLineHeight: '1.68',
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
