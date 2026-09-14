import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backendGet = vi.hoisted(() => vi.fn());
const backendPost = vi.hoisted(() => vi.fn());

vi.mock("../../infrastructure/examAuthoringBackendGateway", () => ({
  backendGet,
  backendPost,
}));

import { apiClient } from "../../../../shared/api/apiClient";
import { getAssessmentMediaAsset, uploadAssessmentAsset } from "../assessmentMediaApi";

describe("assessment media API", () => {
  beforeEach(() => {
    backendGet.mockReset();
    backendPost.mockReset();
  });

  afterEach(() => {
    apiClient.clearCsrfToken();
    document.cookie = "csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    vi.unstubAllGlobals();
  });

  it("sends CSRF on same-origin binary uploads", async () => {
    document.cookie = "csrf=live-cookie-token; path=/";
    vi.stubGlobal("crypto", {
      subtle: { digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)) },
    });
    const uploadResponse = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", uploadResponse);
    backendPost
      .mockResolvedValueOnce({
        asset: { id: "asset-1" },
        uploadUrl: "/api/v1/media/uploads/asset-1",
        headers: { "content-type": "image/png" },
      })
      .mockResolvedValueOnce({
        id: "asset-1",
        contentType: "image/png",
        fileName: "graph.png",
        uploadStatus: "finalized",
        downloadUrl: "/api/v1/media/asset-1/content",
      });

    const file = {
      name: "graph.png",
      size: 11,
      type: "image/png",
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(11)),
    } as unknown as File;
    await uploadAssessmentAsset(file, "question-1");

    expect(uploadResponse).toHaveBeenCalledWith(
      "/api/v1/media/uploads/asset-1",
      expect.objectContaining({
        method: "PUT",
        credentials: "same-origin",
        headers: {
          "content-type": "image/png",
          "x-csrf-token": "live-cookie-token",
        },
        body: file,
      })
    );
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
