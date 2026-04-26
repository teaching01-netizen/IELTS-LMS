import { describe, expect, it } from 'vitest';
import { isStudentTabletMode } from '../tabletMode';

describe('student tablet mode', () => {
  it('detects a touch-enabled iPad-sized viewport as tablet mode', () => {
    expect(
      isStudentTabletMode({
        width: 1024,
        height: 768,
        hasCoarsePointer: true,
        hasTouchSupport: true,
      }),
    ).toBe(true);
  });

  it('keeps desktop-like viewports out of tablet mode', () => {
    expect(
      isStudentTabletMode({
        width: 1440,
        height: 900,
        hasCoarsePointer: false,
        hasTouchSupport: false,
      }),
    ).toBe(false);
  });
});
