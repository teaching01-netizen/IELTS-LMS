/**
 * Phase 06 — pure image validation tests.
 *
 * createImageBitmap is stubbed/mocked throughout: the pure module only
 * receives loaders via injection, so these tests run deterministically in
 * node/jsdom without decoding real bytes.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { RichTextDocument } from "../../../contracts/assessment";
import { SAT_IMAGE_POLICY } from "../domain/imagePolicy";
import {
  IMAGE_CAPS,
  buildResolvedImageAttrs,
  buildTransientImageAttrs,
  defaultBitmapLoaderFactory,
  loadBitmapSize,
  readMagicBytes,
  stripTransientImages,
  validateImageUploadInput,
  validateSatImageFile,
  validateClipboardImage,
  type BitmapLoader,
} from "../adapters/imageValidation";

function pngBytes(): Uint8Array {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
}

function jpegBytes(): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
}

function gifBytes(): Uint8Array {
  return Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00]);
}

function webpBytes(): Uint8Array {
  // RIFF....WEBP
  return Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
}

function makeFile(bytes: Uint8Array, name: string, type: string, sizeOverride?: number): File {
  const file = new File([bytes as unknown as BlobPart], name, { type });
  if (sizeOverride !== undefined) {
    Object.defineProperty(file, "size", { value: sizeOverride, configurable: true });
  }
  return file;
}

function sizeLoader(width: number, height: number): BitmapLoader {
  return async () => ({ width, height, close: () => {} });
}

describe("readMagicBytes", () => {
  it("reads png/jpeg/gif/webp signatures as hex", async () => {
    expect(await readMagicBytes(makeFile(pngBytes(), "a.png", "image/png"))).toBe(
      "89504e470d0a1a0a0000000d"
    );
    expect(
      (await readMagicBytes(makeFile(jpegBytes(), "a.jpg", "image/jpeg"))).startsWith("ffd8ff")
    ).toBe(true);
    expect(
      (await readMagicBytes(makeFile(gifBytes(), "a.gif", "image/gif"))).startsWith("47494638")
    ).toBe(true);
    expect(await readMagicBytes(makeFile(webpBytes(), "a.webp", "image/webp"))).toBe(
      "524946462400000057454250"
    );
  });

  it("returns empty string instead of throwing on unreadable files", async () => {
    const broken = makeFile(pngBytes(), "a.png", "image/png");
    (broken as unknown as { slice: () => never }).slice = () => {
      throw new Error("no slice");
    };
    expect(await readMagicBytes(broken)).toBe("");
  });
});

describe("validateSatImageFile allowlist", () => {
  const table: Array<[string, Uint8Array, string]> = [
    ["image/png", pngBytes(), "photo.png"],
    ["image/jpeg", jpegBytes(), "photo.jpg"],
    ["image/webp", webpBytes(), "graph.webp"],
    ["image/gif", gifBytes(), "anim.gif"],
  ];

  for (const [mime, bytes, name] of table) {
    it("accepts " + mime, async () => {
      const out = await validateClipboardImage(makeFile(bytes, name, mime), sizeLoader(100, 80));
      expect(out.ok).toBe(true);
      if (out.ok) {
        expect(out.mime).toBe(mime);
        expect(out.width).toBe(100);
        expect(out.pixels).toBe(8000);
      }
    });
  }

  it("rejects unsupported mime types without touching the loader", async () => {
    let called = 0;
    const loader: BitmapLoader = async () => {
      called += 1;
      return { width: 10, height: 10 };
    };
    const out = await validateClipboardImage(makeFile(pngBytes(), "a.bmp", "image/bmp"), loader);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe("type");
      expect(out.message).toBe("That file is not a supported image (PNG, JPEG, WebP, GIF).");
    }
    expect(called).toBe(0);
  });

  it("rejects empty mime as mime", async () => {
    const out = await validateClipboardImage(makeFile(pngBytes(), "a", ""), sizeLoader(4, 4));
    expect(out).toMatchObject({ ok: false, code: "type" });
  });
});

describe("validateClipboardImage magic/mime matrix", () => {
  it("rejects text bytes wearing an image MIME", async () => {
    const text = new TextEncoder().encode("hello world!");
    const out = await validateClipboardImage(
      makeFile(text, "mime-spoof.png", "image/png"),
      sizeLoader(4, 4)
    );
    expect(out).toMatchObject({
      ok: false,
      code: "magic",
      message: "That file is not a supported image (PNG, JPEG, WebP, GIF).",
    });
  });

  it("rejects a jpg that is actually webp bytes (family must match)", async () => {
    const out = await validateClipboardImage(
      makeFile(webpBytes(), "photo.jpg", "image/jpeg"),
      sizeLoader(4, 4)
    );
    expect(out).toMatchObject({ ok: false, code: "magic" });
  });

  it("rejects a png that is actually jpeg bytes", async () => {
    const out = await validateClipboardImage(
      makeFile(jpegBytes(), "photo.png", "image/png"),
      sizeLoader(4, 4)
    );
    expect(out).toMatchObject({ ok: false, code: "magic" });
  });

  it("rejects a truncated header that cannot classify", async () => {
    const out = await validateClipboardImage(
      makeFile(Uint8Array.from([0x89, 0x50]), "cut.png", "image/png"),
      sizeLoader(4, 4)
    );
    expect(out).toMatchObject({ ok: false, code: "magic" });
  });
});

describe("validateClipboardImage size boundary", () => {
  it("rejects 10 MiB + 1 byte with the API-consistent message", async () => {
    let called = 0;
    const loader: BitmapLoader = async () => {
      called += 1;
      return { width: 8, height: 8 };
    };
    const out = await validateClipboardImage(
      makeFile(pngBytes(), "big.png", "image/png", IMAGE_CAPS.maxBytes + 1),
      loader
    );
    expect(out).toMatchObject({
      ok: false,
      code: "size",
      message: "Images must be 10 MiB or smaller.",
    });
    expect(called).toBe(0);
  });

  it("accepts exactly 10 MiB", async () => {
    const out = await validateClipboardImage(
      makeFile(pngBytes(), "edge.png", "image/png", IMAGE_CAPS.maxBytes),
      sizeLoader(8, 8)
    );
    expect(out.ok).toBe(true);
  });
});

describe("shared SAT file validation boundaries", () => {
  it.each([
    [SAT_IMAGE_POLICY.maxBytes + 1, "size"],
    [SAT_IMAGE_POLICY.maxBytes, null],
  ] as const)("uses the same byte boundary for clipboard and dialog files", async (size, code) => {
    const file = makeFile(pngBytes(), "edge.png", "image/png", size);
    const clipboard = await validateSatImageFile(file, sizeLoader(8, 8));
    const dialog = await validateImageUploadInput(file, sizeLoader(8, 8));

    expect(clipboard.ok ? null : clipboard.code).toBe(code);
    expect(dialog.ok ? null : dialog.code).toBe(code);
  });

  it("rejects unsupported declared MIME before decoding", async () => {
    const file = makeFile(pngBytes(), "diagram.avif", "image/avif");

    await expect(validateSatImageFile(file, sizeLoader(8, 8))).resolves.toMatchObject({
      ok: false,
      code: "type",
    });
  });
});

describe("validateClipboardImage dimension/pixel boundaries", () => {
  it("rejects a 9 000 x 100 strip on dimensions", async () => {
    const out = await validateClipboardImage(
      makeFile(pngBytes(), "strip.png", "image/png"),
      sizeLoader(9_000, 100)
    );
    expect(out).toMatchObject({
      ok: false,
      code: "dimensions",
      message: "That image is too large to paste (limit 8,192 px per side, 25 megapixels).",
    });
  });

  it("accepts exactly 8 192 px per side when pixels fit", async () => {
    // 8_192 x 3_000 = 24.576M pixels < 25MP cap.
    const out = await validateClipboardImage(
      makeFile(pngBytes(), "edge.png", "image/png"),
      sizeLoader(8_192, 3_000)
    );
    expect(out.ok).toBe(true);
  });

  it("rejects 6000 x 6000 (36 MP) on pixels", async () => {
    const out = await validateClipboardImage(
      makeFile(pngBytes(), "mega.png", "image/png"),
      sizeLoader(6000, 6000)
    );
    expect(out).toMatchObject({
      ok: false,
      code: "pixels",
      message: "That image is too large to paste (limit 8,192 px per side, 25 megapixels).",
    });
  });
});

describe("validateClipboardImage decode failures", () => {
  it("maps a loader throw to decode", async () => {
    const loader: BitmapLoader = async () => {
      throw new Error("boom");
    };
    const out = await validateClipboardImage(
      makeFile(pngBytes(), "photo.png", "image/png"),
      loader
    );
    expect(out).toMatchObject({
      ok: false,
      code: "decode",
      message: "That image could not be read. Try re-exporting it.",
    });
  });

  it("maps a missing loader (no-DOM fallback) to decode", async () => {
    const out = await validateClipboardImage(makeFile(pngBytes(), "photo.png", "image/png"), null);
    expect(out).toMatchObject({ ok: false, code: "decode" });
  });

  it("maps an undecodable body (valid header) to decode", async () => {
    const loader: BitmapLoader = async () => {
      throw new DOMException("truncated", "EncodingError");
    };
    const jpegTruncated = await validateClipboardImage(
      makeFile(jpegBytes(), "truncated.jpg", "image/jpeg"),
      loader
    );
    expect(jpegTruncated).toMatchObject({ ok: false, code: "decode" });
  });

  it("maps non-positive loader dimensions to decode", async () => {
    const out = await validateClipboardImage(
      makeFile(pngBytes(), "a.png", "image/png"),
      sizeLoader(0, 10)
    );
    expect(out).toMatchObject({ ok: false, code: "decode" });
  });
});

describe("golden fixtures (__fixtures__/images)", () => {
  const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__", "images");
  function loadFixture(name: string, mime: string): File {
    const bytes = readFileSync(join(DIR, name));
    return new File([new Uint8Array(bytes) as unknown as BlobPart], name, { type: mime });
  }

  it("classifies real fixture headers by magic family", async () => {
    expect(await readMagicBytes(loadFixture("photo.png", "image/png"))).toMatch(/^89504e47/);
    expect(await readMagicBytes(loadFixture("graph.jpg", "image/jpeg"))).toMatch(/^ffd8ff/);
    expect(await readMagicBytes(loadFixture("diagram.webp", "image/webp"))).toMatch(/^52494646/);
    expect(await readMagicBytes(loadFixture("anim.gif", "image/gif"))).toMatch(/^47494638/);
  });

  it("accepts tiny-1x1.png end to end with a stubbed loader", async () => {
    const out = await validateClipboardImage(
      loadFixture("tiny-1x1.png", "image/png"),
      sizeLoader(1, 1)
    );
    expect(out.ok).toBe(true);
  });

  it("rejects the mime-spoof fixture (text bytes, image MIME)", async () => {
    const out = await validateClipboardImage(
      loadFixture("mime-spoof.png", "image/png"),
      sizeLoader(4, 4)
    );
    expect(out).toMatchObject({ ok: false, code: "magic" });
  });

  it("classifies truncated.jpg header but fails at the decode stage", async () => {
    const truncated = loadFixture("truncated.jpg", "image/jpeg");
    // Real-decode envs would fail here on the cut body; in jsdom the header
    // still classifies as jpeg, and a throwing loader stands in for decode.
    expect(await readMagicBytes(truncated)).toMatch(/^ffd8ff/);
    const throwing: BitmapLoader = async () => {
      throw new Error("cut body");
    };
    expect(await validateClipboardImage(truncated, throwing)).toMatchObject({
      ok: false,
      code: "decode",
    });
  });

  it("skips real-bitmap decode when createImageBitmap is unavailable", () => {
    // jsdom/node guard: golden decode through the REAL loader runs only in a
    // browser-capable env; here we assert the skip condition holds.
    expect(typeof (globalThis as Record<string, unknown>)["createImageBitmap"]).not.toBe(
      "function"
    );
  });
});

describe("loadBitmapSize", () => {
  it("closes the bitmap after reading", async () => {
    let closed = 0;
    const loader: BitmapLoader = async () => ({
      width: 12,
      height: 9,
      close: () => {
        closed += 1;
      },
    });
    const size = await loadBitmapSize(makeFile(pngBytes(), "a.png", "image/png"), loader);
    expect(size).toEqual({ width: 12, height: 9 });
    expect(closed).toBe(1);
  });

  it("times out a hanging loader", async () => {
    const loader: BitmapLoader = () => new Promise(() => {});
    const size = await loadBitmapSize(makeFile(pngBytes(), "a.png", "image/png"), loader, 5);
    expect(size).toBeNull();
  });

  it("closes a bitmap that resolves after the timeout exactly once", async () => {
    let resolveBitmap!: (value: { width: number; height: number; close: () => void }) => void;
    let closed = 0;
    const loader: BitmapLoader = () =>
      new Promise((resolve) => {
        resolveBitmap = resolve;
      });

    const pending = loadBitmapSize(makeFile(pngBytes(), "late.png", "image/png"), loader, 5);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(pending).resolves.toBeNull();

    resolveBitmap({
      width: 12,
      height: 9,
      close: () => {
        closed += 1;
      },
    });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(closed).toBe(1);
  });

  it("revokes a fallback object URL on timeout without double-revoking on late load", async () => {
    let triggerLoad: (() => void) | null = null;
    class FakeImage {
      width = 12;
      height = 9;
      naturalWidth = 12;
      naturalHeight = 9;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        triggerLoad = () => this.onload?.();
      }
    }
    const createObjectURL = vi.fn(() => "blob:validation");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    try {
      const loader = defaultBitmapLoaderFactory();
      expect(loader).not.toBeNull();
      const pending = loadBitmapSize(
        makeFile(pngBytes(), "late.png", "image/png"),
        loader,
        5
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      await expect(pending).resolves.toBeNull();
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
      triggerLoad?.();
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("attr builders", () => {
  it("builds transient attrs with empty alt for the validator gate", () => {
    expect(buildTransientImageAttrs("id-1", "blob:abc")).toEqual({
      uploadId: "id-1",
      uploading: true,
      uploadError: null,
      src: "blob:abc",
      alt: "",
      assetId: null,
      caption: null,
    });
  });

  it("builds resolved attrs preferring the asset downloadUrl", () => {
    expect(
      buildResolvedImageAttrs(
        { id: "550e8400-e29b-41d4-a716-446655440001", downloadUrl: "https://cdn.test/a.png" },
        "blob:abc"
      )
    ).toEqual({
      assetId: "550e8400-e29b-41d4-a716-446655440001",
      src: "https://cdn.test/a.png",
      uploading: false,
      uploadError: null,
      uploadId: null,
    });
  });

  it("keeps only the asset identity when no download URL is available", () => {
    const out = buildResolvedImageAttrs(
      { id: "550e8400-e29b-41d4-a716-446655440001", downloadUrl: null },
      "blob:abc"
    );
    expect(out.src).toBe("");
    expect(out.assetId).toBe("550e8400-e29b-41d4-a716-446655440001");
  });
});

describe("stripTransientImages", () => {
  it("keeps an uploaded asset but removes a stale local source", () => {
    const result = stripTransientImages({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { assetId: "550e8400-e29b-41d4-a716-446655440001", src: "blob:revoked" },
        },
      ],
    });
    expect(result.doc.content?.[0]?.attrs).toEqual({
      assetId: "550e8400-e29b-41d4-a716-446655440001",
      src: "",
    });
  });

  it("removes placeholders nested inside table cells without mutating the input", () => {
    const source: RichTextDocument = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    { type: "paragraph" },
                    { type: "image", attrs: { uploading: true, src: "blob:nested" } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = stripTransientImages(source);
    expect(result.dropped).toBe(1);
    expect(JSON.stringify(result.doc)).not.toContain("blob:");
    expect(JSON.stringify(source)).toContain("blob:nested");
  });

  function doc(): RichTextDocument {
    return {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "before" }] },
        {
          type: "image",
          attrs: { src: "blob:temp", uploading: true, uploadId: "u-1", assetId: null, alt: "" },
        },
        {
          type: "image",
          attrs: {
            src: "https://cdn.test/real.png",
            assetId: "550e8400-e29b-41d4-a716-446655440009",
            alt: "graph",
            uploading: false,
          },
        },
        {
          type: "image",
          attrs: { src: "data:image/png;base64,AAAA", assetId: null, alt: "" },
        },
        { type: "paragraph", content: [{ type: "text", text: "after" }] },
      ],
    };
  }

  it("removes temp nodes, keeps resolved ones, counts, preserves blocks", () => {
    const out = stripTransientImages(doc());
    expect(out.dropped).toBe(2);
    expect(out.doc.content?.map((n) => n.type)).toEqual(["paragraph", "image", "paragraph"]);
    expect(out.doc.content?.[1]?.attrs?.["assetId"]).toBe(
      "550e8400-e29b-41d4-a716-446655440009"
    );
  });

  it("leaves no transient image src behind (no-persist property)", () => {
    const noisy: RichTextDocument = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "plain words here" }] },
        { type: "image", attrs: { src: "BLOB:upper", assetId: null } },
        { type: "image", attrs: { src: "DATA:image/gif;base64,xx", assetId: null } },
        {
          type: "image",
          attrs: {
            src: "blob:keep-but-resolved",
            assetId: "550e8400-e29b-41d4-a716-446655440001",
          },
        },
        {
          type: "image",
          attrs: {
            src: "https://cdn.test/ok.png",
            assetId: "550e8400-e29b-41d4-a716-446655440002",
          },
        },
      ],
    };
    const out = stripTransientImages(noisy);
    expect(out.dropped).toBe(2);
    const images = (out.doc.content ?? []).filter((n) => n.type === "image");
    expect(images).toHaveLength(2);
    // Strip rule: uploading===true OR (transient src AND no assetId). Every
    // survivor either carries an assetId or a non-transient src.
    for (const node of images) {
      const src = String(node.attrs?.["src"] ?? "");
      const hasAsset = node.attrs?.["assetId"] != null;
      expect(/^(blob:|data:)/i.test(src) && !hasAsset).toBe(false);
    }
    // Resolved nodes survive.
    expect(JSON.stringify(out.doc)).toContain("550e8400-e29b-41d4-a716-446655440001");
    expect(JSON.stringify(out.doc)).toContain("550e8400-e29b-41d4-a716-446655440002");
  });

  it("never throws on unknown shapes and passes them through", () => {
    const odd = { type: "doc" } as RichTextDocument;
    expect(() => stripTransientImages(odd)).not.toThrow();
    const out = stripTransientImages(odd);
    expect(out.dropped).toBe(0);
    expect(out.doc.type).toBe("doc");
  });

  it("fuzzes random file-likes without throwing", async () => {
    const mimes = [
      "image/png",
      "image/jpeg",
      "text/plain",
      "",
      "image/webp",
      "application/octet-stream",
    ];
    for (let i = 0; i < 50; i += 1) {
      const bytes = new Uint8Array([(i * 37) % 256, (i * 91) % 256, i % 256, 0xff, 0xd8, 0x47]);
      const mime = mimes[i % mimes.length] as string;
      const file = makeFile(bytes, "fuzz-" + i, mime);
      await expect(validateClipboardImage(file, sizeLoader(4 + (i % 7), 4))).resolves.toBeDefined();
    }
  });
});
