import { describe, expect, it } from 'vitest';
import { parseSatJoinUrl } from './sat-join-url';

describe('sat-join-url', () => {
  it('parses origin and accessLinkId from join url', () => {
    const parsed = parseSatJoinUrl('https://example.com/join/link-123');
    expect(parsed.origin).toBe('https://example.com');
    expect(parsed.accessLinkId).toBe('link-123');
  });

  it('throws for non-join path', () => {
    expect(() => parseSatJoinUrl('https://example.com/student/abc-123/register')).toThrow();
  });
});
