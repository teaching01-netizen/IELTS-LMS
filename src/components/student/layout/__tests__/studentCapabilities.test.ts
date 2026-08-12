import { describe, expect, it } from 'vitest';
import { getStudentInteractionCapabilities } from '../studentCapabilities';

describe('student interaction capabilities', () => {
  it('keeps compact layout independent from pointer and touch capabilities', () => {
    expect(
      getStudentInteractionCapabilities({
        width: 393,
        height: 852,
        hasCoarsePointer: false,
        hasTouchSupport: true,
        hasHover: false,
      }),
    ).toEqual({
      layoutMode: 'compact',
      primaryPointer: 'fine',
      hasTouch: true,
      hasHover: false,
      orientation: 'portrait',
    });
  });

  it('recognizes a medium touch tablet without treating it as a device identity', () => {
    expect(
      getStudentInteractionCapabilities({
        width: 820,
        height: 1180,
        hasCoarsePointer: true,
        hasTouchSupport: true,
        hasHover: false,
      }),
    ).toMatchObject({
      layoutMode: 'medium',
      primaryPointer: 'coarse',
      hasTouch: true,
      hasHover: false,
      orientation: 'portrait',
    });
  });

  it('allows a wide touch laptop to retain wide layout', () => {
    expect(
      getStudentInteractionCapabilities({
        width: 1440,
        height: 900,
        hasCoarsePointer: false,
        hasTouchSupport: true,
        hasHover: true,
      }),
    ).toEqual({
      layoutMode: 'wide',
      primaryPointer: 'fine',
      hasTouch: true,
      hasHover: true,
      orientation: 'landscape',
    });
  });
});
