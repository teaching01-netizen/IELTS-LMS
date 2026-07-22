import type { SentenceCompletionQuestion } from '../types';
import { normalizeAnswerForMatching, resolveAcceptedAnswers } from './acceptedAnswers';

export function getSharedSentenceAnswerPool(question: SentenceCompletionQuestion): string[] {
  if (question.acceptAnyAnswerKey !== true) {
    return [];
  }

  if (question.sharedAcceptedAnswers !== undefined) {
    return [...question.sharedAcceptedAnswers];
  }

  const seen = new Set<string>();
  const pool: string[] = [];

  for (const blank of question.blanks) {
    for (const answer of resolveAcceptedAnswers(blank)) {
      const normalized = normalizeAnswerForMatching(answer);
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      pool.push(answer);
    }
  }

  return pool;
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

export function countUniqueSharedSentenceKeys(question: SentenceCompletionQuestion): number {
  const normalizedKeys = new Set<string>();

  for (const answer of getSharedSentenceAnswerPool(question)) {
    const normalized = normalizeAnswerForMatching(answer);
    if (normalized) {
      normalizedKeys.add(normalized);
    }
  }

  return normalizedKeys.size;
}

export function matchSharedSentenceAnswers(
  studentAnswers: readonly unknown[],
  acceptedAnswers: readonly string[],
): boolean[] {
  const availableKeys = new Set<string>();

  for (const answer of acceptedAnswers) {
    const normalized = normalizeAnswerForMatching(answer);
    if (normalized) {
      availableKeys.add(normalized);
    }
  }

  return studentAnswers.map((studentAnswer) => {
    if (typeof studentAnswer !== 'string') {
      return false;
    }

    const normalized = normalizeAnswerForMatching(studentAnswer);
    if (!normalized || !availableKeys.has(normalized)) {
      return false;
    }

    availableKeys.delete(normalized);
    return true;
  });
}
