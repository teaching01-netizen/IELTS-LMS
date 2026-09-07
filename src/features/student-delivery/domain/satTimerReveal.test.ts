import { describe, expect, it } from 'vitest';
import { shouldAutoRevealTimer } from './satTiming';

describe('shouldAutoRevealTimer', () => {
  it('reveals once when crossing the 5-minute threshold downward', () => {
    expect(shouldAutoRevealTimer({ previousSeconds: 301, remainingSeconds: 300, alreadyRevealed: false })).toBe(true);
    expect(shouldAutoRevealTimer({ previousSeconds: 302, remainingSeconds: 299, alreadyRevealed: false })).toBe(true);
  });

  it('does not reveal above the threshold or when already revealed', () => {
    expect(shouldAutoRevealTimer({ previousSeconds: 400, remainingSeconds: 301, alreadyRevealed: false })).toBe(false);
    expect(shouldAutoRevealTimer({ previousSeconds: 299, remainingSeconds: 298, alreadyRevealed: false })).toBe(false);
    expect(shouldAutoRevealTimer({ previousSeconds: 400, remainingSeconds: 299, alreadyRevealed: true })).toBe(false);
  });

  it('reveals on hydration when the exam loads already below five minutes', () => {
    expect(shouldAutoRevealTimer({ previousSeconds: null, remainingSeconds: 299, alreadyRevealed: false })).toBe(true);
    expect(shouldAutoRevealTimer({ previousSeconds: null, remainingSeconds: 301, alreadyRevealed: false })).toBe(false);
    expect(shouldAutoRevealTimer({ previousSeconds: null, remainingSeconds: null, alreadyRevealed: false })).toBe(false);
  });

  it('resets when time moves back above five minutes (section change, extension)', () => {
    expect(shouldAutoRevealTimer({ previousSeconds: 299, remainingSeconds: 301, alreadyRevealed: true })).toBe(false);
  });
});
