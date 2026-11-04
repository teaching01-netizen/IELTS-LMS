import type { CaseSensitivity } from '../types';

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
    // Go strings.Fields treats U+0085 (NEXT LINE) as whitespace; JS \s does not.
    .replace(/\u0085+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The one case fold used by the website. Go's strings.ToLower uses Unicode
 * *simple* case mapping; JS toLowerCase uses the full mapping. These are the
 * only two unconditional divergences (U+0130 and final sigma), so collapsing
 * them first makes both stacks fold identically.
 */
export function foldCaseForMatching(value: string): string {
  return value
    .replace(/\u0130/g, 'i')
    .replace(/\u03A3/g, '\u03C3')
    .toLowerCase();
}

/**
 * The one answer-cleaning rule used by website grading.
 *
 * Steps: NFKC, remove invisible characters, plain quotes/dashes, strip the
 * punctuation set, collapse whitespace, then fold case with the same
 * operation the Go grader uses. Teacher exclusions on the server deliberately
 * skip the last step.
 */
export function normalizeAnswerForMatching(value: string): string {
  return foldCaseForMatching(cleanAnswer(value));
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

/** Default policy: exact case required (IELTS). `urwin` ≠ `Urwin`.
 *  Steps 1-5 apply (NFKC, invisible, quotes/dashes, punctuation, spaces);
 *  case-fold deliberately does not. Use explicit opt-out via
 *  `answersMatchForEntry(..., false)` only when `caseSensitive: false`. */
export function answersMatch(student: string, key: string): boolean {
  return answersMatchCaseExact(student, key);
}

/** Default policy: IELTS typed answers require exact case (Urwin ≠ urwin).
 *  Opt-out only when entry explicitly sets `caseSensitive: false`. */
export function isCaseSensitiveEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return true;
  return (entry as CaseSensitivity).caseSensitive !== false;
}

/** Case-insensitive match for explicit `caseSensitive: false` opt-out only. */
export function answersMatchInsensitive(student: string, key: string): boolean {
  const normalizedStudent = normalizeAnswerForMatching(student);
  return normalizedStudent !== '' && normalizedStudent === normalizeAnswerForMatching(key);
}

/** Dispatch to case-exact (default) when strict, else case-insensitive opt-out. */
export function answersMatchForEntry(student: string, key: string, caseSensitive: boolean): boolean {
  return caseSensitive ? answersMatchCaseExact(student, key) : answersMatchInsensitive(student, key);
}

/**
 * Case-exact comparison used by teacher exclusions. Steps 1-5 apply, the
 * case-fold step deliberately does not.
 */
export function answersMatchCaseExact(student: string, value: string): boolean {
  const cleaned = cleanAnswer(student);
  return cleaned !== '' && cleaned === cleanAnswer(value);
}

/** Steps 1-5 only (no case fold) — used for case-sensitive pools/keys. */
export function normalizeAnswerCaseExact(value: string): string {
  return cleanAnswer(value);
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

/**
 * The one way to write an edited accepted-answer list back onto a slot list:
 * sanitize once, then replace the selected entry. Every block editor that
 * exposes an Accepted-Answers field uses this so the sanitize rule cannot
 * drift between question types.
 */
export function mapAcceptedAnswers<T extends { acceptedAnswers?: string[] | undefined }>(
  items: readonly T[],
  select: (item: T, index: number) => boolean,
  acceptedAnswers: readonly string[],
): T[] {
  const sanitized = sanitizeAcceptedAnswers(acceptedAnswers);
  return items.map((item, index) => (select(item, index) ? { ...item, acceptedAnswers: sanitized } : item));
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
