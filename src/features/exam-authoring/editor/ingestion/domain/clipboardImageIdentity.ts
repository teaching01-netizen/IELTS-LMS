/**
 * Clipboard image identity (pure; no host APIs).
 *
 * One copied image usually reaches the clipboard TWICE: as an image file and as
 * an HTML `<img>` pointing at the same source image. Both representations are
 * independent image sources during ingestion, so without an identity rule a
 * single paste stages two nodes, starts two uploads, and burns two of the five
 * per-paste image slots (docs/sat-authoring-image-policy.md).
 *
 * Two identity levels, strongest first:
 *
 *   1. BYTES  — same declared MIME, length, and content. Provable.
 *   2. VISUAL — the browser often re-encodes the clipboard file (a PNG built
 *      from the page's JPEG), so the bytes differ while the picture is the
 *      same. This level compares decoded shape and a 16x16 luminance
 *      fingerprint (difference hash + mean absolute delta) with tight bounds.
 *      It is a HEURISTIC: it must never be the only reason to collapse two
 *      images that a human would call different, so it requires equal decoded
 *      dimensions, a near-identical low-frequency structure, and the caller
 *      only applies it between the two representations of ONE paste.
 *
 * The browser-side rendering that feeds level 2 lives in
 * ../adapters/clipboardImageFingerprint.ts; this module owns the math so it can
 * be reasoned about and tested without a canvas.
 */

export interface ClipboardImageBytes {
  /** Declared byte length; a cheap pre-filter before content is read. */
  size: number;
  /** Declared MIME type. */
  type: string;
  readBytes: () => Promise<Uint8Array>;
}

function sameMime(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * True only when both references describe the same bytes: equal declared MIME,
 * equal declared length, and byte-for-byte equal content. Empty references are
 * never identical, so two failed/zero-length reads can never collapse a paste.
 */
export async function isSameClipboardImageBytes(
  left: ClipboardImageBytes,
  right: ClipboardImageBytes
): Promise<boolean> {
  if (left.size <= 0 || left.size !== right.size) return false;
  if (!sameMime(left.type, right.type)) return false;
  const [first, second] = await Promise.all([left.readBytes(), right.readBytes()]);
  if (first.byteLength !== second.byteLength || first.byteLength === 0) return false;
  for (let index = 0; index < first.byteLength; index += 1) {
    if (first[index] !== second[index]) return false;
  }
  return true;
}

/** Sampled luminance grid: GRID x GRID cells per image. */
export const CLIPBOARD_IMAGE_FINGERPRINT_GRID = 16;
/**
 * Pixels rendered per grid cell before averaging. A multi-pixel render makes
 * the sample depend on the picture, not on the decoder's nearest-neighbour
 * rounding.
 */
export const CLIPBOARD_IMAGE_FINGERPRINT_SUPERSAMPLE = 4;
/** Max Hamming distance over the 240-bit difference hash. */
export const CLIPBOARD_IMAGE_MAX_HASH_DISTANCE = 6;
/** Max mean absolute luminance delta (0..255) across the sampled grid. */
export const CLIPBOARD_IMAGE_MAX_LUMINANCE_DELTA = 4;

export interface ClipboardImageFingerprint {
  /** Decoded pixel dimensions, before any sampling. */
  width: number;
  height: number;
  /** Row-major GRID x GRID luminance samples, 0..255. */
  luminance: number[];
}

/**
 * Box-average an RGBA render into GRID x GRID luminance samples. Returns null
 * for an unexpected buffer or a render size that is not a whole multiple of the
 * grid, so a broken sampler degrades to "no fingerprint" instead of producing a
 * fingerprint that matches everything.
 */
export function luminanceSamplesFromRgba(
  rgba: Uint8ClampedArray,
  renderSize: number,
  grid: number
): number[] | null {
  if (!Number.isInteger(renderSize) || !Number.isInteger(grid)) return null;
  if (renderSize <= 0 || grid <= 0 || renderSize % grid !== 0) return null;
  if (rgba.length < renderSize * renderSize * 4) return null;
  const cells = renderSize / grid;
  const samples: number[] = [];
  for (let cellY = 0; cellY < grid; cellY += 1) {
    for (let cellX = 0; cellX < grid; cellX += 1) {
      let total = 0;
      for (let y = 0; y < cells; y += 1) {
        const rowOffset = ((cellY * cells + y) * renderSize + cellX * cells) * 4;
        for (let x = 0; x < cells; x += 1) {
          const offset = rowOffset + x * 4;
          total +=
            0.299 * (rgba[offset] ?? 0) +
            0.587 * (rgba[offset + 1] ?? 0) +
            0.114 * (rgba[offset + 2] ?? 0);
        }
      }
      samples.push(total / (cells * cells));
    }
  }
  return samples;
}

/** Grid side length implied by a square sample list, or null. */
export function fingerprintGridOf(luminance: readonly number[]): number | null {
  const size = Math.sqrt(luminance.length);
  if (!Number.isInteger(size) || size < 2) return null;
  return size;
}

/** Differing bits between the two horizontal-gradient hashes. */
export function clipboardImageHashDistance(
  left: readonly number[],
  right: readonly number[],
  grid: number
): number {
  let distance = 0;
  for (let row = 0; row < grid; row += 1) {
    for (let column = 0; column < grid - 1; column += 1) {
      const index = row * grid + column;
      const leftBit = (left[index] ?? 0) > (left[index + 1] ?? 0);
      const rightBit = (right[index] ?? 0) > (right[index + 1] ?? 0);
      if (leftBit !== rightBit) distance += 1;
    }
  }
  return distance;
}

/** Mean absolute luminance difference across the sampled grid. */
export function clipboardImageLuminanceDelta(
  left: readonly number[],
  right: readonly number[]
): number {
  const length = Math.min(left.length, right.length);
  if (length === 0) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    total += Math.abs((left[index] ?? 0) - (right[index] ?? 0));
  }
  return total / length;
}

/**
 * True when two fingerprints are the same picture for reconciliation purposes:
 * same decoded dimensions, difference-hash distance and mean luminance delta
 * both inside the tight bounds above.
 */
export function isSameClipboardImageFingerprint(
  left: ClipboardImageFingerprint,
  right: ClipboardImageFingerprint
): boolean {
  if (left.width <= 0 || left.height <= 0) return false;
  if (left.width !== right.width || left.height !== right.height) return false;
  if (left.luminance.length === 0 || left.luminance.length !== right.luminance.length) {
    return false;
  }
  const grid = fingerprintGridOf(left.luminance);
  if (grid === null) return false;
  return (
    clipboardImageHashDistance(left.luminance, right.luminance, grid) <=
      CLIPBOARD_IMAGE_MAX_HASH_DISTANCE &&
    clipboardImageLuminanceDelta(left.luminance, right.luminance) <=
      CLIPBOARD_IMAGE_MAX_LUMINANCE_DELTA
  );
}
