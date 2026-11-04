import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { answersMatchForEntry } from '../acceptedAnswers';

interface StudentInputVector {
  id: string;
  group: string;
  key: string;
  student: string;
  optOut: boolean;
  expected: boolean;
}

const fixture = JSON.parse(
  readFileSync('testdata/objective-grading-parity/student-input-vectors.json', 'utf8'),
) as { vectors: StudentInputVector[] };

describe('student input vectors (shared grading contract)', () => {
  it.each(fixture.vectors)('$id [$group] $student vs $key (optOut=$optOut)', ({ student, key, optOut, expected }) => {
    // Default strict: exact case. Opt-out folds case only.
    expect(answersMatchForEntry(student, key, !optOut)).toBe(expected);
  });
});
