import { describe, expect, it, vi, afterEach } from 'vitest';
import { prefersReducedMotion } from '../prefersReducedMotion';

describe('prefersReducedMotion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error test cleanup
    delete window.matchMedia;
  });

  it('returns true when matchMedia prefers-reduced-motion matches', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as any;
    expect(prefersReducedMotion()).toBe(true);
  });

  it('returns false when matchMedia is missing or does not match', () => {
    expect(prefersReducedMotion()).toBe(false);
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as any;
    expect(prefersReducedMotion()).toBe(false);
  });
});

