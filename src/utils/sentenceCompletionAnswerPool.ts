import type { CaseSensitivity, SentenceCompletionQuestion } from '../types';
import {
  foldCaseForMatching,
  normalizeAnswerCaseExact,
  resolveAcceptedAnswers,
  sanitizeAcceptedAnswers,
} from './acceptedAnswers';

/**
 * Structural shape shared by SENTENCE_COMPLETION and NOTE_COMPLETION questions.
 * The Go grader pools both types through one branch, so the website helpers
 * must accept both without branching on the block type.
 */
export interface SharedAnswerPoolBlank extends CaseSensitivity {
  correctAnswer: string;
  acceptedAnswers?: string[] | undefined;
}

export interface SharedAnswerPoolQuestion extends CaseSensitivity {
  blanks: readonly SharedAnswerPoolBlank[];
  acceptAnyAnswerKey?: boolean | undefined;
  sharedAcceptedAnswers?: string[] | undefined;
}

/**
 * Pool policy mirrors the Go `sentenceAnswerPool`: strict (case-distinct keys)
 * by default; case-folded only when the question opts out or every blank does.
 */
function isStrictSharedSentencePool(question: SharedAnswerPoolQuestion): boolean {
  if (question.caseSensitive !== undefined) {
    return question.caseSensitive;
  }
  const blanks = question.blanks ?? [];
  return !(blanks.length > 0 && blanks.every((blank) => blank.caseSensitive === false));
}

/**
 * One de-duplication key per pool answer. It uses the *grading* cleaner and
 * the same fold as matching (not the display-key cleaner), so the website
 * cannot keep two keys the server collapses into one.
 */
function sharedPoolAnswerKey(answer: string, strict: boolean): string {
  const key = normalizeAnswerCaseExact(answer);
  return strict ? key : foldCaseForMatching(key);
}

function uniquePoolAnswers(answers: readonly string[], strict: boolean): string[] {
  const seen = new Set<string>();
  const pool: string[] = [];

  for (const answer of answers) {
    const key = sharedPoolAnswerKey(answer, strict);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    pool.push(answer);
  }

  return pool;
}

/** Union of every blank's own primary and accepted keys, in blank order. */
function derivedPoolAnswers(question: SharedAnswerPoolQuestion): string[] {
  const derivedAnswers: string[] = [];
  for (const blank of question.blanks) {
    derivedAnswers.push(...sanitizeAcceptedAnswers([
      blank.correctAnswer,
      ...(blank.acceptedAnswers ?? []),
    ]));
  }
  return derivedAnswers;
}

export function getSharedSentenceAnswerPool(question: SharedAnswerPoolQuestion): string[] {
  if (question.acceptAnyAnswerKey !== true) {
    return [];
  }

  const strict = isStrictSharedSentencePool(question);
  const answers = question.sharedAcceptedAnswers !== undefined
    ? sanitizeAcceptedAnswers(question.sharedAcceptedAnswers)
    : derivedPoolAnswers(question);

  return uniquePoolAnswers(answers, strict);
}

export function mergeSharedSentenceAnswerPool(question: SharedAnswerPoolQuestion): string[] {
  if (question.sharedAcceptedAnswers?.length === 0) {
    return [];
  }

  const existingAnswers = question.sharedAcceptedAnswers ?? [];
  // Seeding preserves case-distinct authoring variants regardless of the
  // question's opt-out (blocks README); grading folds them later at use time.
  return uniquePoolAnswers(
    sanitizeAcceptedAnswers([...existingAnswers, ...derivedPoolAnswers(question)]),
    true,
  );
}

export function getEffectiveSentenceAcceptedAnswers(
  question: SentenceCompletionQuestion,
  blankIndex: number,
): string[] {
  if (question.acceptAnyAnswerKey === true) {
    return getSharedSentenceAnswerPool(question);
  }

  const blank = question.blanks[blankIndex];
  return blank ? resolveAcceptedAnswers(blank) : [];
}

/**
 * Number of distinct shared keys: the pool already owns the strict/folded
 * de-duplication policy, so this cannot drift from grading.
 */
export function countUniqueSharedSentenceKeys(question: SharedAnswerPoolQuestion): number {
  return getSharedSentenceAnswerPool(question).length;
}

interface SharedSentencePoolEntry {
  readonly exact: string;
  readonly folded: string;
  consumed: boolean;
}

export interface SharedSentencePoolMatcher {
  /**
   * Consume at most one unused pool key for this answer. Empty and non-string
   * answers never match. `caseSensitive` is the per-slot rule (strict default).
   */
  match(studentAnswer: unknown, caseSensitive?: boolean): boolean;
}

/**
 * One-shot matcher for the shared sentence/note completion pool. Each entry
 * holds its exact and case-folded forms, and consumption is per entry: using
 * one key never removes its case-variant sibling, so a pool such as
 * ["Garden", "garden"] can satisfy two strict blanks in blank order. Entries
 * are de-duplicated on the grading-exact form so a case-insensitive variant
 * cannot become a second usable key.
 */
export function createSharedSentencePoolMatcher(
  acceptedAnswers: readonly string[],
): SharedSentencePoolMatcher {
  const entries: SharedSentencePoolEntry[] = [];
  const seen = new Set<string>();

  for (const answer of acceptedAnswers) {
    const exact = normalizeAnswerCaseExact(answer);
    if (!exact || seen.has(exact)) {
      continue;
    }
    seen.add(exact);
    entries.push({ exact, folded: foldCaseForMatching(exact), consumed: false });
  }

  return {
    match(studentAnswer: unknown, caseSensitive = true): boolean {
      if (typeof studentAnswer !== 'string') {
        return false;
      }

      const exact = normalizeAnswerCaseExact(studentAnswer);
      if (!exact) {
        return false;
      }
      const normalized = caseSensitive ? exact : foldCaseForMatching(exact);

      for (const entry of entries) {
        if (entry.consumed) {
          continue;
        }

        if (caseSensitive ? entry.exact === normalized : entry.folded === normalized) {
          entry.consumed = true;
          return true;
        }
      }

      return false;
    },
  };
}
