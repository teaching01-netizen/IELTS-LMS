import { describe, expect, it } from 'vitest';
import { viewerTimeZoneLabel } from './satTestTime';

describe('viewerTimeZoneLabel', () => {
  it('identifies the viewer zone without implying one fixed UTC offset', () => {
    const expectedZone = new Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';

    expect(viewerTimeZoneLabel()).toBe(expectedZone);
    expect(viewerTimeZoneLabel()).not.toMatch(/UTC[+-]\d{2}:?\d{2}/);
  });
});
