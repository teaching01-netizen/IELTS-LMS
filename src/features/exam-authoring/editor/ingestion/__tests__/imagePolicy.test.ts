import { describe, expect, it } from "vitest";
import {
  SAT_IMAGE_POLICY,
  isAllowedSatImageMime,
  validateDurableImageSource,
} from "../domain/imagePolicy";

describe("SAT image policy", () => {
  it.each(["image/png", "image/jpeg", "image/webp", "image/gif"])(
    "allows %s",
    (contentType) => {
      expect(isAllowedSatImageMime(contentType)).toBe(true);
    }
  );

  it.each(["image/svg+xml", "image/avif", "application/pdf", ""])(
    "rejects %s",
    (contentType) => {
      expect(isAllowedSatImageMime(contentType)).toBe(false);
    }
  );

  it("uses exact 10 MiB, 8,192 px, and 25 MP boundaries", () => {
    expect(SAT_IMAGE_POLICY.maxBytes).toBe(10 * 1024 * 1024);
    expect(SAT_IMAGE_POLICY.maxDimension).toBe(8_192);
    expect(SAT_IMAGE_POLICY.maxPixels).toBe(25_000_000);
    expect(SAT_IMAGE_POLICY.maxImagesPerPaste).toBe(5);
    expect(SAT_IMAGE_POLICY.maxPasteBytes).toBe(50 * 1024 * 1024);
  });

  it.each([
    "data:image/png;base64,AAAA",
    "blob:https://example.test/id",
    "http://example.test/image.png",
    "javascript:alert(1)",
    "//example.test/image.png",
  ])("rejects unsafe durable source %s", (source) => {
    expect(validateDurableImageSource(source)).toEqual({ ok: false, code: "source" });
  });

  it.each([
    ["https://example.test/image.png", "https"],
    ["/api/v1/media/asset-1/content", "relative"],
    ["550e8400-e29b-41d4-a716-446655440000", "asset"],
  ] as const)("classifies %s as %s", (source, kind) => {
    expect(validateDurableImageSource(source)).toEqual({ ok: true, kind });
  });
});
