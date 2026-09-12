import { describe, expect, it } from 'vitest';
import { getStudentInteractionCapabilities } from '../studentCapabilities';

describe('student interaction capabilities', () => {
  it('keeps layout mode independent from pointer and touch capabilities (393px is phone, not compact)', () => {
    expect(
      getStudentInteractionCapabilities({
        width: 393,
        height: 852,
        hasCoarsePointer: false,
        hasTouchSupport: true,
        hasHover: false,
      }),
    ).toEqual({
      layoutMode: 'phone',
      primaryPointer: 'fine',
      hasTouch: true,
      hasHover: false,
      orientation: 'portrait',
    });
  });

  it('recognizes a standard touch tablet without treating it as a device identity', () => {
    expect(
      getStudentInteractionCapabilities({
        width: 1024,
        height: 1366,
        hasCoarsePointer: true,
        hasTouchSupport: true,
        hasHover: false,
      }),
    ).toMatchObject({
      // Height-aware policy: 1024 >= 900 width and 1366 >= 600 shell height
      // resolve standard through resolveStudentLayoutMode.
      layoutMode: 'standard',
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

  it('downgrades wide width to standard when the shell is too short (P2.1 height gate)', () => {
    expect(
      getStudentInteractionCapabilities({
        width: 1440,
        height: 500,
        hasCoarsePointer: false,
        hasTouchSupport: false,
        hasHover: true,
      }).layoutMode,
    ).toBe('standard');
  });
});
