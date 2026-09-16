import { describe, expect, it } from "vitest";
import { SAT_IMAGE_POLICY } from "../domain/imagePolicy";
import { validateImageUploadInput, validateSatImageFile, type BitmapLoader } from "../adapters/imageValidation";
import { importImageSource } from "../application/imageImport";

const PNG_HEAD = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

function imageFile(size = PNG_HEAD.byteLength, type = "image/png"): File {
  const file = new File([PNG_HEAD as unknown as BlobPart], "diagram.png", { type });
  Object.defineProperty(file, "size", { value: size, configurable: true });
  return file;
}

const testBitmapLoader: BitmapLoader = async () => ({ width: 120, height: 80 });

describe("SAT image file import gate", () => {
  it("accepts a policy-compliant file through the dialog validator", async () => {
    await expect(validateImageUploadInput(imageFile(), testBitmapLoader)).resolves.toMatchObject({
      ok: true,
      mime: "image/png",
      width: 120,
      height: 80,
    });
  });

  it("keeps dialog and paste rejection codes aligned", async () => {
    const file = imageFile(SAT_IMAGE_POLICY.maxBytes + 1);
    const [paste, dialog] = await Promise.all([
      validateSatImageFile(file, testBitmapLoader),
      validateImageUploadInput(file, testBitmapLoader),
    ]);

    expect(paste).toMatchObject({ ok: false, code: "size" });
    expect(dialog).toMatchObject({ ok: false, code: "size" });
  });

  it("rejects unsafe URL values before persistence", async () => {
    const importUrl = async () => {
      throw new Error("must not persist");
    };

    for (const source of [
      "data:image/png;base64,AAAA",
      "blob:https://example.test/id",
      "http://example.test/image.png",
      "javascript:alert(1)",
    ]) {
      await expect(
        importImageSource({ source, ownerId: "q-1", deps: { importUrl } })
      ).rejects.toMatchObject({ code: "source" });
    }
  });

  it("imports an HTTPS image as a managed asset", async () => {
    const imported = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      contentType: "image/png",
      fileName: "diagram.png",
      uploadStatus: "finalized",
      downloadUrl: "/api/v1/media/550e8400-e29b-41d4-a716-446655440000/content",
    };
    const importUrl = async (url: string, ownerId: string) => {
      expect(url).toBe("https://cdn.example.test/diagram.png");
      expect(ownerId).toBe("q-1");
      return imported;
    };

    await expect(
      importImageSource({
        source: "https://cdn.example.test/diagram.png",
        ownerId: "q-1",
        deps: { importUrl },
      })
    ).resolves.toEqual(imported);
  });

  it("resolves an existing managed asset without importing its URL", async () => {
    const asset = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      contentType: "image/png",
      fileName: "diagram.png",
      uploadStatus: "finalized",
      downloadUrl: "/api/v1/media/550e8400-e29b-41d4-a716-446655440000/content",
    };
    const getAsset = async (assetId: string) => {
      expect(assetId).toBe(asset.id);
      return asset;
    };
    const importUrl = async () => {
      throw new Error("must not import an asset ID");
    };

    await expect(
      importImageSource({ source: asset.id, ownerId: "q-1", deps: { getAsset, importUrl } })
    ).resolves.toEqual(asset);
  });
});
