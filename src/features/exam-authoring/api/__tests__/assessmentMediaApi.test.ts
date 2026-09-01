import { beforeEach, describe, expect, it, vi } from "vitest";

const backendGet = vi.hoisted(() => vi.fn());

vi.mock("../../infrastructure/examAuthoringBackendGateway", () => ({
  backendGet,
  backendPost: vi.fn(),
}));

import { getAssessmentMediaAsset } from "../assessmentMediaApi";

describe("assessment media API", () => {
  beforeEach(() => {
    backendGet.mockReset();
  });

  it("deduplicates concurrent lookups for the same immutable asset", async () => {
    const response = { downloadUrl: "https://cdn.example.test/graph.png" };
    backendGet.mockResolvedValue(response);

    const first = getAssessmentMediaAsset("asset-1");
    const second = getAssessmentMediaAsset("asset-1");

    expect(second).toBe(first);
    await expect(first).resolves.toEqual(response);
    expect(backendGet).toHaveBeenCalledOnce();
  });

  it("evicts failed lookups so a later render can retry", async () => {
    backendGet.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({
      downloadUrl: "https://cdn.example.test/recovered.png",
    });

    await expect(getAssessmentMediaAsset("asset-2")).rejects.toThrow("offline");
    await expect(getAssessmentMediaAsset("asset-2")).resolves.toEqual({
      downloadUrl: "https://cdn.example.test/recovered.png",
    });
    expect(backendGet).toHaveBeenCalledTimes(2);
  });
});
