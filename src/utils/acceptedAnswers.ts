export interface AcceptsAlternativeAnswers {
  correctAnswer: string;
  acceptedAnswers?: string[] | undefined;
}

const INVISIBLE_CHARACTERS = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;

function splitAnswerVariants(value: string): string[] {
  return value.includes('|') ? value.split('|') : [value];
}

function cleanAnswer(value: string): string {
  return value
    .normalize('NFKC')
    .replace(INVISIBLE_CHARACTERS, '')
    .replace(/[\u2018\u2019\u201A\u201B`\u00B4]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212-]+/g, ' ')
    .replace(/'/g, '')
    .replace(/[.,;:!?/\\()[\]{}"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The one answer-cleaning rule used by website grading.
 *
 * Steps: NFKC, remove invisible characters, plain quotes/dashes, strip the
 * punctuation set, collapse whitespace, then ignore case. Teacher exclusions
 * on the server deliberately skip the last step.
 */
export function normalizeAnswerForMatching(value: string): string {
  return cleanAnswer(value).toLowerCase();
}

/**
 * Display-key de-duplication intentionally keeps its historical contract:
 * case-sensitive, punctuation-normalized, without invisible-character
 * stripping, so accepted-answer lists do not change on screen.
 */
export function normalizeAnswerForAcceptedAnswerKey(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212-]+/g, ' ')
    .replace(/'/g, '')
    .replace(/[.,;:!?/\\()[\]{}"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the student's answer matches the key under the grading rule. */
export function answersMatch(student: string, key: string): boolean {
  const normalizedStudent = normalizeAnswerForMatching(student);
  return normalizedStudent !== '' && normalizedStudent === normalizeAnswerForMatching(key);
}

/**
 * Case-exact comparison used by teacher exclusions. Steps 1-5 apply, the
 * case-fold step deliberately does not.
 */
export function answersMatchCaseExact(student: string, value: string): boolean {
  const cleaned = cleanAnswer(student);
  return cleaned !== '' && cleaned === cleanAnswer(value);
}

export function sanitizeAcceptedAnswers(acceptedAnswers: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const sanitized: string[] = [];

  for (const value of acceptedAnswers ?? []) {
    const variants = splitAnswerVariants(value);
    for (const variant of variants) {
      const trimmed = variant.trim();
      if (!trimmed) {
        continue;
      }

      const key = normalizeAnswerForAcceptedAnswerKey(trimmed);
      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      sanitized.push(trimmed);
    }
  }

  return sanitized;
}

export function resolveAcceptedAnswers(entry: AcceptsAlternativeAnswers): string[] {
  const fromAccepted = sanitizeAcceptedAnswers(entry.acceptedAnswers);
  if (fromAccepted.length > 0) {
    return fromAccepted;
  }

  return sanitizeAcceptedAnswers(splitAnswerVariants(entry.correctAnswer));
}

export function buildAcceptedAnswerFields(acceptedAnswers: readonly string[]): {
  correctAnswer: string;
  acceptedAnswers: string[];
} {
  const sanitized = sanitizeAcceptedAnswers(acceptedAnswers);
  return {
    correctAnswer: sanitized[0] ?? '',
    acceptedAnswers: sanitized,
  };
}

export function syncAcceptedAnswers<T extends AcceptsAlternativeAnswers>(entry: T): T {
  return {
    ...entry,
    ...buildAcceptedAnswerFields(resolveAcceptedAnswers(entry)),
  };
}
