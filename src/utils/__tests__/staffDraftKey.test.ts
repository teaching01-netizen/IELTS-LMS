import { describe, expect, it } from 'vitest';
import { buildStaffDraftKey } from '../staffDraftKey';

describe('staff durable draft identity boundaries', () => {
  it('names the same resource differently for two authenticated staff members', () => {
    const staffA = buildStaffDraftKey('staff-a', 'exam-builder', 'exam-1');
    const staffB = buildStaffDraftKey('staff-b', 'exam-builder', 'exam-1');

    expect(staffA).not.toBe(staffB);
  });

  it('refuses to create a recoverable draft key without an authenticated staff identity', () => {
    expect(buildStaffDraftKey(null, 'assessment-question', 'exam-1', 'question-1')).toBeNull();
  });
});
