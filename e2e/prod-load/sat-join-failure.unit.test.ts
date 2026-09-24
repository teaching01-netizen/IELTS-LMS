import { describe, expect, it } from 'vitest';
import {
  classifySatJoinText,
  isSatJoinError,
  satJoinErrorFromText,
  SatJoinError,
} from './sat-join-failure';

describe('classifySatJoinText', () => {
  it('treats the completed-schedule 409 as a run-scoped failure', () => {
    const failure = classifySatJoinText('Registration is closed for this schedule.');
    expect(failure?.code).toBe('SAT_SCHEDULE_REGISTRATION_CLOSED');
    expect(failure?.scope).toBe('run');
    expect(failure?.hint).toMatch(/scheduled or live/);
  });

  it('classifies dead, paused and not-yet-open links as run-scoped', () => {
    expect(classifySatJoinText('This link is no longer active')).toMatchObject({
      code: 'SAT_LINK_NOT_ACTIVE',
      scope: 'run',
    });
    expect(classifySatJoinText('This link has ended')).toMatchObject({
      code: 'SAT_LINK_ENDED',
      scope: 'run',
    });
    expect(classifySatJoinText('Entry is temporarily paused')).toMatchObject({
      code: 'SAT_LINK_PAUSED',
      scope: 'run',
    });
    expect(classifySatJoinText('This exam isn’t open yet')).toMatchObject({
      code: 'SAT_LINK_NOT_OPEN_YET',
      scope: 'run',
    });
  });

  it('classifies roster conflicts as user-scoped', () => {
    expect(classifySatJoinText('Wcode W250001 is already registered for this schedule')).toMatchObject({
      code: 'SAT_REGISTRATION_CONFLICT',
      scope: 'user',
    });
    expect(classifySatJoinText('Student code is required for this Student Link.')).toMatchObject({
      code: 'SAT_STUDENT_CODE_REQUIRED',
      scope: 'user',
    });
  });

  it('does not classify the healthy entry form or queued admission', () => {
    const healthyForm = [
      'test · Version 12',
      'Check your details, then continue to the exam.',
      'Student code',
      'Full name',
      'Email',
      'Continue',
      'This link is pinned to published Version 12.',
    ].join('\n');
    expect(classifySatJoinText(healthyForm)).toBeNull();
    expect(classifySatJoinText("You're in the admission queue\nPosition 4 · Checking again in ~5s")).toBeNull();
    expect(classifySatJoinText('')).toBeNull();
  });
});

describe('SatJoinError', () => {
  it('carries the code, scope and hint it was built from', () => {
    const error = satJoinErrorFromText('Registration is closed for this schedule.', 'Registration is closed for this schedule.');
    expect(error).toBeInstanceOf(SatJoinError);
    expect(error?.message).toContain('SAT_SCHEDULE_REGISTRATION_CLOSED');
    expect(error?.scope).toBe('run');
    expect(error?.hint.length).toBeGreaterThan(0);
    expect(isSatJoinError(error)).toBe(true);
    expect(isSatJoinError(new Error('plain'))).toBe(false);
  });

  it('returns null for inconclusive copy so the runner retries', () => {
    expect(satJoinErrorFromText('Queue check failed after 3 attempts', 'queue')).toBeNull();
  });
});
