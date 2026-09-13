import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backendPost } from "../backendBridge";
import {
  ACT_SCIENCE_CHOICE_IMAGE_MAX_BYTES,
  uploadActScienceChoiceImage,
} from "../actScienceChoiceImageService";

vi.mock("../backendBridge", () => ({
  backendPost: vi.fn(),
}));

describe("uploadActScienceChoiceImage", () => {
  beforeEach(() => {
    vi.mocked(backendPost).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates an upload intent, uploads the file, and finalizes the media asset", async () => {
    const uploadResponse = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", uploadResponse);
    vi.mocked(backendPost)
      .mockResolvedValueOnce({
        asset: { id: "asset-1" },
        uploadUrl: "https://media.example/uploads/asset-1",
        headers: { "content-type": "image/png" },
      })
      .mockResolvedValueOnce({
        downloadUrl: "https://media.example/assets/asset-1",
      });

    const file = new File(["fake-image"], "option-a.png", { type: "image/png" });
    const imageUrl = await uploadActScienceChoiceImage(file, "act-science-choice:q1:option-a");

    expect(imageUrl).toBe("https://media.example/assets/asset-1");
    expect(backendPost).toHaveBeenNthCalledWith(1, "/v1/media/uploads", {
      ownerKind: "act_science_choice",
      ownerId: "act-science-choice:q1:option-a",
      contentType: "image/png",
      fileName: "option-a.png",
    });
    expect(uploadResponse).toHaveBeenCalledWith(
      "https://media.example/uploads/asset-1",
      expect.objectContaining({
        method: "PUT",
        headers: { "content-type": "image/png" },
        body: file,
      })
    );
    expect(backendPost).toHaveBeenNthCalledWith(2, "/v1/media/uploads/asset-1/complete", {
      sizeBytes: file.size,
    });
  });

  it("rejects unsupported image types before creating a media asset", async () => {
    const uploadResponse = vi.fn();
    vi.stubGlobal("fetch", uploadResponse);
    const file = new File(["not-image"], "option-a.gif", { type: "image/gif" });

    await expect(uploadActScienceChoiceImage(file, "choice-owner")).rejects.toThrow(
      "Please upload a JPG, PNG, or WebP image."
    );
    expect(backendPost).not.toHaveBeenCalled();
    expect(uploadResponse).not.toHaveBeenCalled();
  });

  it("includes the media server detail when the file upload endpoint fails", async () => {
    const uploadResponse = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: vi
        .fn()
        .mockResolvedValue(JSON.stringify({ error: { message: "media bucket is unavailable" } })),
    });
    vi.stubGlobal("fetch", uploadResponse);
    vi.mocked(backendPost).mockResolvedValueOnce({
      asset: { id: "asset-502" },
      uploadUrl: "https://media.example/uploads/asset-502",
      headers: { "content-type": "image/png" },
    });

    const file = new File(["fake-image"], "option-a.png", { type: "image/png" });

    await expect(uploadActScienceChoiceImage(file, "choice-owner")).rejects.toThrow(
      "Image upload failed with status 502: media bucket is unavailable"
    );
  });

  it("resizes an image larger than 5 MB before creating a media asset", async () => {
    const uploadResponse = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", uploadResponse);
    const bitmap = { width: 4000, height: 3000, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    const clearRect = vi.fn();
    const drawImage = vi.fn();
    const toBlob = vi.fn((callback: BlobCallback, type?: string) => {
      callback(new Blob([new Uint8Array(1024)], { type: type ?? "image/png" }));
    });
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({ clearRect, drawImage }),
      toBlob,
    } as unknown as HTMLCanvasElement;
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
      if (tagName === "canvas") {
        return canvas;
      }
      return originalCreateElement(tagName, options);
    });
    vi.mocked(backendPost)
      .mockResolvedValueOnce({
        asset: { id: "asset-large" },
        uploadUrl: "https://media.example/uploads/asset-large",
        headers: { "content-type": "image/png" },
      })
      .mockResolvedValueOnce({
        downloadUrl: "https://media.example/assets/asset-large",
      });

    const file = new File([new Uint8Array(ACT_SCIENCE_CHOICE_IMAGE_MAX_BYTES + 1)], "large.png", {
      type: "image/png",
    });

    await expect(uploadActScienceChoiceImage(file, "choice-owner")).resolves.toBe(
      "https://media.example/assets/asset-large"
    );
    expect(backendPost).toHaveBeenNthCalledWith(1, "/v1/media/uploads", {
      ownerKind: "act_science_choice",
      ownerId: "choice-owner",
      contentType: "image/png",
      fileName: "large.png",
    });
    expect(uploadResponse).toHaveBeenCalledWith(
      "https://media.example/uploads/asset-large",
      expect.objectContaining({
        method: "PUT",
        body: expect.objectContaining({ size: 1024, type: "image/png" }),
      })
    );
    expect(toBlob).toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, expect.any(Number), expect.any(Number));
    expect(bitmap.close).toHaveBeenCalled();
  });
});
