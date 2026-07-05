import { describe, expect, it } from 'vitest';
import { isAppleMobileDevice } from '../appleMobileDevice';

describe('isAppleMobileDevice', () => {
  it('returns true for iPhone user agent', () => {
    expect(
      isAppleMobileDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'),
    ).toBe(true);
  });

  it('returns true for iPad user agent', () => {
    expect(
      isAppleMobileDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15'),
    ).toBe(true);
  });

  it('returns true for iPod user agent', () => {
    expect(
      isAppleMobileDevice('Mozilla/5.0 (iPod; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'),
    ).toBe(true);
  });

  it('returns false for standard desktop Chrome', () => {
    expect(
      isAppleMobileDevice('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'),
    ).toBe(false);
  });

  it('returns false for standard desktop Safari', () => {
    expect(
      isAppleMobileDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15'),
    ).toBe(false);
  });

  it('returns true for Macintosh with CriOS (Chrome on iOS)', () => {
    expect(
      isAppleMobileDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 CriOS/120.0.0.0 Safari/604.1'),
    ).toBe(true);
  });

  it('returns true for Macintosh with FxiOS (Firefox on iOS)', () => {
    expect(
      isAppleMobileDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 FxiOS/120.0 Safari/605.1.15'),
    ).toBe(true);
  });

  it('returns true for Macintosh with EdgiOS (Edge on iOS)', () => {
    expect(
      isAppleMobileDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 EdgiOS/120.0.0.0 Safari/605.1.15'),
    ).toBe(true);
  });

  it('returns true for Macintosh with Mobile in user agent', () => {
    expect(
      isAppleMobileDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Mobile/15E148'),
    ).toBe(true);
  });

  it('returns false for empty user agent', () => {
    expect(isAppleMobileDevice('')).toBe(false);
  });

  it('returns false for random non-Apple user agent', () => {
    expect(isAppleMobileDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
  });
});
