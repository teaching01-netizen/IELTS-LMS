import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const seedGradingData = vi.hoisted(() => vi.fn());
const isBackendGradingEnabled = vi.hoisted(() => vi.fn());

vi.mock('../../utils/gradingSeedData', () => ({
  seedGradingData,
}));

vi.mock('../backendBridge', () => ({
  isBackendGradingEnabled,
}));

import { seedDevelopmentFixtures } from '../developmentFixtures';

describe('development fixture bootstrap', () => {
  beforeEach(() => {
    isBackendGradingEnabled.mockReturnValue(false);
  });

  afterEach(() => {
    seedGradingData.mockReset();
    isBackendGradingEnabled.mockReset();
  });

  it('does not block the admin workspace when optional grading data cannot be seeded', async () => {
    seedGradingData.mockRejectedValueOnce(new Error('Resource not found'));

    await expect(seedDevelopmentFixtures()).resolves.toBeUndefined();
    expect(seedGradingData).toHaveBeenCalledOnce();
  });

  it('does not seed legacy grading fixtures when backend grading is enabled', async () => {
    isBackendGradingEnabled.mockReturnValue(true);

    await expect(seedDevelopmentFixtures()).resolves.toBeUndefined();

    expect(seedGradingData).not.toHaveBeenCalled();
  });
});
