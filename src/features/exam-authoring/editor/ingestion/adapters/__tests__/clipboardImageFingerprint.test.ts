import { describe, expect, it, vi } from "vitest";
import {
  createClipboardImageFingerprinter,
  type DecodedSamplingSource,
  type SamplingContext,
} from "../clipboardImageFingerprint";
import {
  CLIPBOARD_IMAGE_FINGERPRINT_GRID,
  CLIPBOARD_IMAGE_FINGERPRINT_SUPERSAMPLE,
} from "../../domain/clipboardImageIdentity";

const RENDER_SIZE = CLIPBOARD_IMAGE_FINGERPRINT_GRID * CLIPBOARD_IMAGE_FINGERPRINT_SUPERSAMPLE;

function whiteRender(size = RENDER_SIZE, rgba: [number, number, number, number] = [255, 255, 255, 255]) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = rgba[0];
    data[index + 1] = rgba[1];
    data[index + 2] = rgba[2];
    data[index + 3] = rgba[3];
  }
  return data;
}

function fakeContext(data: Uint8ClampedArray = whiteRender()) {
  const drawImage = vi.fn();
  const fillRect = vi.fn();
  const getImageData = vi.fn(() => ({ data }));
  const context: SamplingContext = {
    fillStyle: "",
    fillRect,
    drawImage,
    getImageData,
  };
  return { context, drawImage, fillRect, getImageData };
}

function fakeDecode(width: number, height: number) {
  const release = vi.fn();
  const decoded: DecodedSamplingSource = {
    source: {} as CanvasImageSource,
    width,
    height,
    release,
  };
  return { decode: vi.fn(async () => decoded), release };
}

describe("clipboard image fingerprint adapter", () => {
  it("renders the decoded image into one luminance sample per grid cell", async () => {
    const { context, drawImage, fillRect, getImageData } = fakeContext();
    const createContext = vi.fn((size: number) => {
      expect(size).toBe(RENDER_SIZE);
      return context;
    });
    const { decode, release } = fakeDecode(800, 600);

    const fingerprint = await createClipboardImageFingerprinter({ createContext, decode })(
      new File(["bytes"], "copy.png", { type: "image/png" })
    );

    expect(createContext).toHaveBeenCalledTimes(1);
    expect(fillRect).toHaveBeenCalledWith(0, 0, RENDER_SIZE, RENDER_SIZE);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, RENDER_SIZE, RENDER_SIZE);
    expect(getImageData).toHaveBeenCalledWith(0, 0, RENDER_SIZE, RENDER_SIZE);
    // Decoded dimensions travel with the samples; sampling runs at RENDER_SIZE.
    expect(fingerprint?.width).toBe(800);
    expect(fingerprint?.height).toBe(600);
    expect(fingerprint?.luminance).toHaveLength(
      CLIPBOARD_IMAGE_FINGERPRINT_GRID * CLIPBOARD_IMAGE_FINGERPRINT_GRID
    );
    expect(fingerprint?.luminance.every((sample) => sample === 255)).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("returns null in an environment without a drawing surface", async () => {
    const { decode } = fakeDecode(4, 4);
    const fingerprint = await createClipboardImageFingerprinter({
      createContext: () => null,
      decode,
    })(new File(["bytes"], "copy.png", { type: "image/png" }));

    expect(fingerprint).toBeNull();
    // No surface, no decode work.
    expect(decode).not.toHaveBeenCalled();
  });

  it("releases the decoded image and returns null on every failure path", async () => {
    const { context } = fakeContext();
    const { decode, release } = fakeDecode(0, 0);
    await expect(
      createClipboardImageFingerprinter({ createContext: () => context, decode })(
        new File(["bytes"], "empty.png", { type: "image/png" })
      )
    ).resolves.toBeNull();
    expect(release).toHaveBeenCalledTimes(1);

    await expect(
      createClipboardImageFingerprinter({
        createContext: () => context,
        decode: async () => {
          throw new Error("decode failed");
        },
      })(new File(["bytes"], "broken.png", { type: "image/png" }))
    ).resolves.toBeNull();

    await expect(
      createClipboardImageFingerprinter({
        createContext: () => {
          throw new Error("no canvas");
        },
        decode: async () => null,
      })(new File(["bytes"], "broken.png", { type: "image/png" }))
    ).resolves.toBeNull();

    const shortBuffer = fakeContext(new Uint8ClampedArray(4));
    const { decode: decodeForShort } = fakeDecode(4, 4);
    await expect(
      createClipboardImageFingerprinter({ createContext: () => shortBuffer.context, decode: decodeForShort })(
        new File(["bytes"], "short.png", { type: "image/png" })
      )
    ).resolves.toBeNull();
  });

  it("tolerates a canvas that refuses to read pixels", async () => {
    const { decode } = fakeDecode(10, 10);
    const fingerprint = await createClipboardImageFingerprinter({
      createContext: () => ({
        fillStyle: "",
        fillRect: () => {},
        drawImage: () => {},
        getImageData: () => {
          throw new Error("tainted canvas");
        },
      }),
      decode,
    })(new File(["bytes"], "copy.png", { type: "image/png" }));

    expect(fingerprint).toBeNull();
  });
});
