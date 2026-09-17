import { describe, expect, it } from "vitest";
import {
  CLIPBOARD_IMAGE_FINGERPRINT_GRID,
  CLIPBOARD_IMAGE_MAX_HASH_DISTANCE,
  clipboardImageHashDistance,
  clipboardImageLuminanceDelta,
  isSameClipboardImageBytes,
  isSameClipboardImageFingerprint,
  luminanceSamplesFromRgba,
  type ClipboardImageBytes,
  type ClipboardImageFingerprint,
} from "../domain/clipboardImageIdentity";
import { reconcileClipboardImageRepresentations } from "../application/reconcileClipboardImages";
import type { PendingImage } from "../application/ingestClipboard";
import type { HtmlImageRef } from "../adapters/htmlImageRefs";
import type { TextHtmlImageRef } from "../adapters/textHtml";

const PNG_SIG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const OTHER_PNG = Uint8Array.from([...PNG_SIG, 0x01]);

/** A plausible 16x16 luminance grid used by the injected fingerprint fakes. */
const visualFingerprint: ClipboardImageFingerprint = {
  width: 800,
  height: 600,
  luminance: Array.from({ length: 16 * 16 }, (_, index) => (index % 9) * 12 + (index % 5) * 7),
};

/** One picture, re-encoded: the same structure with a small tonal shift. */
const reEncodedFingerprint: ClipboardImageFingerprint = {
  ...visualFingerprint,
  luminance: visualFingerprint.luminance.map((value) => value + 3),
};

/** A clearly different picture with the same decoded shape. */
const differentFingerprint: ClipboardImageFingerprint = {
  ...visualFingerprint,
  luminance: visualFingerprint.luminance.map((_, index) => (index % 2 === 0 ? 0 : 255)),
};

function png(name: string, bytes: Uint8Array = PNG_SIG): File {
  return new File([bytes], name, { type: "image/png" });
}

function pending(refId: string, file: File, alt = ""): PendingImage {
  return { refId, file, alt };
}

function refBytes(size: number, type = "image/png", bytes: Uint8Array = PNG_SIG): ClipboardImageBytes {
  return { size, type, readBytes: async () => bytes };
}

function imageRefs(entries: Array<[string, TextHtmlImageRef]>): ReadonlyMap<string, TextHtmlImageRef> {
  return new Map(entries);
}

describe("clipboard image byte identity", () => {
  it("treats identical bytes with the same MIME as the same image", async () => {
    await expect(isSameClipboardImageBytes(refBytes(PNG_SIG.byteLength), refBytes(PNG_SIG.byteLength))).resolves.toBe(
      true
    );
  });

  it("compares a real clipboard File against a fetched representation", async () => {
    const outcome = await reconcileClipboardImageRepresentations({
      files: [pending("clipboard-image-0", png("a.png"))],
      refs: [{ refId: "html-image-0", src: "data:image/png;base64,AA==", alt: "" }],
      htmlImages: [pending("html-image-0", png("pasted-image.png"))],
      imageRefs: imageRefs([
        ["html-image-0", { refId: "html-image-0", blobRef: null, alt: "" }],
      ]),
    });
    expect(outcome.reconciled).toBe(1);
  });

  it("rejects different bytes, MIME, length, and empty content", async () => {
    await expect(
      isSameClipboardImageBytes(refBytes(OTHER_PNG.byteLength, "image/png", OTHER_PNG), refBytes(PNG_SIG.byteLength))
    ).resolves.toBe(false);
    await expect(
      isSameClipboardImageBytes(refBytes(PNG_SIG.byteLength, "image/jpeg"), refBytes(PNG_SIG.byteLength))
    ).resolves.toBe(false);
    await expect(isSameClipboardImageBytes(refBytes(4), refBytes(8))).resolves.toBe(false);
    await expect(
      isSameClipboardImageBytes(
        { size: 0, type: "image/png", readBytes: async () => new Uint8Array() },
        { size: 0, type: "image/png", readBytes: async () => new Uint8Array() }
      )
    ).resolves.toBe(false);
  });
});

describe("clipboard image visual fingerprint math", () => {
  function sampleRender(size: number, rgbaAt: (x: number, y: number) => [number, number, number, number]) {
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const [r, g, b, a] = rgbaAt(x, y);
        const offset = (y * size + x) * 4;
        data[offset] = r;
        data[offset + 1] = g;
        data[offset + 2] = b;
        data[offset + 3] = a;
      }
    }
    return data;
  }

  function fingerprint(luminance: number[], width = 800, height = 600): ClipboardImageFingerprint {
    return { width, height, luminance };
  }

  it("averages render pixels into row-major grid cells with luminance weights", () => {
    // 4x4 render into a 2x2 grid: one cell per 2x2 pixel block.
    const data = sampleRender(4, (x, y) => (x < 2 && y < 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    expect(luminanceSamplesFromRgba(data, 4, 2)).toEqual([0, 255, 255, 255]);

    // RGB weights: red 0.299, green 0.587, blue 0.114.
    const red = luminanceSamplesFromRgba(sampleRender(2, () => [255, 0, 0, 255]), 2, 1) ?? [];
    const green = luminanceSamplesFromRgba(sampleRender(2, () => [0, 255, 0, 255]), 2, 1) ?? [];
    const blue = luminanceSamplesFromRgba(sampleRender(2, () => [0, 0, 255, 255]), 2, 1) ?? [];
    expect(red[0]).toBeCloseTo(76.245, 3);
    expect(green[0]).toBeCloseTo(149.685, 3);
    expect(blue[0]).toBeCloseTo(29.07, 3);
  });

  it("rejects a render or buffer it cannot sample", () => {
    expect(luminanceSamplesFromRgba(new Uint8ClampedArray(64), 8, 3)).toBeNull();
    expect(luminanceSamplesFromRgba(new Uint8ClampedArray(4), 4, 4)).toBeNull();
    expect(luminanceSamplesFromRgba(new Uint8ClampedArray(64), 0, 4)).toBeNull();
    expect(luminanceSamplesFromRgba(new Uint8ClampedArray(0), 2, 1)).toBeNull();
  });

  it("measures hash distance and luminance delta, and keeps them zero for one image", () => {
    const samples = Array.from({ length: 16 }, (_, index) => 20 + (index % 4) * 30);
    expect(clipboardImageHashDistance(samples, samples, 4)).toBe(0);
    expect(clipboardImageLuminanceDelta(samples, samples)).toBe(0);

    const shifted = samples.map((value) => value + 40);
    expect(clipboardImageLuminanceDelta(samples, shifted)).toBe(40);
    expect(clipboardImageHashDistance(samples, shifted, 4)).toBe(0);

    const reversedRows = samples.map((value, index) => {
      const row = Math.floor(index / 4);
      const column = index % 4;
      return samples[row * 4 + (3 - column)] ?? value;
    });
    expect(clipboardImageHashDistance(samples, reversedRows, 4)).toBeGreaterThan(
      CLIPBOARD_IMAGE_MAX_HASH_DISTANCE
    );
  });

  it("accepts a re-encode of one picture and rejects a different picture or shape", () => {
    const base = Array.from({ length: CLIPBOARD_IMAGE_FINGERPRINT_GRID ** 2 }, (_, index) =>
      (index % 7) * 9 + (Math.floor(index / CLIPBOARD_IMAGE_FINGERPRINT_GRID) % 5) * 4
    );
    const reEncoded = base.map((value) => value + 3);

    expect(isSameClipboardImageFingerprint(fingerprint(base), fingerprint(base))).toBe(true);
    expect(isSameClipboardImageFingerprint(fingerprint(base), fingerprint(reEncoded))).toBe(true);

    // Different shape: never the same picture, even with identical samples.
    expect(isSameClipboardImageFingerprint(fingerprint(base), fingerprint(base, 640, 480))).toBe(false);
    // Clearly different structure.
    const different = base.map((value, index) => (index % 2 === 0 ? value : 255 - value));
    expect(isSameClipboardImageFingerprint(fingerprint(base), fingerprint(different))).toBe(false);
    // Localized heavy change: luminance delta leaves the tight bound.
    const localized = base.map((value, index) => (index < 8 ? 255 : value));
    expect(isSameClipboardImageFingerprint(fingerprint(base), fingerprint(localized))).toBe(false);
    // Degenerate inputs never collapse.
    expect(isSameClipboardImageFingerprint(fingerprint([], 0, 0), fingerprint([], 0, 0))).toBe(false);
    expect(isSameClipboardImageFingerprint(fingerprint([1, 2, 3]), fingerprint([1, 2, 3]))).toBe(false);
  });
});

describe("clipboard representation reconciliation", () => {
  const refs: HtmlImageRef[] = [{ refId: "html-image-0", src: "https://cdn.test/copy.png", alt: "Copied visual" }];

  it("folds a duplicate HTML image into the direct file and keeps position and alt", async () => {
    const file = png("copy.png", OTHER_PNG);
    const outcome = await reconcileClipboardImageRepresentations({
      files: [pending("clipboard-image-0", file)],
      refs,
      htmlImages: [pending("html-image-0", png("pasted-image.png", OTHER_PNG), "Copied visual")],
      imageRefs: imageRefs([
        [
          "html-image-0",
          {
            refId: "html-image-0",
            blobRef: { id: "html-image-0", mimeType: "image/png", sizeBytes: OTHER_PNG.byteLength },
            alt: "Copied visual",
          },
        ],
      ]),
    });

    expect(outcome.reconciled).toBe(1);
    expect(outcome.htmlImages).toEqual([]);
    expect(outcome.files).toHaveLength(1);
    expect(outcome.files[0]?.file).toBe(file);
    expect(outcome.files[0]?.alt).toBe("Copied visual");
    expect(outcome.imageRefs.get("html-image-0")).toEqual({
      refId: "clipboard-image-0",
      blobRef: { id: "clipboard-image-0", mimeType: "image/png", sizeBytes: OTHER_PNG.byteLength },
      alt: "Copied visual",
    });
  });

  it("leaves representations with different bytes alone", async () => {
    const outcome = await reconcileClipboardImageRepresentations({
      files: [pending("clipboard-image-0", png("a.png"))],
      refs,
      htmlImages: [pending("html-image-0", png("pasted-image.png", OTHER_PNG), "Copied visual")],
      imageRefs: imageRefs([
        [
          "html-image-0",
          { refId: "html-image-0", blobRef: { id: "html-image-0", mimeType: "image/png", sizeBytes: 9 }, alt: "" },
        ],
      ]),
    });

    expect(outcome.reconciled).toBe(0);
    expect(outcome.files[0]?.alt).toBe("");
    expect(outcome.htmlImages).toHaveLength(1);
    expect(outcome.imageRefs.get("html-image-0")?.refId).toBe("html-image-0");
  });

  it("does nothing for single-representation pastes or unmatched refs", async () => {
    const fileOnly = await reconcileClipboardImageRepresentations({
      files: [pending("clipboard-image-0", png("a.png"))],
      refs: [],
      htmlImages: [],
      imageRefs: new Map(),
    });
    expect(fileOnly.reconciled).toBe(0);
    expect(fileOnly.files).toHaveLength(1);

    const htmlOnly = await reconcileClipboardImageRepresentations({
      files: [],
      refs,
      htmlImages: [pending("html-image-0", png("b.png"))],
      imageRefs: new Map(),
    });
    expect(htmlOnly.reconciled).toBe(0);
    expect(htmlOnly.htmlImages).toHaveLength(1);
  });

  it("folds a re-encoded representation once the visual fingerprint matches", async () => {
    const file = png("re-encoded.png", OTHER_PNG);
    const htmlImage = png("pasted-image.png");
    const outcome = await reconcileClipboardImageRepresentations(
      {
        files: [pending("clipboard-image-0", file)],
        refs,
        htmlImages: [pending("html-image-0", htmlImage, "Copied visual")],
        imageRefs: imageRefs([
          ["html-image-0", { refId: "html-image-0", blobRef: null, alt: "Copied visual" }],
        ]),
      },
      // Different bytes, same picture.
      {
        fingerprint: async (file) =>
          file.name === "pasted-image.png" ? reEncodedFingerprint : visualFingerprint,
      }
    );

    expect(outcome.reconciled).toBe(1);
    expect(outcome.reconciledByVisualFingerprint).toBe(1);
    expect(outcome.htmlImages).toEqual([]);
    expect(outcome.files[0]?.alt).toBe("Copied visual");
    expect(outcome.imageRefs.get("html-image-0")?.refId).toBe("clipboard-image-0");
  });

  it("prefers a byte-identical file over a visually similar one", async () => {
    const reEncoded = png("re-encoded.png", OTHER_PNG);
    const exact = png("exact.png");
    const outcome = await reconcileClipboardImageRepresentations(
      {
        files: [pending("clipboard-image-0", reEncoded), pending("clipboard-image-1", exact)],
        refs,
        htmlImages: [pending("html-image-0", png("pasted-image.png"), "Copied visual")],
        imageRefs: imageRefs([
          ["html-image-0", { refId: "html-image-0", blobRef: null, alt: "Copied visual" }],
        ]),
      },
      {
        fingerprint: async (file) =>
          file.name === "pasted-image.png" ? reEncodedFingerprint : visualFingerprint,
      }
    );

    expect(outcome.reconciled).toBe(1);
    expect(outcome.reconciledByVisualFingerprint).toBe(0);
    expect(outcome.files.map((item) => item.refId)).toEqual(["clipboard-image-0", "clipboard-image-1"]);
    expect(outcome.imageRefs.get("html-image-0")?.refId).toBe("clipboard-image-1");
  });

  it("never folds on a mismatched, failing, or unavailable fingerprint", async () => {
    const buildReEncoded = (fingerprint: (file: File) => Promise<ClipboardImageFingerprint | null>) =>
      reconcileClipboardImageRepresentations(
        {
          files: [pending("clipboard-image-0", png("a.png", OTHER_PNG))],
          refs,
          htmlImages: [pending("html-image-0", png("b.png"), "Copied visual")],
          imageRefs: imageRefs([
            ["html-image-0", { refId: "html-image-0", blobRef: null, alt: "Copied visual" }],
          ]),
        },
        { fingerprint }
      );

    const different = await buildReEncoded(async (file) =>
      file.name === "b.png" ? differentFingerprint : visualFingerprint
    );
    expect(different.reconciled).toBe(0);
    expect(different.reconciledByVisualFingerprint).toBe(0);
    expect(different.files[0]?.alt).toBe("");
    expect(different.htmlImages).toHaveLength(1);

    const unavailable = await buildReEncoded(async () => null);
    expect(unavailable.reconciled).toBe(0);
    expect(unavailable.htmlImages).toHaveLength(1);

    const failing = await buildReEncoded(async () => {
      throw new Error("no canvas");
    });
    expect(failing.reconciled).toBe(0);
    expect(failing.htmlImages).toHaveLength(1);
  });

  it("absorbs one HTML representation per direct file and keeps extra occurrences", async () => {
    const first = png("one.png");
    const second = png("two.png", OTHER_PNG);
    const outcome = await reconcileClipboardImageRepresentations({
      files: [pending("clipboard-image-0", first), pending("clipboard-image-1", second)],
      refs: [
        { refId: "html-image-0", src: "https://cdn.test/one.png", alt: "One" },
        { refId: "html-image-0-occurrence-1", src: "https://cdn.test/one.png", alt: "One again" },
      ],
      htmlImages: [
        pending("html-image-0", png("pasted-image.png"), "One"),
        pending("html-image-0-occurrence-1", png("pasted-image.png"), "One again"),
      ],
      imageRefs: imageRefs([
        ["html-image-0", { refId: "html-image-0", blobRef: null, alt: "One" }],
        ["html-image-0-occurrence-1", { refId: "html-image-0-occurrence-1", blobRef: null, alt: "One again" }],
      ]),
    });

    expect(outcome.reconciled).toBe(1);
    expect(outcome.files.map((file) => file.alt)).toEqual(["One", ""]);
    expect(outcome.htmlImages.map((image) => image.refId)).toEqual(["html-image-0-occurrence-1"]);
    expect(outcome.imageRefs.get("html-image-0")?.refId).toBe("clipboard-image-0");
    expect(outcome.imageRefs.get("html-image-0-occurrence-1")?.refId).toBe("html-image-0-occurrence-1");
  });
});
