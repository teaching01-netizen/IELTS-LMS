import { describe, expect, it } from 'vitest';
import { validateSatScheduleTimes } from '../scheduleValidation';

describe('validateSatScheduleTimes', () => {
  it('rejects missing values', () => {
    expect(validateSatScheduleTimes('', '')).toEqual({
      start: 'Choose a start time.',
      end: 'Choose an end time.',
    });
  });

  it('rejects an invalid date', () => {
    expect(validateSatScheduleTimes('not-a-date', '2026-09-01T10:00')).toEqual({
      start: 'Enter a valid start time.',
    });
  });

  it('rejects an end time that is not after the start', () => {
    expect(validateSatScheduleTimes('2026-09-01T10:00', '2026-09-01T10:00')).toEqual({
      end: 'End time must be after the start time.',
    });
  });

  it('accepts a valid range', () => {
    expect(validateSatScheduleTimes('2026-09-01T10:00', '2026-09-01T13:00')).toEqual({});
  });
});
