import { describe, expect, it } from "vitest";
import { SAT_IMAGE_POLICY } from "../domain/imagePolicy";
import {
  validateImageUploadInput,
  validateSatImageFile,
  type BitmapLoader,
} from "../adapters/imageValidation";

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
});
