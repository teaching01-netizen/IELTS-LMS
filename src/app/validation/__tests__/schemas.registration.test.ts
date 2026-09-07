import { describe, expect, it } from 'vitest';
import { formSchemas } from '../schemas';

function baseRegistration(wcode: string) {
  return {
    wcode,
    email: 'student@example.com',
    studentName: 'Student One',
    nickname: 'student-one',
    ieltsCourse: 'IELTS Academic',
  };
}

describe('formSchemas.studentRegistration free-form access code', () => {
  it.each(['W250334', 'w250334', 'alice', 'guest-alpha_01', 'abc123'])(
    'accepts %s (still required, any format)',
    (wcode) => {
      expect(() => formSchemas.studentRegistration.parse(baseRegistration(wcode))).not.toThrow();
    },
  );

  it('normalizes W-codes to uppercase but preserves free-form codes', () => {
    expect(formSchemas.studentRegistration.parse(baseRegistration('w250334')).wcode).toBe('W250334');
    expect(formSchemas.studentRegistration.parse(baseRegistration('alice')).wcode).toBe('alice');
    expect(formSchemas.studentRegistration.parse(baseRegistration('  guest-alpha_01  ')).wcode).toBe(
      'guest-alpha_01',
    );
  });

  it('still rejects an empty access code', () => {
    expect(() => formSchemas.studentRegistration.parse(baseRegistration('   '))).toThrow();
  });
});
