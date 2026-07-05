import { describe, expect, it } from 'vitest';
import { isSuspiciousCompletionPromptText, trimSuspiciousCompletionPromptText } from '../completionPromptText';

describe('isSuspiciousCompletionPromptText', () => {
  it('returns false for empty string', () => {
    expect(isSuspiciousCompletionPromptText('')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isSuspiciousCompletionPromptText(null as any)).toBe(false);
    expect(isSuspiciousCompletionPromptText(undefined as any)).toBe(false);
  });

  it('returns false for short text', () => {
    expect(isSuspiciousCompletionPromptText('Hello world')).toBe(false);
  });

  it('returns true for text with reading passage marker', () => {
    const text = 'READING PASSAGE 1\nThis is the passage content.';
    expect(isSuspiciousCompletionPromptText(text)).toBe(true);
  });

  it('returns true for text with "You should spend about" marker', () => {
    const text = 'You should spend about 20 minutes on Questions 1-13.';
    expect(isSuspiciousCompletionPromptText(text)).toBe(true);
  });

  it('returns true for long text with many newlines', () => {
    const text = Array(15).fill('This is a meaningful sentence for detection.').join('\n');
    expect(isSuspiciousCompletionPromptText(text)).toBe(true);
  });

  it('returns true for long text with many sentences', () => {
    const text = Array(15).fill('This is a meaningful sentence!').join(' ');
    expect(isSuspiciousCompletionPromptText(text)).toBe(true);
  });

  it('returns true for long text with many words', () => {
    const text = Array(60).fill('meaningfulword').join(' ');
    expect(isSuspiciousCompletionPromptText(text)).toBe(true);
  });

  it('returns false for long text without suspicious markers', () => {
    const text = 'a '.repeat(100).trim();
    expect(isSuspiciousCompletionPromptText(text)).toBe(false);
  });
});

describe('trimSuspiciousCompletionPromptText', () => {
  it('returns original text when not suspicious', () => {
    const text = 'Short text';
    expect(trimSuspiciousCompletionPromptText(text)).toBe(text);
  });

  it('truncates long text without placeholders', () => {
    const text = 'word '.repeat(60);
    const result = trimSuspiciousCompletionPromptText(text, 140);
    expect(result.length).toBeLessThan(text.length);
    expect(result).toContain('…');
  });

  it('preserves placeholder underscores', () => {
    const text = 'Answer: ____ is important. ' + 'word '.repeat(50);
    const result = trimSuspiciousCompletionPromptText(text, 140);
    expect(result).toContain('____');
  });

  it('strips copied reading passage after placeholder', () => {
    const longPrefix = 'meaningfulword '.repeat(20);
    const text = `${longPrefix}____ \nREADING PASSAGE 1\nQuestions 1-5 Reading Passage 1`;
    const result = trimSuspiciousCompletionPromptText(text);
    expect(result).not.toContain('READING PASSAGE 1');
  });

  it('truncates segment before placeholder when too long', () => {
    const longSegment = Array(60).fill('word').join(' ');
    const text = `${longSegment}____ end`;
    const result = trimSuspiciousCompletionPromptText(text, 20);
    expect(result).toContain('____');
    expect(result).toContain('…');
  });
});
