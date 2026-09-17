/**
 * Browser glue for the clipboard image fingerprint (adapter layer).
 *
 * The identity math lives in ../domain/clipboardImageIdentity.ts; this module
 * owns only the browser work: decode the image, render it small, read pixels.
 * Decoding and the drawing surface are injectable, so the sampling glue can be
 * unit-tested with synthetic pixels on machines without a canvas.
 *
 * Every failure path returns null — "no fingerprint" — which leaves ingestion
 * on the byte-identity rule only. A missing canvas, a tainted surface, or an
 * undecodable format must never block or corrupt a paste.
 */
import {
  CLIPBOARD_IMAGE_FINGERPRINT_GRID,
  CLIPBOARD_IMAGE_FINGERPRINT_SUPERSAMPLE,
  luminanceSamplesFromRgba,
  type ClipboardImageFingerprint,
} from "../domain/clipboardImageIdentity";

export type ClipboardImageFingerprinter = (
  file: File
) => Promise<ClipboardImageFingerprint | null>;

/** The subset of a 2D canvas context this module needs. */
export interface SamplingContext {
  fillStyle: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(source: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray };
}

export interface DecodedSamplingSource {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** Releases the decoded resource exactly once. */
  release: () => void;
}

export interface ClipboardImageFingerprintDeps {
  /** Drawing surface of `size` x `size`, or null when canvas is unavailable. */
  createContext?: ((size: number) => SamplingContext | null) | undefined;
  /** Decodes an image file into a drawable source, or null on failure. */
  decode?: ((file: File) => Promise<DecodedSamplingSource | null>) | undefined;
}

const RENDER_SIZE = CLIPBOARD_IMAGE_FINGERPRINT_GRID * CLIPBOARD_IMAGE_FINGERPRINT_SUPERSAMPLE;

function defaultCreateContext(size: number): SamplingContext | null {
  const offscreen = (globalThis as unknown as Record<string, unknown>)["OffscreenCanvas"];
  if (typeof offscreen === "function") {
    try {
      const canvas = new (offscreen as new (width: number, height: number) => {
        getContext: (id: string) => SamplingContext | null;
      })(size, size);
      const context = canvas.getContext("2d");
      if (context) return context;
    } catch {
      // Fall through to the document-canvas path.
    }
  }
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    return (context as unknown as SamplingContext | null) ?? null;
  } catch {
    return null;
  }
}

async function defaultDecode(file: File): Promise<DecodedSamplingSource | null> {
  const createBitmap = (globalThis as unknown as Record<string, unknown>)["createImageBitmap"];
  if (typeof createBitmap === "function") {
    try {
      const bitmap = await (
        createBitmap as (input: File) => Promise<{ width: number; height: number; close?: () => void }>
      )(file);
      if (bitmap && bitmap.width > 0 && bitmap.height > 0) {
        return {
          source: bitmap as unknown as CanvasImageSource,
          width: bitmap.width,
          height: bitmap.height,
          release: () => {
            try {
              bitmap.close?.();
            } catch {
              // Releasing a decoded bitmap must never surface an error.
            }
          },
        };
      }
      try {
        bitmap?.close?.();
      } catch {
        // Ignore an unusable decode's cleanup failure.
      }
      return null;
    } catch {
      return null;
    }
  }

  const imageCtor = (globalThis as unknown as Record<string, unknown>)["Image"];
  const urlApi = globalThis.URL as unknown as
    | { createObjectURL?: (file: File) => string; revokeObjectURL?: (url: string) => void }
    | undefined;
  if (typeof imageCtor !== "function" || typeof urlApi?.createObjectURL !== "function") return null;
  const createObjectURL = urlApi.createObjectURL;
  const revokeObjectURL = urlApi.revokeObjectURL;
  const image = new (imageCtor as new () => HTMLImageElement)();
  const objectUrl = createObjectURL(file);
  return await new Promise<DecodedSamplingSource | null>((resolve) => {
    const release = (): void => {
      try {
        revokeObjectURL?.(objectUrl);
      } catch {
        // Revocation is best effort.
      }
    };
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (width <= 0 || height <= 0) {
        release();
        resolve(null);
        return;
      }
      resolve({ source: image, width, height, release });
    };
    image.onerror = () => {
      release();
      resolve(null);
    };
    image.src = objectUrl;
  });
}

/**
 * Build a fingerprinter over the given browser primitives. The default
 * fingerprinter below is the production instance.
 */
export function createClipboardImageFingerprinter(
  deps: ClipboardImageFingerprintDeps = {}
): ClipboardImageFingerprinter {
  const createContext = deps.createContext ?? defaultCreateContext;
  const decode = deps.decode ?? defaultDecode;

  return async (file: File): Promise<ClipboardImageFingerprint | null> => {
    let context: SamplingContext | null;
    try {
      context = createContext(RENDER_SIZE);
    } catch {
      context = null;
    }
    if (!context) return null;

    let decoded: DecodedSamplingSource | null;
    try {
      decoded = await decode(file);
    } catch {
      decoded = null;
    }
    if (!decoded) return null;

    try {
      if (decoded.width <= 0 || decoded.height <= 0) return null;
      // Composite over white first: a transparent PNG and the flattened
      // rendering of the same picture then sample the same way.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, RENDER_SIZE, RENDER_SIZE);
      context.drawImage(decoded.source, 0, 0, RENDER_SIZE, RENDER_SIZE);
      const pixels = context.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE).data;
      const luminance = luminanceSamplesFromRgba(
        pixels,
        RENDER_SIZE,
        CLIPBOARD_IMAGE_FINGERPRINT_GRID
      );
      if (!luminance) return null;
      return { width: decoded.width, height: decoded.height, luminance };
    } catch {
      return null;
    } finally {
      decoded.release();
    }
  };
}

/** Production fingerprinter: OffscreenCanvas + createImageBitmap when present. */
export const fingerprintClipboardImage: ClipboardImageFingerprinter =
  createClipboardImageFingerprinter();
