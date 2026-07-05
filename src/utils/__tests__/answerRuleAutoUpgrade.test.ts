import { describe, expect, it } from 'vitest';
import { suggestUpgradedAnswerRule, maxVariantWordCountFromAcceptedAnswers } from '../answerRuleAutoUpgrade';

describe('suggestUpgradedAnswerRule', () => {
  it('returns null when required words fit current rule', () => {
    expect(suggestUpgradedAnswerRule('ONE_WORD', 1)).toBeNull();
    expect(suggestUpgradedAnswerRule('TWO_WORDS', 2)).toBeNull();
    expect(suggestUpgradedAnswerRule('THREE_WORDS', 3)).toBeNull();
  });

  it('suggests TWO_WORDS when ONE_WORD is insufficient', () => {
    expect(suggestUpgradedAnswerRule('ONE_WORD', 2)).toBe('TWO_WORDS');
  });

  it('suggests THREE_WORDS when TWO_WORDS is insufficient', () => {
    expect(suggestUpgradedAnswerRule('TWO_WORDS', 3)).toBe('THREE_WORDS');
  });

  it('returns null when required words exceed maximum (3)', () => {
    expect(suggestUpgradedAnswerRule('THREE_WORDS', 4)).toBeNull();
    expect(suggestUpgradedAnswerRule('ONE_WORD', 5)).toBeNull();
  });

  it('returns null when required words is 0 or negative', () => {
    expect(suggestUpgradedAnswerRule('ONE_WORD', 0)).toBeNull();
    expect(suggestUpgradedAnswerRule('ONE_WORD', -1)).toBeNull();
  });
});

describe('maxVariantWordCountFromAcceptedAnswers', () => {
  it('returns 0 for empty array', () => {
    expect(maxVariantWordCountFromAcceptedAnswers([])).toBe(0);
  });

  it('counts words in single answer', () => {
    expect(maxVariantWordCountFromAcceptedAnswers(['one word'])).toBe(2);
  });

  it('counts words across pipe-separated variants', () => {
    expect(maxVariantWordCountFromAcceptedAnswers(['quick|fast brown fox'])).toBe(3);
  });

  it('returns max word count across multiple answers', () => {
    expect(maxVariantWordCountFromAcceptedAnswers(['a', 'one two three', 'x y'])).toBe(3);
  });

  it('handles empty variants gracefully', () => {
    expect(maxVariantWordCountFromAcceptedAnswers(['|hello|', ''])).toBe(1);
  });

  it('handles whitespace-only variants', () => {
    expect(maxVariantWordCountFromAcceptedAnswers(['  |  ', 'one'])).toBe(1);
  });
});
