import { describe, expect, it } from 'vitest';
import { getStudentLayoutMode } from '../studentLayoutMode';

describe('student layout mode policy', () => {
  it.each([
    [360, 'compact'],
    [699, 'compact'],
    [700, 'medium'],
    [820, 'medium'],
    [1199, 'medium'],
    [1200, 'wide'],
    [1440, 'wide'],
  ] as const)('classifies %d CSS pixels as %s', (width, expectedMode) => {
    expect(getStudentLayoutMode(width)).toBe(expectedMode);
  });

  it('treats invalid or unavailable widths as compact for the safest shell', () => {
    expect(getStudentLayoutMode(0)).toBe('compact');
    expect(getStudentLayoutMode(-1)).toBe('compact');
    expect(getStudentLayoutMode(Number.NaN)).toBe('compact');
  });
});
