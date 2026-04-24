import { describe, expect, it } from 'vitest';
import { countBlankPlaceholders } from '../blankPlaceholders';

describe('countBlankPlaceholders', () => {
  it('counts underscore runs as blanks', () => {
    expect(countBlankPlaceholders('The ____ is important.')).toBe(1);
    expect(countBlankPlaceholders('The ____ is ____')).toBe(2);
    expect(countBlankPlaceholders('No blanks here')).toBe(0);
  });

  it('treats 2+ underscores as a blank', () => {
    expect(countBlankPlaceholders('A __ B')).toBe(1);
    expect(countBlankPlaceholders('A _ B')).toBe(0);
  });
});

