import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backendGet = vi.hoisted(() => vi.fn());
const backendPost = vi.hoisted(() => vi.fn());

vi.mock("../../infrastructure/examAuthoringBackendGateway", () => ({
  backendGet,
  backendPost,
}));

import { apiClient } from "../../../../shared/api/apiClient";
import {
  getAssessmentMediaAsset,
  importAssessmentImageUrl,
  uploadAssessmentAsset,
} from "../assessmentMediaApi";

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

    expect(backendPost).toHaveBeenNthCalledWith(
      1,
      "/v1/media/uploads",
      expect.objectContaining({
        ownerKind: "assessment_question",
        ownerId: "question-1",
        contentType: "image/png",
        sizeBytes: file.size,
      })
    );

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

  it.each([
    [
      "PNG",
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      "image/png",
      "source.png",
      "asset-exact-png",
    ],
    [
      "JPEG",
      Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
      "image/jpeg",
      "source.jpg",
      "asset-exact-jpeg",
    ],
  ] as const)(
    "sends the exact %s source bytes and completion metadata without re-encoding",
    async (_label, sourceBytes, contentType, fileName, assetId) => {
      const sourceBuffer = sourceBytes.slice().buffer;
      const digestBytes = Uint8Array.from({ length: 32 }, (_, index) => index);
      const digest = vi.fn().mockResolvedValue(digestBytes.buffer);
      vi.stubGlobal("crypto", { subtle: { digest } });
      const uploadResponse = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
      vi.stubGlobal("fetch", uploadResponse);
      backendPost
        .mockResolvedValueOnce({
          asset: { id: assetId },
          uploadUrl: `/api/v1/media/uploads/${assetId}`,
          headers: { "content-type": contentType },
        })
        .mockResolvedValueOnce({
          id: assetId,
          contentType,
          fileName,
          uploadStatus: "finalized",
          downloadUrl: `/api/v1/media/${assetId}/content`,
        });

      const file = {
        name: fileName,
        size: sourceBytes.byteLength,
        type: contentType,
        arrayBuffer: vi.fn().mockResolvedValue(sourceBuffer),
      } as unknown as File;

      await uploadAssessmentAsset(file, "question-exact-bytes");

      expect(digest).toHaveBeenCalledWith("SHA-256", sourceBuffer);
      const uploadInit = uploadResponse.mock.calls[0]?.[1] as RequestInit;
      expect(uploadInit.body).toBe(file);
      expect(new Uint8Array(await (uploadInit.body as File).arrayBuffer())).toEqual(sourceBytes);
      expect(backendPost).toHaveBeenNthCalledWith(
        2,
        `/v1/media/uploads/${assetId}/complete`,
        {
          sizeBytes: sourceBytes.byteLength,
          checksumSha256: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
        }
      );
    }
  );

  it("rejects unsupported declared MIME before hashing or network upload", async () => {
    const file = {
      name: "diagram.avif",
      size: 11,
      type: "image/avif",
      arrayBuffer: vi.fn(),
    } as unknown as File;

    await expect(uploadAssessmentAsset(file, "question-1")).rejects.toThrow(
      "Use PNG, JPEG, WebP, or GIF images."
    );
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(backendPost).not.toHaveBeenCalled();
  });

  it("imports an HTTPS image through the managed media endpoint", async () => {
    const asset = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      contentType: "image/png",
      fileName: "diagram.png",
      uploadStatus: "finalized",
      downloadUrl: "/api/v1/media/550e8400-e29b-41d4-a716-446655440000/content",
    };
    backendPost.mockResolvedValueOnce(asset);

    await expect(
      importAssessmentImageUrl("https://cdn.example.test/diagram.png", "question-1")
    ).resolves.toEqual(asset);
    expect(backendPost).toHaveBeenCalledWith("/v1/media/import-url", {
      ownerKind: "assessment_question",
      ownerId: "question-1",
      url: "https://cdn.example.test/diagram.png",
    });
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
