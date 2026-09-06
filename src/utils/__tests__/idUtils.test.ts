import { afterEach, describe, expect, it, vi } from 'vitest';
import { createId } from '../idUtils';

describe('createId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefixes a randomUUID when available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid-123' });
    expect(createId('q')).toBe('q-uuid-123');
  });

  it('falls back to timestamp+random when randomUUID is missing', () => {
    vi.stubGlobal('crypto', undefined);
    const id = createId('blk');
    expect(id.startsWith('blk-')).toBe(true);
    expect(id.length).toBeGreaterThan('blk-'.length + 5);
  });
});
