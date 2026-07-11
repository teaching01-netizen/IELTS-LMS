import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultConfig } from '../../../constants/examDefaults';
import { runPreCheckChecks } from '../preCheckChecks';

describe('runPreCheckChecks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      configurable: true,
    });
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    Object.defineProperty(window, 'getScreenDetails', { value: vi.fn(), configurable: true });
  });

  it('reports a passing compatibility snapshot for a supported desktop browser', () => {
    const config = createDefaultConfig('Academic', 'Academic');

    const result = runPreCheckChecks(config);

    expect(result.browserFamily).toBe('chrome');
    expect(result.checks).toHaveLength(5);
    const browserCheck = result.checks.find((check) => check.id === 'browser');
    expect(browserCheck?.status).toBe('pass');
    expect(typeof result.completedAt).toBe('string');
  });
});
