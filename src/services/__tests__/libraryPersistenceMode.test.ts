import { afterEach, describe, expect, it, vi } from 'vitest';

import { isBackendLibraryEnabled } from '../backendBridge';

describe('isBackendLibraryEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    document.cookie = 'app-session=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('returns true (backend is always enabled)', () => {
    expect(isBackendLibraryEnabled()).toBe(true);
  });

  it('remains true regardless of cookies', () => {
    document.cookie = 'app-session=active-session; path=/';
    expect(isBackendLibraryEnabled()).toBe(true);
  });
});
