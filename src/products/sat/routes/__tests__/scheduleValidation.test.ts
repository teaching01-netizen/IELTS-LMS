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
    // Fixture clock pinned before the range so the D2 past-start rule
    // (default now) does not shadow the end>start assertion.
    expect(validateSatScheduleTimes('2026-09-01T10:00', '2026-09-01T10:00', new Date('2026-08-01T00:00'))).toEqual({
      end: 'End time must be after the start time.',
    });
  });

  it('accepts a valid range', () => {
    expect(validateSatScheduleTimes('2026-09-01T10:00', '2026-09-01T13:00', new Date('2026-08-01T00:00'))).toEqual({});
  });

  it('rejects a past start (D2 policy)', () => {
    expect(validateSatScheduleTimes('2026-09-01T08:59', '2026-09-01T10:00', new Date('2026-09-01T09:00'))).toEqual({
      start: 'Start time is in the past.',
    });
  });

  it('accepts a start exactly at now (past boundary is exclusive)', () => {
    expect(validateSatScheduleTimes('2026-09-01T09:00', '2026-09-01T10:00', new Date('2026-09-01T09:00'))).toEqual({});
  });

  it('rejects a session shorter than 15 minutes (D2 policy)', () => {
    expect(validateSatScheduleTimes('2026-09-01T10:00', '2026-09-01T10:14', new Date('2026-09-01T09:00'))).toEqual({
      end: 'Sessions must be at least 15 minutes long.',
    });
  });

  it('accepts a session of exactly 15 minutes (duration boundary is inclusive)', () => {
    expect(validateSatScheduleTimes('2026-09-01T10:00', '2026-09-01T10:15', new Date('2026-09-01T09:00'))).toEqual({});
  });

  it('keeps presence errors ahead of the past-start rule', () => {
    expect(validateSatScheduleTimes('', '2026-09-01T10:00', new Date('2026-09-02T00:00'))).toEqual({
      start: 'Choose a start time.',
    });
  });

  it('keeps validity errors ahead of the past-start rule', () => {
    expect(validateSatScheduleTimes('not-a-date', '2026-09-01T10:00', new Date('2026-09-02T00:00'))).toEqual({
      start: 'Enter a valid start time.',
    });
  });

  it('defaults now to the current time: far-future ranges pass with no third arg', () => {
    expect(validateSatScheduleTimes('2099-01-01T10:00', '2099-01-01T13:00')).toEqual({});
  });
});
