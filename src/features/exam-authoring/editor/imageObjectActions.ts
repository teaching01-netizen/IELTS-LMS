import { isDirectImageSource } from "./schema/imageNode";

/**
 * What an author can say about a visual, expressed as data the document already
 * understands.
 *
 * Alignment and size are stored on the image node, so they travel with the
 * content: the authoring editor, the preview sheet, and the student surface all
 * read the same two attributes. `null` means "as it was before this existed" —
 * centred, at the column's natural width — so existing questions render
 * byte-for-byte as they did.
 */
export type SatImageAlign = "left" | "center" | "right";
export type SatImageSize = "small" | "medium" | "large";

export interface ImageObjectAttrs {
  [key: string]: unknown;
}

export const IMAGE_ALIGN_OPTIONS: readonly { value: SatImageAlign; label: string }[] = [
  { value: "left", label: "Align left" },
  { value: "center", label: "Align center" },
  { value: "right", label: "Align right" },
];

/**
 * Sizes are fractions of the reading column, not pixels: the same question is
 * authored on a laptop, reviewed in a sheet, and answered on a tablet at a
 * split pane, and only a relative width survives all three.
 */
export const IMAGE_SIZE_OPTIONS: readonly { value: SatImageSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

export const IMAGE_SIZE_FRACTIONS: Record<SatImageSize, string> = {
  small: "40%",
  medium: "70%",
  large: "100%",
};

export function imageAlignFromAttrs(attrs: ImageObjectAttrs): SatImageAlign | null {
  const value = attrs["align"];
  return value === "left" || value === "center" || value === "right" ? value : null;
}

export function imageSizeFromAttrs(attrs: ImageObjectAttrs): SatImageSize | null {
  const value = attrs["size"];
  return value === "small" || value === "medium" || value === "large" ? value : null;
}

/** Style for the figure that wraps a visual. */
export function imageFigureStyle(attrs: ImageObjectAttrs): { maxWidth?: string; marginInline?: string } {
  const size = imageSizeFromAttrs(attrs);
  if (!size) return {};
  const align = imageAlignFromAttrs(attrs);
  return {
    maxWidth: IMAGE_SIZE_FRACTIONS[size],
    marginInline: align === "left" ? "0 auto" : align === "right" ? "auto 0" : "auto",
  };
}

/** Style for the box the visual itself sits in. */
export function imageContentStyle(attrs: ImageObjectAttrs): { marginInline: string } {
  const align = imageAlignFromAttrs(attrs);
  if (align === "left") return { marginInline: "0 auto" };
  if (align === "right") return { marginInline: "auto 0" };
  return { marginInline: "auto" };
}

export interface ImageAssetResolver {
  (assetId: string): Promise<{ downloadUrl: string | null }>;
}

/**
 * Hands the author the original file the visual came from.
 *
 * Managed assets resolve through the media API; direct sources are already
 * their own URL. Cross-origin links may open instead of saving, because
 * browsers only honour `download` same-origin — the action still lands the
 * author on the original rather than doing nothing.
 */
export async function downloadImageOriginal(
  attrs: ImageObjectAttrs,
  resolve: ImageAssetResolver
): Promise<void> {
  const assetId = typeof attrs["assetId"] === "string" ? attrs["assetId"] : "";
  const source = typeof attrs["src"] === "string" ? attrs["src"] : "";
  const direct = isDirectImageSource(assetId) ? assetId : isDirectImageSource(source) ? source : "";
  let href = direct;
  if (!href && assetId) {
    try {
      href = (await resolve(assetId)).downloadUrl ?? "";
    } catch {
      href = "";
    }
  }
  if (!href || typeof document === "undefined") return;
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = "";
  anchor.rel = "noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
