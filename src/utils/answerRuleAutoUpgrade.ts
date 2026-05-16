import type { AnswerRule } from '../types';

function wordLimitFromRule(rule: AnswerRule): number {
  switch (rule) {
    case 'ONE_WORD':
      return 1;
    case 'TWO_WORDS':
      return 2;
    case 'THREE_WORDS':
      return 3;
  }
}

function ruleFromWordLimit(limit: number): AnswerRule | null {
  switch (limit) {
    case 1:
      return 'ONE_WORD';
    case 2:
      return 'TWO_WORDS';
    case 3:
      return 'THREE_WORDS';
    default:
      return null;
  }
}

function splitVariants(value: string): string[] {
  if (!value.trim()) return [];
  return value
    .split('|')
    .map((variant) => variant.trim())
    .filter(Boolean);
}

function countWords(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

export function maxVariantWordCountFromAcceptedAnswers(answers: readonly string[]): number {
  let maxCount = 0;
  for (const line of answers) {
    for (const variant of splitVariants(line)) {
      maxCount = Math.max(maxCount, countWords(variant));
    }
  }
  return maxCount;
}

export function suggestUpgradedAnswerRule(current: AnswerRule, requiredWords: number): AnswerRule | null {
  const currentLimit = wordLimitFromRule(current);
  if (requiredWords <= currentLimit) return null;

  const upgraded = ruleFromWordLimit(requiredWords);
  if (!upgraded) return null;
  return upgraded;
}

