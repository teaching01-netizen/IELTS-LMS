import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seedGradingData = vi.hoisted(() => vi.fn());
const isBackendGradingEnabled = vi.hoisted(() => vi.fn());

vi.mock("../../utils/gradingSeedData", () => ({ seedGradingData }));
vi.mock("../backendBridge", () => ({ isBackendGradingEnabled }));

import { seedDevelopmentFixtures } from "../developmentFixtures";

describe("development grading fixtures", () => {
  beforeEach(() => {
    seedGradingData.mockReset();
    isBackendGradingEnabled.mockReset();
    vi.stubEnv("VITE_FEATURE_USE_BACKEND_GRADING", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not fan out legacy fixture reads when backend grading is enabled", async () => {
    isBackendGradingEnabled.mockReturnValue(true);

    await expect(seedDevelopmentFixtures()).resolves.toBe(false);

    expect(seedGradingData).not.toHaveBeenCalled();
  });

  it("seeds legacy fixtures only when backend grading is disabled", async () => {
    isBackendGradingEnabled.mockReturnValue(false);

    await expect(seedDevelopmentFixtures()).resolves.toBe(true);

    expect(seedGradingData).toHaveBeenCalledOnce();
  });
});
