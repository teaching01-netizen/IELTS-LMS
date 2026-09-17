import { describe, expect, it } from 'vitest';
import {
  SAT_NOTE_COUNTER_URGENT_AT,
  SAT_NOTE_COUNTER_VISIBLE_AT,
  clampSatNote,
  satNoteCounterLabel,
  satNoteCounterUrgent,
  satNoteCounterVisible,
} from '../satNoteEntry';
import { SAT_ANNOTATION_NOTE_LIMIT } from '../satResponses';

describe('satNoteEntry rules', () => {
  it('hides the character count until it is worth knowing about', () => {
    expect(satNoteCounterVisible(0)).toBe(false);
    expect(satNoteCounterVisible(SAT_NOTE_COUNTER_VISIBLE_AT - 1)).toBe(false);
    expect(satNoteCounterVisible(SAT_NOTE_COUNTER_VISIBLE_AT)).toBe(true);
    expect(satNoteCounterVisible(SAT_ANNOTATION_NOTE_LIMIT)).toBe(true);
  });

  it('escalates from a footnote to a warning as the limit nears', () => {
    expect(satNoteCounterUrgent(SAT_NOTE_COUNTER_VISIBLE_AT)).toBe(false);
    expect(satNoteCounterUrgent(SAT_NOTE_COUNTER_URGENT_AT - 1)).toBe(false);
    expect(satNoteCounterUrgent(SAT_NOTE_COUNTER_URGENT_AT)).toBe(true);
    expect(satNoteCounterUrgent(SAT_ANNOTATION_NOTE_LIMIT)).toBe(true);
  });

  it('reads the count the way a person speaks it', () => {
    expect(satNoteCounterLabel(1623)).toBe('1,623/2,000');
    expect(satNoteCounterLabel(2000, 2000)).toBe('2,000/2,000');
    expect(satNoteCounterLabel(100, 50)).toBe('100/50');
  });

  it('clamps a pasted draft to the stored limit', () => {
    expect(clampSatNote('short')).toBe('short');
    expect(clampSatNote('x'.repeat(2_500))).toHaveLength(SAT_ANNOTATION_NOTE_LIMIT);
    expect(clampSatNote('x'.repeat(10), 4)).toBe('xxxx');
  });
});
